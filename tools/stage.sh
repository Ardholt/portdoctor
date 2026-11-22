#!/bin/bash
# copy the repo (without vendor-derived data, corpus sources or .git) into the jail work dir
set -e
cd "$(dirname "$0")/.."
W=$WORK
tar c --exclude=.git --exclude=corpus/src --exclude=node_modules . | sudo -u sandbox user tar x -C $W
sudo -u sandbox user mkdir -p $W/corpus-src
tar c --exclude=.git -C corpus/src cJSON kilo lua | sudo -u sandbox user tar x -C $W/corpus-src
