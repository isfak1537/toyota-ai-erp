#!/usr/bin/env bash
# Runs the Node test suite in a loop and keeps the full output of every failing run, to catch a
# flaky failure that does not reproduce on demand. Logs go OUTSIDE the repo (default ~/erp-flaky-logs).
#
#   npm run test:loop              # 10 runs
#   npm run test:loop -- 30        # 30 runs
#   npm run test:loop -- 30 --stop # stop at the first failure
#
# Each saved log starts with the context that may explain a flake: commit, uncommitted files, Node
# version, load, other node/jest processes on the machine, and open connections to the test database
# are NOT queried (no credentials are read here). Nothing in the log is a secret: the test output
# never prints environment values.
set -u

RUNS="${1:-10}"
STOP=0
[ "${2:-}" = "--stop" ] && STOP=1
DIR="${ERP_FLAKY_LOG_DIR:-$HOME/erp-flaky-logs}"
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$DIR"
cd "$SERVER_DIR" || exit 2

pass=0
fail=0

for i in $(seq 1 "$RUNS"); do
  stamp="$(date +%Y%m%d-%H%M%S)"
  tmp="$(mktemp)"
  npm test >"$tmp" 2>&1
  code=$?

  if [ "$code" -eq 0 ]; then
    pass=$((pass + 1))
    printf 'run %s/%s: pass\n' "$i" "$RUNS"
  else
    fail=$((fail + 1))
    log="$DIR/$stamp-run$i.log"
    {
      echo "== flaky-run context =="
      echo "date:        $(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "run:         $i of $RUNS (exit code $code)"
      echo "commit:      $(git rev-parse --short HEAD 2>/dev/null) on $(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
      echo "uncommitted: $(git status --short 2>/dev/null | wc -l | tr -d ' ') file(s)"
      echo "node:        $(node --version)"
      echo "load avg:    $(uptime | sed 's/.*load averages*: //')"
      echo "other node/jest processes:"
      ps -axo pid,etime,command | grep -E 'node|jest' | grep -v grep | grep -v "test-loop" | cut -c1-160 | head -15
      echo "== test output =="
      cat "$tmp"
    } >"$log"
    printf 'run %s/%s: FAIL -> %s\n' "$i" "$RUNS" "$log"
    [ "$STOP" -eq 1 ] && { rm -f "$tmp"; break; }
  fi

  rm -f "$tmp"
done

printf '\n%s passed, %s failed (logs in %s)\n' "$pass" "$fail" "$DIR"
[ "$fail" -eq 0 ]
