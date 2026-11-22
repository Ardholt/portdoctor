# SDP 8.0 facts (measured in the sandbox jail, 2026-11-22)

- SDP: QNX Software Development Platform 8.0, Stable Build 141 (com.qnx.qnx800/8.0.0.00141T202311271501L; build id from the operator, not read back from a file).
- Host: linux x86_64 (host/linux/x86_64). Compiler: qcc driver, gcc 12.2.0 "x86_64-pc-nto-qnx8.0.0-gcc (QNX8.0.0-ra7e8d3cd2255b7b0fd7ed75b5fd7082edd813c9d-1008) 12.2.0".
- `qcc -V` targets: gcc_ntox86_64 (default; also _gpp, _cxx) and gcc_ntoaarch64le (also _gpp, _cxx), all 12.2.0. `qcc -version` is not an option here ("unknown option"); `qcc -V` lists versions.
- Target triples: x86_64-pc-nto-qnx8.0.0, aarch64-unknown-nto-qnx8.0.0. Predefined: __QNXNTO__ 1, __QNX__ 800, __x86_64__ 1.
- Targets present under $QNX_TARGET: x86_64, aarch64le (both with lib/ and usr/lib/).
- Real compile+link of a hello world with both -V targets succeeds (ELF 64-bit, interpreter /usr/lib/ldqnx-64.so.2).
- Link probes on x86_64: -lsocket OK, -lm OK, -lc++ OK, -lregex OK; -lrt, -lpthread, -ldl, -lnsl, -lutil, -lresolv all FAIL ("cannot find -lX").
- No KVM (/dev/kvm absent), no QEMU installed on the box: no run-on-target tests; everything is compile/link/symbol evidence.
