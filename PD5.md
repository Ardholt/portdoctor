# PD5: final wording, and the QNX boot

## What changed
1. **Neutral wording.** No vendor or model names remain in the text, in the committed outputs or in the tests; each is now "a model" / "model provider". the provider script, formerly named after one vendor's CLI, is now `providers/cli-provider.sh` (references updated in the README, PD2-PD4, examples, `record.sh`, the test). Any CLI that reads the prompt on stdin and writes the reply to stdout works. **One behaviour change:** the script used to default to one named CLI; with no vendor name allowed it now requires `PD_LLM_CMD` and exits 3 with a message if it is unset. The wording stays truthful: the live-fix replies were written by a model in the building session, recorded and replayed; no CLI ran. The live-fix checks were not re-run and no result was altered.
2. **QEMU boot (item 3).** `tools/qnx-run.sh` now starts QEMU directly (TCG, headless, user-mode networking, `BOOT_SECS` limit, polls for the demo's end marker) because `mkqnximage --run` needs bridge networking and sudo, which the jail refuses. The patched epoll demo server and the client ran on the QNX 8.0 x86_64 image and the client printed `PD-CLIENT echo ok: hello from portdoctor`. The console capture is the `.txt` file in `examples/qnx-run/` (file name per the brief); `examples/qnx-run/README.md`, the main README and `VIDEO.md` (the QEMU beat is now a real beat, 2:15-2:40) were updated.

## What passed
- `node --test tests/`: 183 pass, 0 fail (run after the rename, before the boot-script change; that change is a shell script the tests do not touch).
- The secrets/host grep from the brief (case-insensitive, all seven terms) over the tree: 0 hits. Over `git log -p` of `main`: 0 content hits; the only 2 matching lines are the diff headers that carry the capture file name.
- QEMU boot: 2 boots, both printed the echo line (about 15 s wait each, under a host load of about 90).

## What was NOT verified
- The vendor grep from the brief gives 0 hits for every vendor name. The three-letter substring that is the last term of that grep still matches 10 lines that are not vendor names: `TIOCGPTN` inside libuv's own source quoted in three corpus reports, and `gpt_guid.h` (a QNX SDP header) in `data/sdp-8.0-manifest.json`. They are data from the third-party source and the SDP; editing them would alter results, so they are left.
- The file name of the console capture contains a word on the brief's host-grep list; its content and every other file do not.
- Git history (older commits, `git log -p`) was not rewritten for vendor names; only the tree was reworded. Run the vendor grep on history before publishing if that matters.
- Only emulated x86_64 (TCG) was booted: not aarch64, not hardware. The demo is one loopback echo line, not a port of a real project; no tests ran on QNX. `mkqnximage --run` itself was not used. The image's sshd start-up prints `Memory fault (core dumped)`, not investigated (the demo does not use it).
- Nothing was pushed.
