# Fixture corpus

Seven small-to-medium open-source C projects were cloned (shallow, pinned commit) and scanned.
The sources are **not** committed (`corpus/src/` is git-ignored); `corpus/run.sh` re-creates them at the pinned
commits and regenerates `corpus/reports/*.html|json`. Reports quote short code excerpts from these projects under
their licences below. No QNX SDP was used: every finding is a static text match, nothing was compiled for QNX.

| Project | Commit | Licence (from the repo's own licence text) | Files scanned | Findings (blocker/major/minor/info) |
|---|---|---|---|---|
| [cJSON](https://github.com/DaveGamble/cJSON) | 6d9f244 | MIT | 110 | 0/0/14/7 |
| [kilo](https://github.com/antirez/kilo) | 323d93b | BSD-2-Clause | 2 | 0/0/0/1 |
| [libev](https://github.com/enki/libev) | 93823e6 | BSD-2-Clause (dual with GPL) | 15 | 33/14/0/8 |
| [libuv](https://github.com/libuv/libuv) | f08538c | MIT | 387 | 95/62/43/152 |
| [iperf](https://github.com/esnet/iperf) | a825693 | BSD-3-Clause (LBNL variant) | 48 | 6/21/10/1 |
| [dropbear](https://github.com/mkj/dropbear) | 99baf18 | MIT-style (bundled libtomcrypt/libtommath are public domain/Unlicense) | 832 | 3/9/12/21 |
| [Lua](https://github.com/lua/lua) | c42d820 | MIT (notice in `lua.h`) | 70 | 0/0/3/1 |

Counts are after the precision fixes described below (516 findings total; before the fixes there were 555).

## Hand review of 30 findings

`node corpus/sample.mjs` picks a deterministic stratified sample (libuv 8, dropbear 6, iperf 6, libev 6, cJSON 2, Lua 1,
kilo 1) from the **first** run, i.e. before any fix. Each was read in its source line by hand. Verdicts:

- **TP** = a genuine item a porter would need to look at.
- **TP-file** = the match is right, but the file is only built for Linux (platform selected by the build system), so on a QNX build it is never compiled.
- **Other-OS** = file/build script belongs to another platform or is a vendored test fixture; irrelevant to a QNX port.
- **Rule bug** = the scanner was wrong; fixed.
- **Noise** = informational, correct but low value.

| # | Project | Location | Rule | Verdict |
|---|---|---|---|---|
| 1 | libuv | src/unix/core.c:98 | SYSCALL (`gettid` via syscall, inside `#if __linux__`) | TP |
| 2 | libuv | src/unix/linux.c:2554 | INOTIFY | TP-file |
| 3 | libuv | src/unix/random-sysctl-linux.c:71 | SYSCALL | TP-file |
| 4 | libuv | src/unix/os390-syscalls.c:165 | SYSV-IPC | Other-OS |
| 5 | libuv | src/unix/linux.c:1687 | CLOCKS (`CLOCK_MONOTONIC_COARSE`) | TP |
| 6 | libuv | include/uv/unix.h:427 | LINUX-IFDEF (`defined(__linux__) && defined(__sparc__)`) | Noise |
| 7 | libuv | src/unix/pipe.c:127 | UNIX-SOCKET-IPC | Noise (by design) |
| 8 | libuv | test/task.h:429 | LINUX-IFDEF on `#if !defined(__linux__)` | **Rule bug** |
| 9 | dropbear | src/dbutil.c:761 | SYSCALL (`SYS_clock_gettime`, Linux-guarded) | TP |
| 10 | dropbear | src/dbrandom.c:281 | PATH-PROC (`/proc/net/tcp`, Linux-guarded) | TP |
| 11 | dropbear | libtomcrypt/makefile.mingw:19 | HARDCODED-CC | Other-OS |
| 12 | dropbear | src/netio.c:622 | SOCKOPT-LINUX (`SO_BINDTODEVICE`, under a feature macro) | TP (guarded) |
| 13 | dropbear | src/dbrandom.c:270 | LINUX-IFDEF | TP |
| 14 | dropbear | src/netio.c:245 | UNIX-SOCKET-IPC | Noise (by design) |
| 15 | iperf | src/flowlabel.h:31 | HDR-LINUX-DIR (`<linux/types.h>`) | TP |
| 16 | iperf | src/iperf_api.c:5566 | AFFINITY (`cpu_set_t`) | TP |
| 17 | iperf | src/iperf_api.c:5631 | AFFINITY (`CPU_SET`) | TP (same fix as #16, counted again) |
| 18 | iperf | src/net.c:788 | SENDFILE | TP |
| 19 | iperf | src/main.c:86 | SCHED-LINUX (`setpriority`) | **Rule bug** (`setpriority` is POSIX XSI, not Linux-only) |
| 20 | iperf | src/tcp_info.c:138 | SOCKOPT-LINUX on `#elif ... defined(TCP_INFO)` | **Rule bug** (a feature test in a NetBSD branch is not a use) |
| 21 | libev | ev.c:389 | SYSCALL (`clock_gettime` fallback macro) | TP |
| 22 | libev | ev.c:4340 | INOTIFY | TP |
| 23 | libev | ev_epoll.c:105 | EPOLL | TP-file (one backend of many) |
| 24 | libev | ev_epoll.c:218 | EPOLL | TP-file |
| 25 | libev | ev.c:435 | EVENTFD on `# ifndef EFD_NONBLOCK` | **Rule bug** (same cause as #20) |
| 26 | libev | ev.c:2598 | SIGNALFD | TP |
| 27 | cJSON | Makefile:15 | LDFLAGS (`-Wl,-soname=`) | TP |
| 28 | cJSON | tests/unity/extras/fixture/test/Makefile:3 | HARDCODED-CC (`clang`) | Other-OS (vendored test fixture) |
| 29 | Lua | makefile:80 | LDL (`MYLIBS= -ldl`) | TP |
| 30 | kilo | kilo.c:37 | LINUX-IFDEF | TP |

Tally: TP 16, TP-file 4, Other-OS 3, Noise 3, **Rule bug 4**. Strict precision (the line is a real QNX concern in a file
that would be built) is 16/30 = 53%. Counting TP-file as correct matches (the rule did what it says) it is 20/30 = 67%.
These are small-sample figures from one reader; they are not a benchmark.

## Precision issues found

1. **Rule bugs (fixed in this build).** Feature-test lines (`#ifndef EFD_NONBLOCK`, `defined(TCP_INFO)`) were counted as
   uses; `QNX-ADV-LINUX-IFDEF` fired on `!defined(__linux__)`; `setpriority/getpriority` were wrongly listed as Linux-only.
   Each fix has a negative test. The sample is no longer independent of the rules after these fixes; the post-fix counts
   above were not re-sampled by hand.
2. **Platform selection by the build system is invisible to the scanner.** libuv/libev ship `linux.c`, `ev_epoll.c`,
   `os390-*.c` and pick one per OS in the build. A scanner reading text cannot know which are compiled on QNX, so
   Linux-only files are reported as blockers. Mitigations offered: `--ignore <regex>` (the user says which paths are other-OS),
   and `#if __linux__` guards are recorded on each finding. Not solved: deciding automatically that a file is never built.
   This is a judgement call about intent and build configuration, so it is left to the user or to the `propose` AI step,
   not to a hard-coded filename list.
3. **Findings inside non-platform guards (`#ifdef HAVE_X`, `#if EV_USE_EPOLL`) are listed at full severity** with the guard text
   shown. PortDoctor does not decide whether the macro is set on QNX. This overstates effort for portable projects (libev,
   iperf, dropbear) whose Linux paths are already optional. Expect over-reporting there.
4. **Counts are per line.** Multi-line Linux-only blocks (e.g. every `CPU_SET` line in iperf) yield many findings for one fix;
   the effort heuristic charges 30% for repeats of the same rule in a file, which is a guess, not a measurement.
5. **Info rules add volume.** `QNX-ADV-UNIX-SOCKET-IPC` and `QNX-ADV-LINUX-IFDEF` account for most of libuv's 152 info findings.
   They are there for completeness; filter with the severity chips.
6. **Vendored third-party trees** (dropbear's libtomcrypt, cJSON's unity) are scanned like first-party code.
7. **Not checked at all:** false negatives. Nothing here measures what the scanner missed (macro-wrapped calls,
   `dlsym`-style use, code generated at configure time, assembly, Python/other languages in the build).
