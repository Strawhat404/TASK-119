#!/usr/bin/env bash
set -euo pipefail

echo "=== Running unit tests ==="
node --test unit_tests/*.test.js

echo "=== Running API tests ==="
node --test API_tests/*.test.js

echo "=== All tests passed ==="
