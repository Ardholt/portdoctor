#!/bin/sh
# PortDoctor provider wrapper: calls another provider (default providers/claude-cli.sh) and appends request+response to $PD_RECORD (JSONL).
# usage: PD_RECORD=patches.jsonl portdoctor fix <dir> --provider "sh providers/record.sh" ...
set -u
HERE=$(dirname "$0")
REQ=$(cat)
OUT=$(printf '%s' "$REQ" | ${PD_INNER:-sh "$HERE/claude-cli.sh"}) || exit $?
printf '%s' "$REQ" | PD_OUT="$OUT" PD_RECORD="${PD_RECORD:?set PD_RECORD}" node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);
require("fs").appendFileSync(process.env.PD_RECORD,JSON.stringify({ruleId:r.finding.ruleId,file:r.finding.file,line:r.finding.line,response:process.env.PD_OUT})+"\n")})'
printf '%s' "$OUT"
