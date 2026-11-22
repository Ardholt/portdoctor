# QNX run (PD5): the patched demo booted and ran on QNX 8.0 under QEMU

**Result: the patched epoll demo server and the client ran on a QNX 8.0 x86_64 image booted in QEMU 8.2.2 (TCG emulation, no KVM, headless). The client printed `PD-CLIENT echo ok: hello from portdoctor`.** The captured console log is the `.txt` file in this folder (36 lines; terminal escape codes stripped, nothing else edited).

What it shows: the server that came out of the recorded fix loop (epoll replaced by a poll loop), compiled with `qcc -Vgcc_ntox86_64`, accepted a loopback TCP connection from the client and echoed the text back on a real QNX kernel (`uname` in the log: `QNX noname 8.0.0 ... x86pc x86_64`). The boot script starts the server, waits 2 s, runs the client; the log shows `=== PORTDOCTOR DEMO START ===` ... `=== PORTDOCTOR DEMO END ===`.

How: `bash tools/qnx-run.sh` in an SDP shell (`BOOT_SECS` sets the limit, default 120). The script builds the image (`mkqnximage --type=qemu --arch=x86_64 --build`, a 150 MB `disk-qemu` and a 10.9 MB `ifs.bin`), adds `pd-server` and `pd-client` to the data partition (`data.build` lists both) and a boot script to `post_start.custom`, then starts QEMU directly with the same arguments `mkqnximage --run` uses, except user-mode networking and the console (headless `-nographic`) redirected to a file. The build log is in [image-build-output.txt](image-build-output.txt).

Not verified / caveats:
- `mkqnximage --run` itself was not used: it wants bridge networking and `sudo`, which the sandbox refuses (`Need to configure networking for QEMU`). The direct QEMU command is in `tools/qnx-run.sh`.
- Emulated x86_64 only (TCG); the aarch64 variant and real hardware were not run. The demo is a loopback echo of one line, not a port of a real project; no tests ran on QNX.
- The boot took under 15 s of waiting here (the wait loop stops once the demo prints its end marker); the load on the host was high, so timing is not a measurement.
- The log also shows `Memory fault (core dumped)` printed by the image's `sshd` start-up step, which the demo does not use; it is in the stock image and was not investigated.
- Two boots were run (the first with the QEMU console flag, the second with the final `tools/qnx-run.sh` command); both printed the echo line. The capture here is the second. Line order of the device start-up messages differs slightly between the two (output buffering).

Earlier (PD4) the image was built but not booted, because QEMU was not installed in the sandbox.
