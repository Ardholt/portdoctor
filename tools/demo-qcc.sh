#!/bin/bash
# Run INSIDE the SDP jail (tools/jail.sh bash tools/demo-qcc.sh) from the repo copy under $HOME/work/pd3.
# Shows, on the real QNX 8.0 compiler: original vs fixed, for the PD2 demo (examples/demo) and the epoll demo (examples/demo-epoll).
set -u
cd "$(dirname "$0")/.."
N=./bin/node
PD="$N bin/portdoctor.mjs"
M=data/sdp-8.0-manifest.json
OUT=out; mkdir -p $OUT; rm -rf $OUT/after-epoll $OUT/after-demo; rm -f examples/patches/*.used
q() { # variant, source, outfile -> compile result, then link result with the default libraries (+ -lm)
  if qcc -V$1 -c -o /tmp/q.o -x c $2 >/tmp/q.log 2>&1; then c="compile OK"; else c="compile FAIL: $(grep -E 'error' /tmp/q.log | head -1 | sed 's/^[^ ]* //')"; fi
  if qcc -V$1 -o $3 $2 -lm >/tmp/q2.log 2>&1; then l="link OK"; else l="link FAIL: $(grep -oE 'undefined reference to [^ ]+' /tmp/q2.log | sort -u | head -3 | tr '\n' ' ')"; [ "${c#compile OK}" = "$c" ] && l="link not attempted"; fi
  echo "  qcc -V$1 $2: $c; $l"
}
echo "== qcc: $(qcc -V 2>&1 | grep -c ',gcc_') variants listed; using gcc_ntox86_64 and gcc_ntoaarch64le (gcc 12.2.0)"
echo
echo "== 1. examples/demo (pipe2, SOCK_NONBLOCK, /dev/shm path, -lrt): PD2 flagged 4 findings; PD3 adds a fifth (socket code without -lsocket)"
echo "-- scan without the SDP manifest:"; $PD scan examples/demo | sed -n 2p
echo "-- scan with the SDP manifest:";   $PD scan examples/demo --sdp-manifest $M | sed -n 2,4p
echo "-- ORIGINAL main.c on QNX:"; for v in gcc_ntox86_64 gcc_ntoaarch64le; do q $v examples/demo/main.c /tmp/o1; done
echo "-- ORIGINAL Makefile with -lrt on QNX (make CC=qcc):"
rm -rf /tmp/d1 && cp -r examples/demo /tmp/d1 && (cd /tmp/d1 && make CC="qcc -Vgcc_ntox86_64" 2>&1 | grep -E "error|cannot find|Error" | head -3 | sed 's/^/    /')
echo
echo "== 2. examples/demo-epoll (epoll echo server + -lrt)"
echo "-- scan without / with the SDP manifest:"; $PD scan examples/demo-epoll | sed -n 2p; $PD scan examples/demo-epoll --sdp-manifest $M | sed -n 2,3p
echo "-- ORIGINAL server.c on QNX:"; for v in gcc_ntox86_64 gcc_ntoaarch64le; do q $v examples/demo-epoll/server.c /tmp/o2; done
echo "-- fix loop: recorded patches replayed, check = qcc (compile only), re-scan with manifest"
$PD fix examples/demo-epoll --provider "$N providers/replay.mjs examples/patches/demo-epoll.jsonl" --check qcc --sdp-manifest $M --count 3 --keep $OUT/after-epoll -o $OUT/fix-qcc.html
echo "-- PATCHED server.c on QNX:"; for v in gcc_ntox86_64 gcc_ntoaarch64le; do q $v $OUT/after-epoll/server.c /tmp/o3; done
echo "-- PATCHED project built through its Makefile (make CC=qcc):"
for v in gcc_ntox86_64 gcc_ntoaarch64le; do rm -rf /tmp/d2 && cp -r $OUT/after-epoll /tmp/d2 && (cd /tmp/d2 && if make CC="qcc -V$v" >/tmp/m.log 2>&1; then echo "  make CC='qcc -V$v': OK -> $(file server | sed 's/, BuildID.*//;s/^server: //')"; else echo "  make CC='qcc -V$v': FAIL"; grep -E "error|cannot" /tmp/m.log | head -3 | sed 's/^/    /'; fi); done
echo "-- ORIGINAL project built through its Makefile (make CC=qcc):"
rm -rf /tmp/d3 && cp -r examples/demo-epoll /tmp/d3 && (cd /tmp/d3 && make CC="qcc -Vgcc_ntox86_64" 2>&1 | grep -E "error|cannot find" | head -3 | sed 's/^/    /')
echo
echo "== 3. not run: nothing above was executed on a QNX target (no QEMU, no KVM)."
