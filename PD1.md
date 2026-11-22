# PD1: PortDoctor build report

Slice PD1, QNX Global Hackathon (Developer Tooling & Host Tools). Repo: `<repo>` on the build box.
Date: 2026-11-22. Built on a VPS seat; repo work over `ssh the build box` (node v26.13.0, git 2.43, headless Chrome).

## What was built (one commit per step)

1. **Scanner + rules + CLI**: `portdoctor scan <dir> [--json|--html] [-o] [--fail-on] [--ignore] [--rules]`, `rules`, `propose`.
   55 rules as data in `rules/linux-api.json` (39 rules: Linux APIs, headers, `/proc`, `/sys`, QNX advice) and
   `rules/build.json` (16 build rules, 2 of them project-level). Each rule: severity, `known|guess`, scope, pattern, remedy,
   verify note, doc names, positive and negative examples. Comment/string masking for C, `#if` nesting tracker
   (`__QNXNTO__` branches suppressed and counted, Linux-only blocks flagged, other guards recorded not judged).
2. **HTML report** (single file, no external requests): summary cards, heat map (by directory; by file when the tree is flat),
   per-file findings with code context, effort, severity/confidence/text/guard filters, remedies section with anchors,
   light/dark (system + toggle), keyboard shortcuts, skip link, ARIA, not colour-only, print CSS.
3. **Corpus**: cJSON, kilo, libev, libuv, iperf, dropbear, Lua at pinned commits; reports in `corpus/reports/`; licences recorded
   in `corpus/CORPUS.md`; 30 findings read by hand, precision issues listed.
4. **Tests**: `node --test tests/`: 133 tests, all pass (data-driven positive and negative case for every rule, scanner, HTML escaping,
   CLI exit codes, propose).
5. **AI hook**: `propose` builds prompt + patch JSON schema + code window; provider is a pluggable stdin/stdout command; response
   is schema-validated and the patch checked with `git apply --check`. No model is called by PortDoctor.
6. README with what it does, honest limits, how to run; MIT licence.

## What passed (measured)

- `node --test tests/` on the build box, Node 26.13.0: 133 tests, 133 pass, 0 fail (run after the last rule change).
- Seven corpus scans complete: 516 findings over 1,464 files (libuv 352, dropbear 45, iperf 38, libev 55, cJSON 21, Lua 4, kilo 1).
- Hand review of 30 sampled findings: 16 true positives, 4 right-but-file-never-built-on-QNX, 3 other-OS/vendored, 3 info noise,
  4 rule bugs (fixed, each with a regression test). Strict precision 16/30 (53%) on that sample, 20/30 if file-level platform
  selection is not held against the rule. Small sample, one reader.
- HTML: rendered in headless Chrome (light and dark) and read as screenshots; page JS parses; filtering confirmed to change the
  count in a DOM dump on the libuv report (352 shown at load; info toggle plus a heat-map tile click gave 184).
- `propose` end-to-end with a stub provider in the tests: request piped in, patch validated, `git apply --check` accepted/rejected correctly,
  path escape refused, provider failure gives exit 3.
- No network calls in the tool (corpus cloning is a separate script). No model call anywhere. No secrets or client data in the repo.

## What was NOT verified

- **Anything on QNX.** No SDP, no `qcc`, no target. No finding or remedy was compiled or run on QNX. No claim of compile-verified results.
- **Every QNX-side claim.** `known` = recalled from public docs (for example `qcc`, `__QNXNTO__`, `_cmdname`, `ThreadCtl` runmask,
  `ionotify`, `/dev/shmem`, CMake's `QNX` system name); `guess` = unverified (epoll/inotify/eventfd/timerfd/signalfd absence on 8.0,
  `-lrt`/`-lpthread`/`-ldl` not existing, flags qcc rejects, sockopt availability). Doc references are page names, not fetched.
  Rule set must be audited against SDP headers and libs once available (`grep $QNX_TARGET/usr/include`, `nm -D`).
- **Remedies**: described, never applied or tested. Patch proposals would still need `qcc` and the project's own tests.
- **Recall**: no false-negative measurement. Rules were written from knowledge, not tuned against a gold set of real QNX port patches
  (the qnx-ports repos were not consulted; their existence is itself unconfirmed).
- **Precision**: only the 30-finding sample, read once by one reader, taken before the fixes; post-fix output was not re-sampled.
  Per-rule precision is unmeasured. Platform-selected files (libuv `linux.c`, libev `ev_epoll.c`) are still over-reported.
- **Effort estimates**: invented minute values per rule, not calibrated against any real port.
- **Platforms**: only Linux/Node 26 run. macOS and Windows not run. Older Node (the VPS has Node 20) cannot run it (needs type stripping, 22.18+).
- **Accessibility**: no screen reader pass, no automated audit (axe/Lighthouse), no real keyboard-only walkthrough; shortcut handlers are
  reviewed in code and the filter path exercised once. Contrast values chosen by eye, not computed. Only desktop widths screenshotted.
- **Autotools/CMake handling is line-based**: multi-line `target_link_libraries(...)` calls are only caught when the library is on the same line.
- **AI hook**: interface only; the prompt's quality against any real model is untested.

## Known issues / next

- A judge step for "is this file built for the target / is this guard on" (the `propose`-style AI agent with the build context) would
  replace the current honest-but-blunt `--ignore` and guard display. This is deliberately not hard-coded.
- Once the SDP arrives: audit each `guess` rule, add `nm -D`-backed availability data, calibrate effort, run `qcc` over proposed patches.
- Corpus commit history: the report/heat-map tweak landed inside the corpus commit (amend slip); no content lost.
