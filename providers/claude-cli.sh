#!/bin/sh
# PortDoctor provider: asks a local LLM CLI for a patch proposal.
#   stdin : the request JSON from `portdoctor propose|fix` (prompt, schema, finding, window)
#   stdout: ONE JSON object matching the patch schema (the CLI is told to reply with only that)
#   exit 3 with a message on stderr if no LLM CLI is available.
# Default CLI is `claude -p` (prompt on stdin). Override with PD_LLM_CMD, e.g. PD_LLM_CMD="my-llm --stdin".
# Calling a model is YOUR choice and uses YOUR account; PortDoctor itself never calls one and the tests never run this script.
set -u
CMD="${PD_LLM_CMD:-claude -p}"
BIN=${CMD%% *}
if ! command -v "$BIN" >/dev/null 2>&1; then
  echo "claude-cli.sh: '$BIN' not found on PATH; install it or set PD_LLM_CMD to a command that reads a prompt on stdin and prints the reply. No patch was proposed." >&2
  exit 3
fi
if ! command -v node >/dev/null 2>&1; then
  echo "claude-cli.sh: node is required to read the request JSON" >&2
  exit 3
fi
PROMPT=$(node -e '
let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
  const r=JSON.parse(s);
  process.stdout.write(r.prompt+"\n\nJSON schema for your reply:\n"+JSON.stringify(r.schema)+"\n\nReply with the JSON object only, no prose, no code fence.\n");
});')
[ -n "$PROMPT" ] || { echo "claude-cli.sh: empty request on stdin" >&2; exit 3; }
ERR=$(mktemp) || exit 3
trap 'rm -f "$ERR"' EXIT
OUT=$(printf '%s' "$PROMPT" | $CMD 2>"$ERR")
RC=$?
if [ "$RC" -ne 0 ]; then
  # the claude CLI prints its login/rate-limit errors on stdout, so surface both streams
  MSG=$(printf '%s %s' "$(cat "$ERR")" "$OUT" | tr '\n' ' ' | cut -c1-500)
  echo "claude-cli.sh: '$CMD' exited with status $RC: ${MSG:-no output}" >&2
  case "$MSG" in
    *[Ll]ogin*|*[Aa]uthenticat*|*OAuth*|*"Not logged"*) echo "hint: the model CLI is not logged in; run '$BIN' interactively to log in, or set PD_LLM_CMD to another command that reads a prompt on stdin." >&2 ;;
    *[Rr]ate*|*limit*|*REFUSED*|*quota*) echo "hint: the account behind '$BIN' is rate-limited or refused; retry later or set PD_LLM_CMD to another account/command." >&2 ;;
    *) echo "hint: run the provider by hand to see the error: echo hello | $CMD" >&2 ;;
  esac
  exit "$RC"
fi
printf '%s\n' "$OUT"
