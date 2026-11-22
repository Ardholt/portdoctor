# Screen-capture shot list (2:30)

Real commands only, one terminal plus one browser window, repo root as the working directory. Everything below was run for this slice; the expected lines are what the tool printed. Do **not** claim anything ran on QNX.
Record the terminal at about 110 columns, the browser at 1440x900. Pre-open an SDP shell (`source <sdp>/qnxsdp-env.sh`) in a second terminal tab for shot 4.

| Time | Screen | Say / show | Command |
|---|---|---|---|
| 0:00-0:12 | terminal, the README's first screen | "PortDoctor finds what blocks a Linux C project on QNX 8.0, checks it against a real SDP, and drives a model to fix it. First the limits: nothing here ran on a QNX target; checks are compile-only." | `head -20 README.md` |
| 0:12-0:40 | terminal | **Without the SDP manifest** the scan is text matching: 5 findings on a two-file demo, including `pipe2` and `SOCK_NONBLOCK`. **With the bundled manifest** (the default) it is 3: the SDP has `pipe2` and `SOCK_NONBLOCK`, so they are not problems. | `node bin/portdoctor.mjs scan examples/demo --no-sdp-manifest \| sed -n 2p` then `node bin/portdoctor.mjs scan examples/demo \| sed -n 1,6p` (expect "5 findings in 5 rule groups" then "3 findings in 3 rule groups" and the `SDP check (8.0.0.00141...)` line) |
| 0:40-1:15 | browser, `report.html` | The first screen: the *Where* strip (which files carry the work), the verified / known / guess bar, the chip on every finding. Press a tile in the strip: the list filters. Open *Start here: top 3*, then the epoll group: file:line, remedy, "verified by SDP: absent". Press `t` for dark mode. | `node bin/portdoctor.mjs scan examples/demo-epoll --html -o report.html` then open it (expect 12 findings in 4 rule groups, 9 blockers) |
| 1:15-1:50 | SDP terminal | The fix loop with a model's patches (replayed recordings: say so), checked by the QNX compiler. Show `QNX-API-EPOLL server.c APPLIED check=pass` and the Makefile step: `check=pass`, with the `make -n` / link-probe line. The original fails on `sys/epoll.h`. | `node bin/portdoctor.mjs fix examples/demo-epoll --provider "node providers/replay.mjs examples/patches/demo-epoll.jsonl" --check qcc --count 3 -o fix.html` (expect 12 -> 0, errors 1->0 on `server.c`; steps 1-2 applied) |
| 1:50-2:05 | terminal | The live-model run, honestly: three corpus fixes, one clean qcc pass, two blocked by errors already in the files. | `sed -n 1,25p examples/live-fixes/README.md` |
| 2:05-2:15 | terminal | SARIF for CI and IDEs. | `node bin/portdoctor.mjs scan examples/demo-epoll --sarif -o portdoctor.sarif && head -12 portdoctor.sarif` |
| 2:15-2:30 | terminal | What did not work, so the viewer knows: the QNX image with the patched demo was built (`mkqnximage`), the boot did not happen because QEMU is not installed in the sandbox; exact error is in the repo. Close: `node --test tests/` result. | `cat examples/qnx-run/README.md \| head -12` then `node --test tests/ 2>&1 \| tail -8` |

**If the QEMU boot is later made to work** (see `examples/qnx-run/README.md`), replace the 2:15 beat with the captured console log: `PD-CLIENT echo ok: hello from portdoctor`. Until then it is not shown and not claimed.

Capture notes: use a fresh clone (`git clone https://github.com/Ardholt/portdoctor`), Node 22.18+, no network needed after the clone. The replayed patches are recordings of a model's replies; say "recorded" on screen at 1:15.
