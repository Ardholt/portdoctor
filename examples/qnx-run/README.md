# QNX run attempt (PD4 item 3): image built, boot NOT done

**Result: nothing was run on QNX. QEMU is not installed in the SDP sandbox, so the boot step could not start.** What did work, in the sandbox with the real SDP 8.0 build 141:

- `mkqnximage --type=qemu --arch=x86_64 --build` builds a QNX 8.0 x86_64 image: a 150 MB `disk-qemu` and a 10.9 MB boot `ifs.bin` (exit 0).
- `tools/qnx-run.sh` compiles the **patched** epoll demo server (`examples/demo-epoll` after the recorded fix loop) and `examples/qnx-run/client.c` with `qcc -Vgcc_ntox86_64 ... -lsocket`
  (ELF for QNX, interpreter `/usr/lib/ldqnx-64.so.2`), adds both to the image's data partition (`data.build` lists `pd-server` and `pd-client`) and appends a boot script to `post_start.custom`:
  start the server, wait 2 s, run the client, print `PD-CLIENT echo ok: hello from portdoctor` if the epoll replacement (poll loop) echoed correctly. The log is in [image-build-output.txt](image-build-output.txt).
- The boot itself: `mkqnximage --run=-h` stops with the exact message **`Can't find qemu-system-x86_64, perhaps you need to install QEMU.`** Also: no `/dev/kvm` on this host (nested TCG emulation would have been used; speed unknown, untested).

**What Ops would need** (one change, outside this repository, not made here): the package `qemu-system-x86` (the host's apt candidate is 1:8.2.2+ds-0ubuntu1.18, not installed) visible inside the no-network sandbox, which means installing it on the host or adding the binaries to the sandbox image.
Then, from the repo root in an SDP shell: `bash tools/qnx-run.sh`. It boots the image headless with `mkqnximage --run=-h` (QEMU, UART console written to `output/qemu.out`) and prints the UART log; the line to look for is `PD-CLIENT echo ok`.
If the boot works but the client fails, that is a real finding about the patched loop on QNX, which is what this step is for.
Unknown until it is tried: whether QNX 8.0 boots under TCG at all in this setup, how long it takes (the script waits 100 s), and whether `lo0` is up for the loopback connection at the time the boot script runs.
