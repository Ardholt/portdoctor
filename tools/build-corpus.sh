#!/bin/bash
# Run INSIDE the SDP jail: build two real corpus projects for QNX 8.0 and compare with what the scan predicted.
set -u
cd "$(dirname "$0")/.."
PD="./bin/node bin/portdoctor.mjs"; M=data/sdp-8.0-manifest.json
SRC=$PWD/corpus-src
for arch in x86_64 aarch64le; do
  V=gcc_nto$arch
  echo "=== cJSON, CMake with portdoctor init-toolchain --arch $arch (qcc -V$V)"
  rm -rf /tmp/tc /tmp/b-cjson; mkdir -p /tmp/tc
  $PD init-toolchain $SRC/cJSON --arch $arch --out /tmp/tc >/dev/null 2>&1
  ls /tmp/tc | tr '\n' ' '; echo
  echo "-- default options (tests on):"
  if cmake -S $SRC/cJSON -B /tmp/b-cjson -DCMAKE_TOOLCHAIN_FILE=/tmp/tc/qnx-toolchain.cmake >/tmp/cmake.log 2>&1; then echo "  configure OK"; else echo "  configure FAIL"; grep -E "Error|error|CMake Error" /tmp/cmake.log | head -5 | sed 's/^/    /'; fi
  if cmake --build /tmp/b-cjson -j4 >/tmp/make.log 2>&1; then echo "  build OK"; else echo "  build FAIL"; grep -E "error|Error|undefined" /tmp/make.log | head -8 | sed 's/^/    /'; fi
  find /tmp/b-cjson -maxdepth 1 -name 'libcjson*' -o -maxdepth 1 -name 'cJSON_test' | head -5 | while read f; do echo "  $(basename $f): $(file -b $f | cut -c1-80)"; done
  echo "-- tests off (-DENABLE_CJSON_TEST=OFF -DENABLE_CJSON_UTILS=ON):"
  rm -rf /tmp/b-cjson2
  if cmake -S $SRC/cJSON -B /tmp/b-cjson2 -DCMAKE_TOOLCHAIN_FILE=/tmp/tc/qnx-toolchain.cmake -DENABLE_CJSON_TEST=OFF >/tmp/cmake2.log 2>&1 && cmake --build /tmp/b-cjson2 -j4 >/tmp/make2.log 2>&1; then echo "  configure+build OK"; else echo "  FAIL"; grep -E "error|Error|undefined|cannot" /tmp/cmake2.log /tmp/make2.log | head -8 | sed 's/^/    /'; fi
  find /tmp/b-cjson2 -maxdepth 1 -name 'libcjson*' | head -5 | while read f; do echo "  $(basename $f): $(file -b $f | cut -c1-90)"; done
done
echo
echo "=== kilo (Makefile: cc -o kilo kilo.c -Wall -W -pedantic -std=c99)"
for arch in x86_64 aarch64le; do
  rm -rf /tmp/kilo && cp -r $SRC/kilo /tmp/kilo
  if (cd /tmp/kilo && make CC="qcc -Vgcc_nto$arch" >/tmp/kilo.log 2>&1); then echo "  $arch: build OK: $(file -b /tmp/kilo/kilo | cut -c1-70)"; else echo "  $arch: build FAIL"; grep -E "error|undefined" /tmp/kilo.log | head -5 | sed 's/^/    /'; fi
done
echo
echo "=== what the scan predicted (with the SDP manifest)"
for p in cJSON kilo; do $PD scan $SRC/$p --sdp-manifest $M | sed -n 2,5p | sed "s/^/  $p: /"; done
echo
echo "=== Lua (plain Makefile; scan flags 4 findings; build with -DLUA_USE_POSIX -DLUA_USE_DLOPEN, no -ldl, as the SDP has no libdl)"
for arch in x86_64 aarch64le; do
  rm -rf /tmp/lua && cp -r $SRC/lua /tmp/lua
  if (cd /tmp/lua && make CC="qcc -Vgcc_nto$arch -std=gnu99" MYCFLAGS="-DLUA_USE_POSIX -DLUA_USE_DLOPEN" MYLIBS="" MYLDFLAGS="" lua >/tmp/lua.log 2>&1); then echo "  $arch: build OK: $(file -b /tmp/lua/lua | cut -c1-70)"; else echo "  $arch: build FAIL"; grep -E "error|undefined|cannot find" /tmp/lua.log | head -6 | sed 's/^/    /'; fi
done
echo "-- same with the project's own default LIBS (-ldl, as on Linux):"
rm -rf /tmp/lua && cp -r $SRC/lua /tmp/lua && (cd /tmp/lua && grep -n "^LIBS\|^SYSLIBS\|^MYLIBS\|-ldl" makefile | head -5 | sed 's/^/    /'; make CC="qcc -Vgcc_ntox86_64 -std=gnu99" MYCFLAGS="-DLUA_USE_POSIX -DLUA_USE_DLOPEN" MYLIBS="-ldl" lua 2>&1 | grep -E "cannot find|error" | head -3 | sed 's/^/    /')
$PD scan $SRC/lua --sdp-manifest $M | sed -n 2,4p | sed "s/^/  lua scan: /"; $PD scan $SRC/lua --sdp-manifest $M | grep -E "^[A-Za-z].*site" | sed "s/^/  lua scan: /"
