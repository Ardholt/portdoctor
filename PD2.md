# PD2: PortDoctor build report

Slice PD2, QNX Global Hackathon. This repository (Node v26.13.0, git 2.43, headless Chrome, gcc).
Built on top of PD1 and the fresh judge report J1 (T7 D8 I6 AI5, trust 5, eight ranked changes). One commit per item.
Version bumped to 0.2.0. No QNX SDP exists yet: every QNX claim below is `known` (recalled) or `guess`.

## What was done, by item

1. **False positives** (commits 4bba855, b558ebc). Code rules that match a function name now need a plain call: no match on
   `x->f(`, `x.f(`, `Cls::f(`, nor on a declaration/definition (a type precedes the name), nor on a name the same file defines with a body,
   nor on a name declared in an included project header and defined in the project. Ambiguous names (`clone/unshare/setns`,
   `splice/tee/vmsplice/copy_file_range`, `syscall`, `sysinfo`) also need a visible include or macro (`evidence` in the rule data).
   Negative tests for each of the five the judge named, plus method-call negatives on 13 more rules, plus the judge's probe file.
   Re-sample: 60 NEW findings (none of the PD1 30) read by hand, `corpus/PRECISION.md` (per rule, per project, numbers as they are):
   rule did what it says 43/60 = 72%, rule bugs 3/60 = 5%, irrelevant-to-QNX-though-right 14/60 = 23%, plain actionable 4/60 = 7%.
   It found three more rule bugs (continued `#elif` feature test, `/proc/sys` hitting the `/sys` rule, `#define` fallbacks), fixed with tests.
2. **Over-stated claims** (b3474dd). accept4/pipe2/dup3/SOCK_*/MSG_NOSIGNAL/TCP_* no longer called "Linux extensions": "not in POSIX.1-2017,
   check the SDP header; io-sock is BSD-derived (guess)". gettid is explicitly not replaced by pthread_self. Added `shm_open(SHM_ANON)` as the
   memfd analogue (guess), kqueue via io-sock as the epoll analogue (guess), ionotify scoped to resource managers, PEERCRED remedy
   (getpeereid / LOCAL_PEERCRED, MsgReceive info only for native IPC), `linux/*` headers known -> guess and blocker -> major, O_PATH/O_DIRECT,
   AFFINITY, GETRANDOM, SYSINFO, SYSV-IPC wording. `tests/claims.test.ts` pins the wording.
3. **Report** (a7d2fb0). Findings grouped by rule with expandable sites; Start-here top 3 panel; 8 even cards (orphan gone); disclaimer is a one-line
   `<details>`; heat tiles clickable and filtering; absolute-scale toggle (share of total weight); effort is a rough, uncalibrated range scaled by
   rule groups (base minutes, +15% per extra site, cap 4x, shown 0.5x to 1.5x), never a single figure. Verified with a real mouse click in headless
   Chrome over the DevTools protocol (`tests/chrome.test.ts`) and a screenshot read by eye (libev, 1440 wide).
4. **AI loop** (9caeb83). `portdoctor fix <dir> --provider <cmd> --check "<cmd>" --count N`: propose -> schema -> `git apply --check` -> apply on a copy ->
   check (default host `gcc -fsyntax-only -D__QNXNTO__`) -> revert on failure -> re-scan -> before/after -> `fix-report.html`.
   `providers/cli-provider.sh` (runs the command in `PD_LLM_CMD`, exits 3 with a message if absent). Tested end to end with a deterministic stub: demo 4 -> 0 findings.
5. **SARIF and toolchain** (54ad567). `scan --sarif` (2.1.0), `init-toolchain` writes `qnx-toolchain.cmake` (CMAKE_SYSTEM_NAME QNX, qcc/q++, -V variant)
   and a `portability.h` skeleton listing flagged APIs with TODO; it defines nothing it cannot know.
6. **Build awareness** (bd56ae9). compile_commands.json, else CMake/Makefile source lists: files not mentioned get "not in build list?" (heuristic, a
   filter checkbox in the report). Globs/wildcards disable it. `--ignore-preset other-os`, `--no-build-awareness`.
7. **README, examples** (this commit). README updated with honest limits; `examples/` has the demo, stub provider and before/after outputs.

## What passed (measured)

- `node --test tests/` : 163 tests, 163 pass, 0 fail (includes 4 headless-Chrome tests with real mouse events, the fix loop end to end, SARIF, init-toolchain, build awareness).
- Seven corpus scans re-run after each change: libuv 344, dropbear 43, iperf 35, libev 51, cJSON 21, Lua 4, kilo 1 findings (PD1: 516 total; now 499, mostly
  from the identifier and rule-bug fixes). Whole corpus scans in about 10 s.
- The fix demo: 4 findings -> 0 on the patched copy; original untouched; a deliberately broken patch is caught by the check and reverted; a patch with a `..` path is refused.
- `--ignore-preset other-os` on libuv: 344 -> 307 findings.
- No model call anywhere in tests; no network call in the scanner. Wording of the corrected claims is pinned by tests.

## What was NOT verified

- **Anything on QNX.** No SDP, no `qcc`, no target. All `known` claims are recalled; all `guess` claims are unchecked. `-Vgcc_ntoaarch64le` /
  `gcc_ntox86_64`, CMake's `CMAKE_<LANG>_COMPILER_TARGET` behaviour with qcc, `SHM_ANON`, kqueue/`getpeereid` availability in io-sock: not checked.
  The generated `qnx-toolchain.cmake` and `portability.h` were never used with an SDP.
- **The fix loop with a real model.** `providers/cli-provider.sh` was tested only with a fake LLM command and the missing-CLI path; no real model CLI call
  was made, so prompt quality and schema compliance with a real model are untested. The demo's patches come from a stub written for those four lines.
- **The compile check is host gcc syntax only.** It passes patches that use APIs QNX may not have, and it skips Makefile edits.
- **Precision numbers**: one reader (an AI agent), 60 findings, many rules with n of 1 to 3; the three bugs it found were fixed afterwards and the fixed rules were
  not re-sampled. The verdict taxonomy changed from PD1, so PD1 and PD2 numbers are not directly comparable. The identifier-FP fix has no corpus evidence (the corpus
  contains no such case); its evidence is the unit tests and the judge's probe file. False negatives: not measured, and the evidence requirement adds some
  (a call whose header arrives only through a project header or `-D_GNU_SOURCE`).
- **Build awareness**: heuristic. Tested on synthetic projects and run on the corpus; on libuv it flags nothing (its CMake names every platform's files). Variables,
  generated sources, nested subdirectory logic and conditionals are not followed. A compile_commands.json from a Linux build says what Linux compiled, not QNX.
- **`--ignore-preset other-os`** is a filename-token heuristic (opt-in); it can hide a file you needed and was not measured for recall.
- **Effort ranges** are invented constants (base minutes per rule, +15% per site, 0.5x to 1.5x), labelled uncalibrated; no real port was used to calibrate.
- **Report**: Chrome only, desktop width real-click tested; mobile layout, print, no-JS and screen readers were not re-checked after the regroup. Esc closing the help
  dialog is handled in code, not tested by a key press.
- SARIF was checked structurally by tests, not against an external validator or a real CI consumer.
- Node 20 and macOS/Windows still not run.

## Known issues / next

- Replace the host-gcc check with `qcc` (the `--check` hook is ready) once an SDP exists; add `--sdp <QNX_TARGET>` header/symbol verification to turn each `guess` into present/absent (judge change 1, not done: no SDP).
- Cross-file declared-name logic is project-wide only through quote includes; macro-wrapped calls remain false negatives.
- The `evidence` regexes and the `other-os` preset are literals standing in for judgement: a temporary bridge. The replacing judge would be the `propose`-style agent reading the file and the build context; it was not built.
- Corpus reports in `corpus/reports/` are regenerated by `corpus/run.sh` and committed.
