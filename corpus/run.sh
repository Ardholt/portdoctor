#!/bin/sh
# Re-creates corpus/src (git-ignored) at the pinned commits and regenerates corpus/reports.
set -eu
cd "$(dirname "$0")"
mkdir -p src reports
while read -r name url commit; do
  [ -z "$name" ] && continue
  if [ ! -d "src/$name/.git" ]; then git clone -q "$url" "src/$name"; fi
  git -C "src/$name" -c advice.detachedHead=false checkout -q "$commit" 2>/dev/null || { git -C "src/$name" fetch -q --depth 1 origin "$commit" && git -C "src/$name" -c advice.detachedHead=false checkout -q "$commit"; }
  node ../bin/portdoctor.mjs scan "src/$name" --json -o "reports/$name.json"
  node ../bin/portdoctor.mjs scan "src/$name" --html -o "reports/$name.html"
done <<LIST
cJSON https://github.com/DaveGamble/cJSON 6d9f2443ab071f86e5d9b43025a40929ec41c46c
kilo https://github.com/antirez/kilo 323d93b29bd89a2cb446de90c4ed4fea1764176e
libev https://github.com/enki/libev 93823e6ca699df195a6c7b8bfa6006ec40ee0003
libuv https://github.com/libuv/libuv f08538cca14f73e30c89625e473fea3f5f55e300
iperf https://github.com/esnet/iperf a825693f3090c582970b2d69238289e671d76699
dropbear https://github.com/mkj/dropbear 99baf1828c13e88de048e641d03694bfe8923251
lua https://github.com/lua/lua c42d820bc0c3bc4f2ad536e19d2f05405af10387
LIST
