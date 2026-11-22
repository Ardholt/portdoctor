#!/bin/bash
# Run INSIDE the SDP jail (SDP env sourced) from the repo root, after the epoll demo was fixed with `fix ... --keep out/after-epoll` (see tools/demo-qcc.sh).
# Builds a QNX 8.0 x86_64 QEMU image (mkqnximage, TCG: no KVM needed) that contains the patched demo server and a client, and starts them at boot.
# If qemu-system-x86_64 is on PATH it boots the image headless (BOOT_SECS, default 120) and keeps the console log; otherwise it records the exact error.
set -u
BIN=out/qnx-bin; OUT=out/qnx-run; rm -rf $BIN $OUT; mkdir -p $BIN $OUT; ABS=$(cd $BIN && pwd)
qcc -Vgcc_ntox86_64 -o $ABS/pd-server out/after-epoll/server.c -lsocket && qcc -Vgcc_ntox86_64 -o $ABS/pd-client examples/qnx-run/client.c -lsocket || { echo "build failed"; exit 1; }
file $ABS/pd-server | sed 's/, BuildID.*//'
cd $OUT
mkqnximage --type=qemu --arch=x86_64 --noprompt --build >../qnx-build.log 2>&1; echo "mkqnximage --build: exit $?"
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
mkqnximage --type=qemu --arch=x86_64 --noprompt --build >../qnx-build2.log 2>&1; echo "mkqnximage --build (with demo): exit $?"; tail -3 ../qnx-build2.log
grep -n "pd-server\|pd-client" output/build/data.build | head -3
ls -la output/disk-qemu output/ifs.bin | awk '{print $5, $9}'
BOOT_SECS=${BOOT_SECS:-120}
if command -v qemu-system-x86_64 >/dev/null 2>&1; then
  qemu-system-x86_64 --version | head -1
  # mkqnximage --run needs bridge networking + sudo (refused in the jail); the same QEMU command with user-mode networking, console (-nographic) to output/qemu.out
  rm -f output/qemu.out
  ( timeout $BOOT_SECS qemu-system-x86_64 -pidfile output/qemu.pid -nographic -m 1G -smp 2 -cpu max \
      -drive file=output/disk-qemu.vmdk,if=ide,id=drv0 -netdev user,id=net0 -device virtio-net-pci,netdev=net0,mac=52:54:00:fd:1d:27 \
      -object rng-random,filename=/dev/urandom,id=rng0 -device virtio-rng-pci,rng=rng0 -kernel output/ifs.bin >output/qemu.out 2>../qnx-run.log </dev/null & )
  t=0; while [ $t -lt $BOOT_SECS ]; do grep -q "PORTDOCTOR DEMO END" output/qemu.out 2>/dev/null && break; sleep 5; t=$((t+5)); done
  echo "-- waited ${t}s (limit ${BOOT_SECS}s)"; sleep 2; pkill -f qemu-system-x86_64
  tr -d '\r' < output/qemu.out | head -200 | tee ../qemu-console.txt
else
  echo "-- boot: mkqnximage --run"; mkqnximage --type=qemu --arch=x86_64 --noprompt --run=-h 2>&1 | tail -5
fi
