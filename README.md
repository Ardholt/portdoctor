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

**No QNX SDP was available while building this.** Nothing was compiled or run on QNX. Every statement about QNX below is
labelled `known` (recalled from public documentation, not checked in this build) or `guess` (unverified).

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
`--ignore <regex>` (repeatable), `--ignore-preset other-os`, `--no-build-awareness`, `--rules <dir>`. `portdoctor rules` lists the rules.

## The fix loop

```
portdoctor fix <dir> --provider "<cmd>" [--check "<cmd>"] [--count N] [--rule ID] [--keep <dir>] [-o fix-report.html]
```

1. Scan; pick the first site of each of the top N rule groups (`--rule` restricts).
2. Send each to the provider: request JSON on stdin (prompt, schema, finding, code window); the provider prints one patch JSON object.
   `PD_ROOT` in its environment is the project copy.
3. Validate against the schema, `git apply --check` (paths outside the root are refused), apply **on a copy** (the original is never touched).
4. Run the check command. Default: host `gcc -fsyntax-only -D__QNXNTO__` on the touched C file (`g++` for C++); other file types are `skipped`.
   `--check` is pluggable; `{file}`, `{root}`, `{dir}` are substituted. A failing check reverts the patch.
5. Re-scan the copy; print before/after counts; write the report. Exit 0 only if every step applied.

`providers/claude-cli.sh` calls `claude -p` (or `PD_LLM_CMD`) with the prompt on stdin and exits 3 with a message if the CLI is missing.
That uses your account; PortDoctor itself never calls a model, the tests never run a real one (`examples/stub-provider.mjs` is a
deterministic stub), and the scanner makes no network calls. `examples/` has a before/after demo (4 findings to 0).

**The compile check is host gcc syntax only, not a QNX build.** It cannot know whether a QNX header or function exists; a `qcc` check
will replace it. A patch that passes is plausible, not verified.

## Honest limits

- **No QNX SDP was available.** Nothing was compiled or run on QNX. Findings are text matches.
- `known` means "documented and recalled", not "verified in this build". Doc `refs` are page names, not fetched URLs. QNX 8.0's
  networking (io-sock) is believed BSD-derived (a guess): several APIs this tool once called "Linux extensions" (`accept4`, `pipe2`,
  `dup3`, `SOCK_NONBLOCK`, `MSG_NOSIGNAL`, some `TCP_*`) may exist there, so those rules now say "not in POSIX.1-2017, check the SDP header".
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
- `init-toolchain` output is untested against an SDP; the `-V` variant names and CMake QNX settings are recalled.

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
