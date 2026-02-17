#!/bin/bash
# Phase 3 Test Runner Script
# Runs all Vitest tests for Phase 3 components
# Usage: npm run test:phase3

echo "🧪 Phase 3 Component Testing"
echo "============================"
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Run tests with coverage
echo "📊 Running tests with coverage..."
echo ""

npm run vitest -- \
  src/components/WorkflowProgressBar.test.jsx \
  src/components/StageTransitionPanel.test.jsx \
  src/components/FeePaymentWidget.test.jsx \
  src/components/WorkflowStageNotes.test.jsx \
  src/pages/admissions/EnquiryDetail.test.jsx \
  --reporter=verbose \
  --coverage

TEST_RESULT=$?

echo ""
echo "============================"

if [ $TEST_RESULT -eq 0 ]; then
  echo -e "${GREEN}✅ All Phase 3 tests passed!${NC}"
  echo ""
  echo "Test Summary:"
  echo "  ✓ WorkflowProgressBar component"
  echo "  ✓ StageTransitionPanel component"
  echo "  ✓ FeePaymentWidget component"
  echo "  ✓ WorkflowStageNotes component"
  echo "  ✓ EnquiryDetail integration"
  echo ""
  echo "Next Steps:"
  echo "  1. Visual inspection in browser:"
  echo "     http://localhost:3001/admissions/enquiries"
  echo "  2. Click an enquiry"
  echo "  3. Navigate to 'Workflow & Progress' tab"
  echo "  4. Test stage transitions and fee payments"
else
  echo -e "${RED}❌ Some tests failed${NC}"
  echo ""
  echo "Debug tips:"
  echo "  1. Check console output above for error details"
  echo "  2. Run single test: npm run vitest src/components/WorkflowProgressBar.test.js"
  echo "  3. Update snapshots: npm run vitest -- -u"
fi

exit $TEST_RESULT
