#!/usr/bin/env bash
# Runs every tests/*.test.mjs in isolation with a per-file timeout.
# Usage: scripts/run-tests.sh [timeout_seconds]
#
# Notes:
# - Tests import from dist/, so run `npm run build` first.
# - CURSOR_WORKSPACE is pinned to the repo root so project-path resolution
#   does not wander off to another workspace on the machine.
# - --test-force-exit: some modules keep timers/watchers alive after the
#   tests finish; without it the process would hang.
set -u
cd "$(dirname "$0")/.."

TIMEOUT="${1:-120}"
export CURSOR_WORKSPACE="${CURSOR_WORKSPACE:-$PWD}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-sk-test-placeholder}"
export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-sk-ant-test-placeholder}"

pass=0; fail=0; failed=()

for f in tests/*.test.mjs; do
  out="/tmp/m7-test-out.$$"
  if perl -e 'alarm shift; exec @ARGV' "$TIMEOUT" node --test --test-force-exit "$f" >"$out" 2>&1; then
    echo "OK      $f"; pass=$((pass+1))
  else
    code=$?
    if [ "$code" -eq 142 ]; then echo "TIMEOUT $f"; else echo "FAIL    $f (exit $code)"; fi
    grep -E '✖|not ok|Error' "$out" | head -n 15 | sed 's/^/        /'
    fail=$((fail+1)); failed+=("$f")
  fi
  rm -f "$out"
done

echo
echo "passed: $pass  failed: $fail"
if [ "$fail" -gt 0 ]; then printf '  %s\n' "${failed[@]}"; exit 1; fi
