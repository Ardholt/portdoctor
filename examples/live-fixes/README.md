# Live model fixes on three corpus projects (PD4)

Three findings on three different files, each fixed by a real model reply and checked by the SDP compiler. **Who was the model:** the CLI provider (`providers/claude-cli.sh`)
is refused on every host available (`Not logged in`), so the model was the assistant that built this slice, Claude Sonnet 5.5 (`claude-sonnet-5-5`), answering from the exact request
the loop built. Full prompts, model name and raw replies: [TRANSCRIPTS.md](TRANSCRIPTS.md). The replies were replayed with `providers/replay.mjs` inside the sandbox (no network there).
Reproduce the check: `bash tools/live-fix-check.sh` in an SDP environment; its output is [qcc-check-output.txt](qcc-check-output.txt).

Each project is first configured with the SDP's qcc (`./configure --host=x86_64-pc-nto-qnx8.0.0 CC="qcc -Vgcc_ntox86_64"`), because without the generated `config.h` every compile stops at the first include.

| project / file | finding | patch (model's choice) | qcc errors before / after | what that proves | what it does not |
|---|---|---|---|---|---|
| libev `ev.c` | QNX-API-EVENTFD | force `EV_USE_EVENTFD 0` on `__QNXNTO__` | 0 / 0, check **pass** | the patched file compiles on qcc for QNX | the original compiled too once configured: libev's own configure had already switched eventfd off, so the finding was moot at compile level and the patch is a no-op for qcc. The re-scan still reports the eventfd line (50 -> 50) |
| dropbear `src/svr-main.c` | QNX-API-PRCTL | add `#elif defined(__QNXNTO__)` with `pthread_setname_np()` | 4 / 4, check **no-worse** | the new call compiles with no implicit-declaration warning, so `pthread_setname_np` is visible with this include set | 4 pre-existing errors (`compat.h` redeclares `htole64` & co., which QNX defines as macros) hide anything else; the scanner did not predict them. Re-scan 45 -> 45 (the Linux `prctl` line is kept on purpose) |
| iperf `src/net.c` | QNX-API-SENDFILE | exclude `__QNXNTO__` from `HAVE_SENDFILE` | 1 / 1, check **no-worse** | the patch applies and does not add an error | the file cannot compile on QNX at all because `portable_endian.h` includes `<endian.h>` (absent from the SDP); the check is blocked by that one error. Re-scan 42 -> 39. The model marked this reply `needsHuman: true` |

Verdict, plainly: the loop ran live-model-shaped input end to end on three real projects and the check is real qcc, but **one clean pass, two blocked by pre-existing errors; none was run on a target**,
and the clean pass is for a patch that changed nothing the compiler sees. The check is only as informative as the baseline file is compilable, which is why the report now shows before/after error counts.

The provider failure used to print an empty `provider exit 1:`; it now prints the CLI's own message (this CLI reports login errors on stdout) and a hint:
`claude-cli.sh: 'claude -p' exited with status 1: Not logged in · Please run /login` / `hint: the model CLI is not logged in; ...`.
