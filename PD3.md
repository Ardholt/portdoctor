# PD3: PortDoctor against the real QNX SDP 8.0

Slice PD3, QNX Global Hackathon (closes 15 Dec 19:00Z). Built on PD1/PD2 and judge report J1. Repo: this repository, version 0.3.0.
Date: 2026-11-22. One commit per step (see `git log`). The SDP ran only inside the sandbox jail (`sandbox wrapper`, no network, no /<home>, as uid `sandbox user`);
no vendor header, library or binary is in the repo, only derived facts.

## 1. Facts (measured in the jail; `data/sdp-8.0-facts.md`)

- QNX SDP 8.0, Stable Build 141 (`com.qnx.qnx800/8.0.0.00141T202311271501L`; the build id is the operator's, not read back from a file). Host: linux x86_64.
- `qcc -V` lists `gcc_ntox86_64` (default), `gcc_ntoaarch64le`, each with `_gpp` and `_cxx`, all gcc 12.2.0. `qcc -version` is not an option ("unknown option").
- Triples `x86_64-pc-nto-qnx8.0.0` and `aarch64-unknown-nto-qnx8.0.0`. Predefined `__QNXNTO__ 1`, `__QNX__ 800`. Both targets exist under `$QNX_TARGET`.
- Hello world compiles, links and produces ELF (interpreter `/usr/lib/ldqnx-64.so.2`) for both variants.
- Link probes: `-lsocket -lm -lc++ -lregex` link; `-lrt -lpthread -ldl -lnsl -lutil -lresolv` fail with "cannot find".
- **QEMU/KVM: not available** (no `/dev/kvm`, no qemu on the box). Nothing was run on a QNX target. Everything below is compile/link/symbol evidence.
- The sandbox has node (staged copy), python3, git, cmake, make; no network, so no model CLI could run in the jail (and none was logged in on the host either).

## 2. Manifest generator (`tools/sdp-manifest.mjs` -> `data/sdp-8.0-manifest.json`)

Run inside the jail with the SDP environment sourced. For **507 names** (functions, macros, structs, typedefs: everything the rules mention, plus a broad POSIX/Linux/BSD list
and the QNX-native APIs the remedies name), **174 headers**, **32 libraries**, **35 compiler/linker flags**, on **both** targets, it records:
header search (stripped of comments; io-sock driver headers under `devs/` are tracked separately as kernel-private), exported dynamic symbols of every SDP `.so` and `libc.a`
(`nm`), and `qcc` probes: compile with the common POSIX headers plus the defining header, again with `_GNU_SOURCE`, again with QNX extension macros;
for functions a real link (default libs, then `-lsocket -lm`, then the library that exports the symbol). Verdicts: `present` (with `needsLib` when it links only with a library),
`present-gated`, `absent`, `absent-from-user-headers`, `declared-but-not-visible`, `declared-not-linkable`, `symbol-only`. Every absent name keeps the compiler's first error.
Result: 305 present, 159 absent, 29 absent-from-user-headers, 8 declared-but-not-visible, 3 declared-not-linkable, 2 symbol-only, 1 present-gated; no name differs between x86_64 and aarch64le.
Runs in about 50 s. Bugs found and fixed while building it: a header-index cap that hid `sys/sem.h`; `-fsyntax-only` still links under qcc (probes use `-c`);
interposer libs (libasan) listed as exporters; socket functions needing `-lsocket`.

Findings of note (all by probe on build 141): inotify exists (`<sys/inotify.h>`, libfsnotify, `-lfsnotify`); accept4, pipe2, SOCK_*, MSG_NOSIGNAL, TCP_FASTOPEN/TCP_INFO, SO_REUSEPORT,
gettid (`<sys/process.h>`), pthread_setname_np, shm_open + SHM_ANON, getpeereid, LOCAL_PEERCRED, ThreadCtl, `_NTO_TCTL_RUNMASK` exist; epoll/eventfd/timerfd/signalfd, kqueue/kevent (only in
io-sock driver headers), memfd_create, prctl, getrandom/getentropy, sched_setaffinity/CPU_SET, dup3, sendfile (declared, not exported), splice, mremap, SysV shm/sem (commented out
"not currently supported") and msg*, `<linux/*>`, `<asm/*>`, `SA_RESTART` (commented out "not supported yet"), O_PATH/O_DIRECT do not.

## 3. `portdoctor scan --sdp-manifest` (`src/sdp.ts`, rule `sdp` overrides)

Each finding is looked up by the identifiers/header/`-l` flag/compiler flag it matched. Confidence becomes `verified-present`, `verified-absent` or `verified-partial`;
an API the SDP has is **dropped** (`--sdp-keep-present` keeps it as info), unless it needs a library or carries a semantics caveat (kept as info with the library named, e.g. inotify needs `-lfsnotify`).
The message gets the evidence ("verified on SDP 8.0.0.00141...: epoll_create1: not declared in any user header..."). Rule messages and remedies were rewritten from the evidence
for 36 rules (no more kqueue advice, inotify no longer a blocker, gettid native, dup3-only, -lsocket). Names not in the manifest are reported (`stats.sdp.uncovered`), never guessed.
HTML chips, SARIF, `init-toolchain` and the disclaimer carry the new labels.

**Corpus (`corpus/SDP-DELTA.md`, regenerate with `node corpus/sdp-delta.mjs`).** 501 findings before, **488** after; **272 (54%)** changed class: 212 verified-absent, 17 partial (sanitizer flags),
30 verified-present kept as info, 13 verified-present dropped. 229 (46%) the SDP cannot decide (`#ifdef` advice, `/proc` `/sys` paths, device nodes, uname/CC build rules).
Frank part of the delta: PD2 was wrong on inotify (24 findings called it a blocker with no equivalent), on the kqueue remedy (84 epoll findings pointed at it), on `sys/inotify.h` and
`sys/auxv.h` being absent, and on `pthread_getattr_np`; the hedged accept4/pipe2/SOCK_*/MSG_NOSIGNAL/TCP_* rules were right to hedge (they exist), epoll/linux headers/prctl/getrandom/-lrt/-ldl etc. were right.
It missed one thing entirely (below).

## 4. qcc verification of the AI loop

- `portdoctor fix --check qcc[:variant]` runs `qcc -V<variant> -c` (`q++` for C++) on every touched C/C++ file, baseline before and after, and reverts on failure; `--sdp-manifest` makes the counts SDP-aware.
- **The model part, said plainly:** `providers/claude-cli.sh` could not run (jail has no network; the `claude` CLI on the uk box and on the VPS is not logged in; I tried `claude -p`: "Not logged in" / "OAuth session expired").
  The two patches in `examples/patches/demo-epoll.jsonl` were therefore written by the author's own model session (Claude, in this build), outside the jail, for the exact request `portdoctor` built, recorded in the
  `providers/record.sh` format, and replayed in the jail with `providers/replay.mjs`. They are real patches by a real model, not the stub, but not produced by `claude-cli.sh`.
- Demo `examples/demo-epoll` (epoll echo server + `-lrt`): scan 12 findings (9 blockers). On `qcc` the original **fails** (`fatal error: sys/epoll.h: No such file or directory`, both targets) and `make CC=qcc` fails.
  Fix loop: EPOLL patch applied (qcc check pass, baseline 1 error -> 0), LSOCKET patch applied (drops -lrt, adds -lsocket), HDR finding already resolved; **12 -> 0 findings**; the patched project builds with
  `make CC="qcc -Vgcc_ntox86_64"` and `-Vgcc_ntoaarch64le` (ELF for QNX). Compile and link only, not run. Output: `examples/demo-qcc-output.txt`, `examples/demo-epoll-fix-qcc-report.html`.
- Demo `examples/demo` (the PD2 one): PD2's 4 findings are now 5 with the SDP: `pipe2` and `SOCK_NONBLOCK` are **not problems** (the original `main.c` compiles on qcc for both targets; the manifest scan drops them: 5 -> 3),
  `-lrt` really fails the link, and the file fails to link without `-lsocket`.
- Tests: the stub-driven loop tests were updated (demo is 5 findings); `tools/demo-qcc.sh` is the jail script that produced the output.

## 5. Real builds and the recall measure (`corpus/qcc-build-output.txt`, `tools/build-corpus.sh`)

| project | build for QNX 8.0 (qcc, generated `qnx-toolchain.cmake` / `make CC=qcc`) | scan prediction (with manifest) | match |
|---|---|---|---|
| cJSON | configure + build OK, x86_64 and aarch64le, library and test binary are QNX ELF | 18 findings, none blocker/major (uname/CC makefile advice, sanitizer flags) | no miss |
| kilo | build OK both targets | 1 info finding (Linux #ifdef) | no miss |
| Lua | OK once `-ldl` is removed; with the project's own `-ldl`: `cannot find -ldl` | `QNX-BLD-LDL` verified-absent + hard-coded CC | the one real break was predicted |
| examples/demo, demo-epoll | see section 4 | PD2 had **not** predicted the missing `-lsocket` | **miss, then fixed**: new rule `QNX-BLD-LSOCKET` (project-level: socket calls in code, no `-lsocket` in any build file) |

This is three small, portable projects plus two demos: it says the scan does not cry wolf on clean code and found one real miss; it is **not** a recall rate. libuv, libev, iperf and dropbear were not built.
The generated `qnx-toolchain.cmake` worked unedited for both variants; `portability.h` was not compiled.

## 6. Numbers

- `node --test tests/`: **170 tests, 170 pass** (163 before; new: SDP classification, scan with manifest, claim tests rewritten to pin the verified wording, LSOCKET rule examples, qcc check expansion path through the loop tests).
- Rules: 56 (55 + `QNX-BLD-LSOCKET`). Manifest 384 KB. Corpus: 7 projects, 501 -> 488 findings, 54% re-classed.

## What was NOT verified

- **Nothing was executed on QNX.** No QEMU/KVM. "Present" means declared and linkable, not that it behaves like Linux (inotify event semantics, accept4 flags, SO_REUSEPORT, TCP_INFO layout, ThreadCtl runmask, SHM_ANON, gettid's number space were not exercised).
- One SDP build (141), two targets. Another SDP version needs a new manifest; the manifest does not say what a QNX target image (not the SDP) contains: `/proc`, `/dev/shmem`, `/dev/urandom`, `-lfsnotify` at runtime are unchecked.
- The probe uses a fixed common-header set plus the defining header; a name needing an odd header or a feature macro outside the three variants tried could be called absent (the compiler error is kept in the manifest per name). Header text search ignores `#if`; the compile probe decides.
- 229 corpus findings (46%) are not decidable from the SDP and keep known/guess. `#ifdef`/guard logic, other-OS files and build-selected files are unchanged from PD2 (precision numbers in `corpus/PRECISION.md` were **not** re-sampled).
- The AI loop was not exercised with `claude-cli.sh` (no logged-in model CLI); the patches come from the author's model session and were replayed. The loop is demonstrated on two tiny demos, not on a real project port. Only compile and link were checked after patching, no tests ran.
- Flag probes link a trivial program only; sanitizers/`-Wl` options were not tried on a real shared library. `-fsanitize=address` rejection was seen on this SDP's qcc, not investigated.
- The recall measure above is 5 small builds; effort figures remain uncalibrated constants; accessibility and cross-platform items from PD1/PD2 are unchanged.
- Work copies remain in the jail under `$WORK` (repo copy, corpus sources, build outputs); ops may reap them. No JANITOR lease was taken.

## Next

Run a real port end to end (iperf3 or libev) with a logged-in model, measure recall properly against what actually fails, add QEMU/target runs when a KVM host exists, and replace the `evidence`/`other-os` literals with the judge noted in PD2.
