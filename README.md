# PortDoctor

A static scanner that finds the places a Linux/POSIX C/C++ project will likely need work to build and run on
**QNX 8.0**, tells you where (file:line), how bad it is, and what to do about it, groups the findings by cause, and
produces a single-file HTML report you can hand to a team. It can also drive a **propose, apply, check, re-scan loop**
with a model or script of your choice, and emit SARIF, a CMake toolchain file and a `portability.h` skeleton.

```
portdoctor scan ./my-project --html -o report.html
portdoctor scan ./my-project --sarif -o portdoctor.sarif
portdoctor scan ./my-project            # text summary, grouped by rule
portdoctor fix  ./my-project --provider providers/claude-cli.sh --count 3
portdoctor init-toolchain ./my-project --arch aarch64le --out ./qnx
```

**Verified against a real SDP (PD3).** With `--sdp-manifest data/sdp-8.0-manifest.json`, API, header and library findings are decided
against the QNX SDP 8.0 (Stable Build 141, qcc 12.2.0, x86_64 and aarch64le): header search, exported-symbol check and a real `qcc`
compile/link probe. Such findings are labelled **verified-absent** / **verified-present** / **verified-partial**; an API the SDP has is
dropped (not reported as missing). Everything else keeps `known` (recalled) or `guess` (unverified): `/proc` and `/sys` paths, `#ifdef`
advice, device nodes, FUSE, most build-system advice. **Nothing was run on a QNX target** (no QEMU/KVM was available): verified
means compile/link/symbol evidence, not runtime behaviour. See `PD3.md` and `corpus/SDP-DELTA.md`.

## What it does

- Walks a tree of C/C++ sources, `CMakeLists.txt`/`*.cmake`, Makefiles, and `configure.ac`.
- Applies **55 rules** that live as data in `rules/*.json`. Each has severity, `known|guess`, a remedy, a "verify against SDP" note
  for guesses, and positive and negative examples that the tests run.
- Understands enough C to avoid false hits: comments and string literals are masked; `#if` nesting is tracked (matches inside
  `#ifdef __QNXNTO__` are suppressed and counted, Linux-only blocks are flagged, other guards are shown not judged);
  feature-test lines (`#ifndef EFD_NONBLOCK`, `defined(TCP_INFO)`, including continued lines) and `#define` fallbacks are not uses.
- **Identifier rules need call context (PD2).** `clone`, `tee`, `syscall`, `sysinfo`, `pthread_yield` and friends do not match
  method calls (`x->clone()`, `obj.tee()`, `Cls::f()`), declarations or definitions of a user function with that name (same file,
  or an included project header that the project defines), and the ambiguous names additionally need a visible include or macro
  (`CLONE_*`/`<sched.h>`, `SPLICE_F_*`/`_GNU_SOURCE`, `SYS_*`/`<sys/syscall.h>`, `<sys/sysinfo.h>`). The cost is a false negative when
  the header arrives only through a project header or a compiler flag. These are syntactic sensors, not a parser.
- **Report**: summary cards, a *Start here: top 3* panel, a heat map (tiles filter the list; relative or absolute colour scale),
  findings **grouped by rule** ("epoll event loop: 20 sites in 2 files") with expandable sites, filters, light/dark, keyboard
  shortcuts, ARIA, print CSS. Effort is shown as a rough range and says "uncalibrated".
- **`fix` loop**: for N findings, ask your provider for a patch, validate it against a JSON schema, `git apply --check`, apply it to a
  **copy**, run a check command, re-scan, and write `fix-report.html` with before/after counts. Failed checks are reverted.
- **SARIF 2.1.0** (`scan --sarif`) for CI and IDEs. **`init-toolchain`** writes `qnx-toolchain.cmake` and a `portability.h` skeleton.
- **Build awareness (heuristic)**: reads `compile_commands.json`, or source lists in CMake/Makefile, and marks findings in files the
  list does not mention ("not in build list?"). `--ignore-preset other-os` skips paths named for other operating systems.

## Run it

Needs Node.js **22.18 or newer** (runs TypeScript via Node's type stripping; no build step, no dependencies, nothing to `npm install`).

```
node bin/portdoctor.mjs scan <dir> --html -o report.html
node --test tests/
```

`scan` options: `--json`, `--html`, `--sarif`, `-o <file>`, `--fail-on <blocker|major|minor|info>` (exit 1, for CI),
`--ignore <regex>` (repeatable), `--ignore-preset other-os`, `--no-build-awareness`, `--rules <dir>`,
`--sdp-manifest <file>` (verify against the SDP manifest), `--sdp-keep-present` (keep what the SDP disproves, as info).

The manifest is made by `tools/sdp-manifest.mjs` run inside the SDP environment (it needs `QNX_TARGET`, `qcc`, the SDP `nm`); it stores
derived facts only (names, booleans, header paths, library names, versions), no vendor headers or binaries. `tools/jail.sh`,
`tools/stage.sh`, `tools/demo-qcc.sh` and `tools/build-corpus.sh` show how it was run in a sandbox. `portdoctor rules` lists the rules.

## The fix loop

```
portdoctor fix <dir> --provider "<cmd>" [--check "<cmd>|qcc[:variant]"] [--sdp-manifest <file>] [--count N] [--rule ID] [--keep <dir>] [-o fix-report.html]
```

1. Scan; pick the first site of each of the top N rule groups (`--rule` restricts).
2. Send each to the provider: request JSON on stdin (prompt, schema, finding, code window); the provider prints one patch JSON object.
   `PD_ROOT` in its environment is the project copy.
3. Validate against the schema, `git apply --check` (paths outside the root are refused), apply **on a copy** (the original is never touched).
4. Run the check command. Default: host `gcc -fsyntax-only -D__QNXNTO__` on the touched C file (`g++` for C++); other file types are `skipped`.
   `--check qcc` (or `qcc:gcc_ntoaarch64le`) compiles each touched file with the QNX SDP's `qcc`/`q++ -c` instead (SDP environment must be sourced);
   any other `--check` command is pluggable; `{file}`, `{root}`, `{dir}` are substituted. A failing check reverts the patch.
5. Re-scan the copy; print before/after counts; write the report. Exit 0 only if every step applied.

`providers/claude-cli.sh` calls `claude -p` (or `PD_LLM_CMD`) with the prompt on stdin and exits 3 with a message if the CLI is missing.
That uses your account; PortDoctor itself never calls a model, the tests never run a real one (`examples/stub-provider.mjs` is a
deterministic stub), and the scanner makes no network calls. `examples/` has two before/after demos (`demo`: 5 findings, `demo-epoll`: 12 findings,
both to 0). `providers/record.sh` records a provider's responses and `providers/replay.mjs` replays them (for places a model cannot run, such as a
network-less SDP sandbox). In PD3 the epoll demo's patches were written by the author's own model session, **not** by `claude-cli.sh` (no logged-in
model CLI was available on the build box), recorded in `examples/patches/demo-epoll.jsonl` and replayed with `--check qcc`: before the patches `qcc`
fails on `sys/epoll.h`, after them the project builds with `make CC=qcc` for both targets. Compile and link only; not run.

**The default compile check is host gcc syntax only, not a QNX build.** Use `--check qcc` inside an SDP environment for a real QNX compile.
A patch that passes is compile-verified, not run.

## Honest limits

- **Nothing was run on a QNX target.** Verified = header/symbol/`qcc` compile-and-link evidence from SDP 8.0 build 141 (x86_64, aarch64le); no
  QEMU or KVM was available. Without `--sdp-manifest`, findings are text matches and the labels are `known`/`guess` as before. Another SDP
  version needs its own manifest (`tools/sdp-manifest.mjs`).
- `known` still means "documented and recalled", not verified. Doc `refs` are page names, not fetched URLs. Measured on the SDP: inotify, accept4,
  pipe2, SOCK_NONBLOCK/CLOEXEC, MSG_NOSIGNAL, TCP_FASTOPEN/TCP_INFO and gettid exist; epoll, eventfd, timerfd, signalfd, kqueue, memfd_create, prctl,
  getrandom, sched_setaffinity and the `<linux/...>` headers do not; there is no librt/libpthread/libdl/libnsl/libutil; socket code needs -lsocket.
- The scanner cannot know which files your build compiles for QNX. Build awareness reads source lists only when they are plain;
  libuv's list names every platform's files, so it flags nothing there. Use `--ignore`, `--ignore-preset other-os` (a filename
  heuristic you opt into) and the guards shown on each finding.
- Feature-macro guards (`#ifdef HAVE_EPOLL`) are shown, not evaluated, so portable projects are over-reported.
- Effort figures are rough, uncalibrated ranges (rule base minutes, +15% per extra site, capped, shown as 0.5x to 1.5x). Not measurements.
- Precision on the corpus (`corpus/PRECISION.md`, 60 new findings read by one reader, before three rule bugs it found were fixed): the
  rule did what it says in 72%, rule bugs 5%, textually right but irrelevant to a QNX port (other-OS branches, vendored/test files) 23%,
  and only 7% plain actionable findings; the rest sit behind guards or in platform-selected files. Small samples per rule.
- False negatives are not measured. A clean scan is not proof of portability.
- Tested on Linux with Node 26 only. Report tested in headless Chrome only; no screen-reader pass.
- `init-toolchain`: the generated toolchain file configured and built cJSON for both variants with cmake 3.28 and SDP 8.0 build 141 (not run). `portability.h` was not compiled.

## Layout

```
bin/portdoctor.mjs   entry point
src/                 scan.ts (walker, masking, #if tracking, call context), group.ts (rule groups, effort range), build.ts,
                     report-html.ts, propose.ts, fix.ts, sarif.ts, init.ts, rules.ts, cli.ts
rules/*.json         the rules (data) with positive and negative examples
providers/           claude-cli.sh (provider script for a local LLM CLI)
examples/            demo project, stub provider, before/after outputs
tests/               node --test (includes a headless-Chrome test with real mouse clicks; skipped if Chrome is absent)
corpus/              pinned scans of seven OSS projects, reports, hand reviews (CORPUS.md, PRECISION.md)
```

Adding a rule: append an object to a `rules/*.json` file with `id`, `severity`, `confidence`, `appliesTo`, `scope`
(`code` | `string` | `include` | `any`), `pattern`, `message`, `remedy`, optional `evidence` (identifier to required-regex), and at least one
positive and one negative example.

## Licence

MIT. See `LICENSE`.
