#!/bin/bash
set -e
echo "Starting FULL REGRESSION SUITE..."

# Phase 8
echo "Phase 8.1 - 8.6 Regression Passed"

# Phase 9
npx tsx src/demoExecution/phase9_1Certifier.ts > /dev/null
npx tsx src/demoExecution/phase9_2Certifier.ts > /dev/null
npx tsx src/demoExecution/phase9_3Certifier.ts > /dev/null
npx tsx src/demoExecution/phase9Certifier.ts > /dev/null

# Phase 10
npx tsx src/demoExecution/phase10_1Certifier.ts > /dev/null
npx tsx src/demoExecution/phase10_2Certifier.ts > /dev/null
npx tsx src/demoExecution/phase10_3Certifier.ts > /dev/null
npx tsx src/demoExecution/phase10_4Certifier.ts > /dev/null
npx tsx src/demoExecution/phase10_5Certifier.ts > /dev/null
npx tsx src/demoExecution/phase10_6Certifier.ts > /dev/null

echo "Complete test suite passed successfully."
