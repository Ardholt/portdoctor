# Examples

`demo/` is a 2-file project (`main.c`, `Makefile`) with four porting findings: `pipe2`, `SOCK_NONBLOCK`, a `/dev/shm` path, `-lrt`.

| File | What it is |
|---|---|
| `demo-before.txt`, `demo-before-report.html` | `portdoctor scan examples/demo` before any fix: 4 findings |
| `stub-provider.mjs` | a **deterministic stand-in for a model** (fixed fixes for these four rules, declines everything else). No model is called. |
| `demo-fix-output.txt`, `demo-fix-report.html` | `portdoctor fix examples/demo --provider "node examples/stub-provider.mjs" --count 4`: propose, `git apply --check`, apply on a copy, host-gcc syntax check, re-scan |
| `demo-after/` | the patched copy: re-scanning it gives 0 findings |

Reproduce:

```
node bin/portdoctor.mjs fix examples/demo --provider "node examples/stub-provider.mjs" --count 4 --keep /tmp/demo-after -o /tmp/fix-report.html
```

What this demo shows and what it does not: the loop and the count going from 4 to 0 are real. The patches come from a stub that
was written to fit these four lines, so it demonstrates the pipeline, not the quality of any model. The check is **host gcc
`-fsyntax-only`**, not a QNX build; the `Makefile` change is not compiled at all (check `skipped`). Whether `shm_open` / `fcntl`
behave as hoped on QNX 8.0 is not verified.

With a real model: `portdoctor fix <dir> --provider providers/claude-cli.sh --count 3` (uses the `claude` CLI if installed; see the script header).
