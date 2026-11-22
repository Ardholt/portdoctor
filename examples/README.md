# Examples

`demo/` is a 2-file project (`main.c`, `Makefile`) with five findings without the SDP manifest (`pipe2`, `SOCK_NONBLOCK`, a `/dev/shm` path, `-lrt`, and socket code without `-lsocket`) and **three** with it: the SDP has `pipe2` and `SOCK_NONBLOCK`, so those are not problems.

| File | What it is |
|---|---|
| `demo-before.txt`, `demo-before-report.html` | `portdoctor scan examples/demo --no-sdp-manifest` before any fix (PD2 output, 4 findings; the scan now reports 5 without the manifest, 3 with it) |
| `stub-provider.mjs` | a **deterministic stand-in for a model** (fixed fixes for these four rules, declines everything else). No model is called. |
| `demo-fix-output.txt`, `demo-fix-report.html` | `portdoctor fix examples/demo --provider "node examples/stub-provider.mjs" --count 4` (PD2 output): propose, `git apply --check`, apply on a copy, host-gcc syntax check, re-scan |
| `demo-after/` | the patched copy: re-scanning it gives 0 findings |

Reproduce:

```
node bin/portdoctor.mjs fix examples/demo --provider "node examples/stub-provider.mjs" --count 5 --no-sdp-manifest --keep /tmp/demo-after -o /tmp/fix-report.html
```

What this demo shows and what it does not: the loop and the count going to 0 are real. The patches come from a stub that
was written to fit these four lines, so it demonstrates the pipeline, not the quality of any model. The check is **host gcc
`-fsyntax-only`**, not a QNX build; with the default check a `Makefile` change is not checked at all (`skipped`); `--check qcc` checks it with `make -n` and a link probe per `-l` library. Whether `shm_open` / `fcntl`
behave as hoped on QNX 8.0 is not verified.

With a real model: `portdoctor fix <dir> --provider providers/cli-provider.sh --count 3` (set `PD_LLM_CMD` to any CLI that reads the prompt on stdin and writes the reply to stdout; see the script header).
