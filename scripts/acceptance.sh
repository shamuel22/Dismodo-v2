#!/usr/bin/env bash
# Checks the brief's acceptance criteria A1–A11 (see docs/ACCEPTANCE.md).
# Usage: pnpm acceptance            (offline checks: tests, packages, history)
#        LIVE=1 pnpm acceptance     (also the MCP end-to-end against a running API; needs DISMODO_API_KEY)
set -euo pipefail
cd "$(dirname "$0")/.."
pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; exit 1; }

echo "A1, A2, A4–A10 — automated test suites (engine, adaptation, API against Postgres, MCP)"
pnpm -s test >/tmp/dismodo-acceptance-tests.log 2>&1 && pass "all test suites pass" || { tail -30 /tmp/dismodo-acceptance-tests.log; fail "test suites"; }

echo "A1 — valid packages import; incompatible ones fail with understandable errors"
for p in experiences/parts-of-a-whole/experience.json examples/acme-onboarding/experiences/halves-vs-quarters/experience.json; do
  pnpm -s dismodo validate "$p" >/dev/null && pass "valid: $p" || fail "$p should be valid"
done
for p in experiences/invalid/*.json; do
  if pnpm -s dismodo validate "$p" >/dev/null 2>&1; then fail "$p should be rejected"; else pass "rejected with issues: $p"; fi
done

echo "A3 — the second builder's variant needed no engine change"
changed=$(git show --name-only --format= ab5277e | grep -v '^examples/' || true)
[ -z "$changed" ] && pass "variant commit ab5277e touches only examples/" || fail "variant commit touched: $changed"

if [ "${LIVE:-0}" = "1" ]; then
  echo "A11 — MCP with a real client (official MCP client over stdio and HTTP)"
  pnpm exec tsx scripts/mcp-e2e.mjs >/tmp/dismodo-acceptance-mcp.json && pass "MCP end-to-end: $(grep -o "\"status\": \"completed\"" /tmp/dismodo-acceptance-mcp.json | wc -l) of 2 transports completed a session" || fail "MCP end-to-end"
else
  echo "A11 — skipped (run with LIVE=1 and a running API)"
fi
echo "All selected acceptance checks passed."
