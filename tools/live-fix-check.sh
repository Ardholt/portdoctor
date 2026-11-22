#!/bin/bash
# Run INSIDE the SDP jail (SDP env sourced) from the repo root: applies the three recorded live-model patches (examples/live-fixes/) and checks each with qcc.
# Each corpus project is first configured with the SDP's qcc so the generated config headers exist (otherwise the first compile error is always "config.h: No such file").
set -u
N=node; PD="$N bin/portdoctor.mjs"; M=data/sdp-8.0-manifest.json
W=out/live; rm -rf $W; mkdir -p $W/cfg; rm -f examples/live-fixes/*.used
for p in libev dropbear iperf; do
  cp -r corpus/src/$p $W/cfg/$p
  (cd $W/cfg/$p && ./configure --host=x86_64-pc-nto-qnx8.0.0 CC="qcc -Vgcc_ntox86_64" >configure.log 2>&1; echo "configure $p: exit $?")
done
(cd $W/cfg/dropbear && make default_options_guard.h >/dev/null 2>&1; printf '#define DROPBEAR_SVR_PASSWORD_AUTH 0\n#define DROPBEAR_SVR_DROP_PRIVS 0\n#define DROPBEAR_SVR_MULTIUSER 0\n#define DROPBEAR_SVR_LOCALSTREAMFWD 0\n' > localoptions.h)
declare -A FLAGS=( [libev]="" [dropbear]="-DLOCALOPTIONS_H_EXISTS -Ilibtomcrypt/src/headers -Ilibtommath" [iperf]="-Isrc" )
declare -A FILE=( [libev]=ev.c [dropbear]=src/svr-main.c [iperf]=src/net.c )
declare -A RULE=( [libev]=QNX-API-EVENTFD [dropbear]=QNX-API-PRCTL [iperf]=QNX-API-SENDFILE )
for p in libev dropbear iperf; do
  f=${FILE[$p]}; echo; echo "=== $p: ${RULE[$p]} in $f"
  for d in $W/cfg/$p; do
    echo "-- baseline (original code), qcc -Vgcc_ntox86_64 -c $f:"
    (cd $d; qcc -Vgcc_ntox86_64 -c -o /dev/null -I$(dirname $f) -I. ${FLAGS[$p]} -x c $f 2>&1 | grep -E "error" | sed 's/^/    /' | cut -c1-170 | head -6)
  done
  $PD fix $W/cfg/$p --provider "$N providers/replay.mjs examples/live-fixes/live-fixes.jsonl" --rule ${RULE[$p]} --count 1 --check qcc --qcc-flags "${FLAGS[$p]}" --sdp-manifest $M --keep $W/after-$p -o $W/$p.html --json > $W/$p.json 2>/dev/null
  $N -e "const r=JSON.parse(require('fs').readFileSync('$W/$p.json','utf8'));for(const s of r.steps){console.log('-- loop result:',s.status,'| check:',s.check?.status,'| qcc errors before/after:',s.check?.baselineErrors+'/'+s.check?.errors,'| findings',s.findingsBefore,'->',s.findingsAfter);console.log('   model confidence:',s.confidence,'needsHuman:',s.needsHuman);console.log((s.check?.output||'').split('\n').slice(0,4).map(x=>'   qcc: '+x.slice(0,160)).join('\n'))}"
  echo "-- patched file after the fix:"; (cd $W/after-$p; qcc -Vgcc_ntox86_64 -c -o /dev/null -I$(dirname $f) -I. ${FLAGS[$p]} -x c $f 2>&1 | grep -E "error" | sed 's/^/    /' | cut -c1-170 | head -6; echo "    errors: $(qcc -Vgcc_ntox86_64 -c -o /dev/null -I$(dirname $f) -I. ${FLAGS[$p]} -x c $f 2>&1 | grep -c 'error')")
done
