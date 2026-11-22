# Precision of the scanner on the corpus (PD2)

**What this is.** 60 findings, none of them among the 30 read in PD1, sampled deterministically (stratified by project,
evenly spaced through each report) from the seven corpus reports, then each one read in its source line by one reader
(`corpus/precision-sample.txt` holds every verdict with a note; `node corpus/precision.mjs` recomputes the tables below).
Sample: libuv 18, dropbear 12, iperf 10, libev 10, cJSON 7, Lua 3 (kilo has one finding and it was already in the old sample).
The sample was drawn from the reports produced by commit `4bba855` (identifier false-positive fix in place) and **before** the three
rule bugs it found were fixed, so the numbers below are the honest pre-fix figures for that sample. After the fixes the three
bad findings no longer appear (regression tests added); the fixed rules were not re-sampled.

**Verdicts.**
- `TP`: a real concern in code a QNX build would reach (project-level build findings, hard-coded compiler).
- `TPf`: the match is right but the file is a Linux-only source (libuv `linux.c`, libev `ev_epoll.c`) that a build selects per OS.
- `TPg`: the match is right but sits inside a Linux-only `#if` or a feature macro (`HAVE_X`, `EV_USE_X`) that a configure step
  would probably leave off on QNX. The scanner shows the guard; it does not decide.
- `INFO`: an info-severity rule fired as designed (Linux `#ifdef` without a QNX branch, UNIX-socket note). Correct, low value.
- `OTHER`: the match is right on the text but irrelevant to a QNX port: another OS's branch (z/OS, Android, FreeBSD, Apple),
  vendored/test/example files, optional developer options, a configure probe that tolerates failure.
- `FP`: the scanner was wrong (rule bug).

**Headline numbers, as they are.**
- Rule did what it says (`TP`+`TPf`+`TPg`+`INFO`): **43/60 = 72%**. PD1's comparable figure on its sample was 20/30 = 67%.
- Rule bugs (`FP`): **3/60 = 5%** (PD1: 4/30 = 13%, before its fixes).
- Irrelevant to a QNX port though textually right (`OTHER`): **14/60 = 23%**. This is the share the scanner cannot know without
  build awareness; `--ignore-preset other-os` and compile_commands.json support (PD2 step 6) address part of it.
- Only **4/60 = 7%** are plain `TP` (reachable, unguarded, no file-level exclusion). Most real concerns in portable projects sit
  behind a guard or in a platform-selected file. That is the honest "ready to act on" figure; read the precision above with it.
- The identifier false positives the judge found (`n->clone()`, a user function `tee`) do **not** occur in this sample, so
  the corpus gives no precision evidence for that fix; its evidence is the negative tests and the probe file in `tests/scan.test.ts`.
  The first fix pass also hid real calls (libev `signalfd`, libuv `epoll_*` in `linux.c`) because of a project-wide
  "declared name" rule; that was caught by diffing old against new reports and narrowed to definitions with a body
  in the same file or in an included project header.

**Three rule bugs found by this sample (all fixed, each with a negative test).**
1. Feature tests on a *continued* `#elif` line (`defined(SO_REUSEPORT)` on line 2 of a backslash-continued directive) counted as a use.
2. `"/proc/sys/kernel/..."` matched the `/sys/` rule (`QNX-PATH-SYS`); the pattern now refuses a word character before `/sys/`.
3. `# define EFD_CLOEXEC O_CLOEXEC` (a fallback macro definition) counted as a use of `EFD_CLOEXEC`.

**Limits.** One reader (an AI agent) judged all 60; no second reader, no inter-rater agreement. Many rules have n of 1 to 3,
so per-rule percentages are anecdotes, not rates. Taxonomy changed from PD1 (it counted guarded matches as `TP`), so the two
samples are not directly comparable. No false-negative measurement.

## Tables

### All findings
| Group | n | TP | TPf | TPg | INFO | OTHER | FP | rule did what it says | rule bug |
|---|---|---|---|---|---|---|---|---|---|
| **all 60** | 60 | 4 | 10 | 15 | 14 | 14 | 3 | 43/60 (72%) | 3/60 (5%) |

### By rule
| Group | n | TP | TPf | TPg | INFO | OTHER | FP | rule did what it says | rule bug |
|---|---|---|---|---|---|---|---|---|---|
| ADV-LINUX-IFDEF | 8 | 0 | 0 | 0 | 8 | 0 | 0 | 8/8 (100%) | 0/8 (0%) |
| ADV-UNIX-SOCKET-IPC | 6 | 0 | 0 | 0 | 6 | 0 | 0 | 6/6 (100%) | 0/6 (0%) |
| API-AFFINITY | 6 | 0 | 0 | 3 | 0 | 3 | 0 | 3/6 (50%) | 0/6 (0%) |
| API-CLONE-NS | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 1/1 (100%) | 0/1 (0%) |
| API-EPOLL | 6 | 0 | 5 | 0 | 0 | 1 | 0 | 5/6 (83%) | 0/6 (0%) |
| API-EVENTFD | 1 | 0 | 0 | 0 | 0 | 0 | 1 | 0/1 (0%) | 1/1 (100%) |
| API-GETRANDOM | 2 | 0 | 0 | 2 | 0 | 0 | 0 | 2/2 (100%) | 0/2 (0%) |
| API-INOTIFY | 3 | 0 | 1 | 2 | 0 | 0 | 0 | 3/3 (100%) | 0/3 (0%) |
| API-SENDFILE | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0/1 (0%) | 0/1 (0%) |
| API-SIGNALFD | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 1/1 (100%) | 0/1 (0%) |
| API-SOCKOPT-LINUX | 4 | 0 | 0 | 3 | 0 | 0 | 1 | 3/4 (75%) | 1/4 (25%) |
| API-SYSCALL | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 1/1 (100%) | 0/1 (0%) |
| API-SYSINFO | 1 | 0 | 1 | 0 | 0 | 0 | 0 | 1/1 (100%) | 0/1 (0%) |
| BLD-AUTOCONF-HOST | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1/1 (100%) | 0/1 (0%) |
| BLD-CMAKE-NO-TOOLCHAIN | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 1/1 (100%) | 0/1 (0%) |
| BLD-FPIC | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0/1 (0%) | 0/1 (0%) |
| BLD-HARDCODED-CC | 4 | 2 | 0 | 0 | 0 | 2 | 0 | 2/4 (50%) | 0/4 (0%) |
| BLD-PIE | 1 | 0 | 0 | 0 | 0 | 1 | 0 | 0/1 (0%) | 0/1 (0%) |
| BLD-SANITIZE | 3 | 0 | 0 | 0 | 0 | 3 | 0 | 0/3 (0%) | 0/3 (0%) |
| BLD-UNAME | 2 | 0 | 0 | 0 | 0 | 2 | 0 | 0/2 (0%) | 0/2 (0%) |
| HDR-LINUX-DIR | 2 | 0 | 0 | 2 | 0 | 0 | 0 | 2/2 (100%) | 0/2 (0%) |
| HDR-SYS-LINUX | 2 | 0 | 1 | 1 | 0 | 0 | 0 | 2/2 (100%) | 0/2 (0%) |
| PATH-SYS | 2 | 0 | 1 | 0 | 0 | 0 | 1 | 1/2 (50%) | 1/2 (50%) |

### By project
| Group | n | TP | TPf | TPg | INFO | OTHER | FP | rule did what it says | rule bug |
|---|---|---|---|---|---|---|---|---|---|
| libuv | 18 | 0 | 6 | 1 | 7 | 3 | 1 | 14/18 (78%) | 1/18 (6%) |
| dropbear | 12 | 0 | 0 | 4 | 6 | 1 | 1 | 10/12 (83%) | 1/12 (8%) |
| iperf | 10 | 0 | 0 | 7 | 0 | 3 | 0 | 7/10 (70%) | 0/10 (0%) |
| libev | 10 | 1 | 4 | 3 | 1 | 0 | 1 | 9/10 (90%) | 1/10 (10%) |
| cJSON | 7 | 2 | 0 | 0 | 0 | 5 | 0 | 2/7 (29%) | 0/7 (0%) |
| lua | 3 | 1 | 0 | 0 | 0 | 2 | 0 | 1/3 (33%) | 0/3 (0%) |
