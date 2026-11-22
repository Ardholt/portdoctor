#!/bin/bash
# Run INSIDE the SDP jail (SDP env sourced) from the repo root, after the epoll demo was fixed with `fix ... --keep out/after-epoll` (see tools/demo-qcc.sh).
# Builds a QNX 8.0 x86_64 QEMU image (mkqnximage, TCG: no KVM needed) that contains the patched demo server and a client, and starts them at boot.
# If qemu-system-x86_64 is on PATH it boots the image headless for 120 s and keeps the UART log; otherwise it records the exact error.
set -u
BIN=out/qnx-bin; OUT=out/qnx-run; rm -rf $BIN $OUT; mkdir -p $BIN $OUT; ABS=$(cd $BIN && pwd)
qcc -Vgcc_ntox86_64 -o $ABS/pd-server out/after-epoll/server.c -lsocket && qcc -Vgcc_ntox86_64 -o $ABS/pd-client examples/qnx-run/client.c -lsocket || { echo "build failed"; exit 1; }
file $ABS/pd-server | sed 's/, BuildID.*//'
cd $OUT
mkqnximage --type=qemu --arch=x86_64 --noprompt --build >build.log 2>&1; echo "mkqnximage --build: exit $?"
cat >> local/snippets/data_files.custom <<EOT
[perms=0755] pd-server=$ABS/pd-server
[perms=0755] pd-client=$ABS/pd-client
EOT
cat >> local/snippets/post_start.custom <<'EOT'
echo "=== PORTDOCTOR DEMO START ==="
uname -a
/data/pd-server &
sleep 2
/data/pd-client
echo "=== PORTDOCTOR DEMO END ==="
EOT
mkqnximage --type=qemu --arch=x86_64 --noprompt --build >build2.log 2>&1; echo "mkqnximage --build (with demo): exit $?"; tail -3 build2.log
grep -n "pd-server\|pd-client" output/build/data.build | head -3
ls -la output/disk-qemu output/ifs.bin | awk '{print $5, $9}'
if command -v qemu-system-x86_64 >/dev/null 2>&1; then
  qemu-system-x86_64 --version | head -1
  timeout 120 mkqnximage --run=-h >run.log 2>&1; sleep 100; cat output/qemu.out | tr -d '\r' | head -80
else
  echo "-- boot: mkqnximage --run"; mkqnximage --type=qemu --arch=x86_64 --noprompt --run=-h 2>&1 | tail -5
fi
