# Phase 3 Automated Testing Guide

## 🚀 Quick Start

### Run All Phase 3 Tests
```bash
npm run test:phase3
```

### Watch Mode (Re-run on file changes)
```bash
npm run test:phase3:watch
```

### Generate Coverage Report
```bash
npm run test:phase3:coverage
```

---

## 📋 What's Being Tested

### ✅ Component Tests

**1. WorkflowProgressBar.test.js** (8 tests)
- Renders all stages correctly
- Highlights current stage
- Marks completed stages with checkmarks
- Calculates progress percentage
- Shows time estimates
- Displays bypass hints when enabled
- Handles empty workflows

**2. StageTransitionPanel.test.js** (6 tests)
- Displays current stage clearly
- Shows next stage options
- Enforces fee validation
- Requires bypass reason
- Shows completion message
- Allows stage selection

**3. FeePaymentWidget.test.js** (7 tests)
- Displays 3 fee summary cards
- Shows record payment button
- Warns when payment required
- Opens payment form
- Validates amount input
- Shows payment history
- Formats currency correctly

**4. WorkflowStageNotes.test.js** (8 tests)
- Displays full timeline
- Shows stage names and timestamps
- Displays bypass badges
- Shows bypass reasons
- Shows who recorded changes
- Displays stage duration
- Shows total progress summary

**5. EnquiryDetail Integration** (11 tests)
- Tab navigation works
- Renders enquiry header
- Workflow tab displays by default
- Can switch between all tabs
- All Phase 3 components render
- Child information displays
- Parent information displays
- Edit button works
- Tab switching is responsive

**Total: 40+ Unit & Integration Tests**

---

## 🧪 Test Execution

### Option 1: Run All Tests At Once
```bash
npm run test:phase3
```

Expected output:
```
✓ WorkflowProgressBar.test.js (8)
✓ StageTransitionPanel.test.js (6)
✓ FeePaymentWidget.test.js (7)
✓ WorkflowStageNotes.test.js (8)
✓ EnquiryDetail.test.js (11)

Tests: 40 passed (40)
Duration: 2.5s
```

### Option 2: Run Single File Tests
```bash
# Test just the progress bar
npm run vitest -- src/components/WorkflowProgressBar.test.js

# Test just fee widget
npm run vitest -- src/components/FeePaymentWidget.test.js

# Test the full integration
npm run vitest -- src/pages/admissions/EnquiryDetail.test.js
```

### Option 3: Watch Mode (Development)
```bash
npm run test:phase3:watch
```

This will:
- Watch all Phase 3 test files
- Re-run tests when you modify code
- Show real-time results
- Help during debugging

### Option 4: Coverage Report
```bash
npm run test:phase3:coverage
```

Generates report showing:
- % of code covered by tests
- Which lines are untested
- Coverage by component

---

## 🐛 Debugging Failed Tests

### 1. See Detailed Error
```bash
npm run vitest -- src/components/WorkflowProgressBar.test.js --reporter=verbose
```

### 2. Debug in Browser (Node Inspector)
```bash
node --inspect-brk ./node_modules/.bin/vitest
```

Then open: `chrome://inspect`

### 3. Run Single Test
```bash
npm run vitest -- --grep "should render all stages"
```

### 4. Update Snapshots (if using snapshots)
```bash
npm run vitest -- -u
```

---

## 📊 Expected Results

All tests should **PASS** ✅

```
PASS  src/components/WorkflowProgressBar.test.js (8)
PASS  src/components/StageTransitionPanel.test.js (6)
PASS  src/components/FeePaymentWidget.test.js (7)
PASS  src/components/WorkflowStageNotes.test.js (8)
PASS  src/pages/admissions/EnquiryDetail.test.js (11)

Test Files: 5 passed (5)
Tests: 40 passed (40)
```

---

## 🔍 What Each Test Verifies

### WorkflowProgressBar Component
- ✓ All stages render from data
- ✓ Three visual states: completed (✓), current (●), pending (◯)
- ✓ Progress bar shows correct percentage
- ✓ Estimated days calculate correctly
- ✓ Bypass mode UI appears only when enabled

### StageTransitionPanel Component
- ✓ Current stage displayed prominently
- ✓ Radio buttons for stage selection
- ✓ Fee requirements enforced
- ✓ Bypass requires reason text
- ✓ Success message on completion
- ✓ Next stages correctly filtered

### FeePaymentWidget Component
- ✓ Three cards show: Required, Paid, Pending
- ✓ Currency formatting (₹ symbol)
- ✓ Payment history timeline
- ✓ Modal opens on button click
- ✓ Amount validation (must be > 0)
- ✓ Paid/Pending status updates

### WorkflowStageNotes Component
- ✓ Full audit trail displayed
- ✓ Timestamps correct
- ✓ Bypass badges for skipped stages
- ✓ Bypass reason displayed
- ✓ Duration calculations per stage
- ✓ Summary shows bypassed count

### EnquiryDetail Integration
- ✓ All 4 tabs appear at top
- ✓ Tab switching works
- ✓ Correct content in each tab
- ✓ Back link works
- ✓ Edit link works
- ✓ Mobile responsive

---

## ✅ Success Criteria

**Tests pass if:**
1. ✓ All 40+ tests show as `PASS`
2. ✓ No error messages in output
3. ✓ No timeout warnings
4. ✓ Exit code = 0

**If tests fail:**
1. Check error message
2. Run single test file
3. Check component code for typos
4. Verify props are passed correctly
5. Check API mock setup

---

## 📱 Next: Visual Testing in Browser

After automated tests pass, do visual testing:

```
1. npm run dev          # Start dev server
2. Open http://localhost:3001/admissions/enquiries
3. Click an enquiry
4. Click "Workflow & Progress" tab
5. Verify components render
6. Test stage transitions
7. Test payment recording
```

---

## 🚨 Troubleshooting

### "Cannot find module '@tanstack/react-query'"
```bash
npm install
```

### "JSDOM not set up"
Check `vitest.config.js` has:
```javascript
test: {
  environment: 'jsdom',
}
```

### "Tests timeout"
Add timeout to test:
```javascript
it('test name', async () => {
  // test code
}, 10000) // 10 second timeout
```

### "Mock not working"
Verify mock is defined before imports:
```javascript
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(),
}))
```

---

## 📊 Test Coverage Interpretation

```
Statements: 92%    → 92% of code statements executed
Branches:   85%    → 85% of if/else branches tested
Functions:  95%    → 95% of functions called
Lines:      90%    → 90% of lines executed
```

**Target:** >85% coverage for Phase 3

---

## 🎯 Phase 3 Testing Workflow

1. **Run automated tests**
   ```bash
   npm run test:phase3
   ```
   
2. **Fix any failures**
   - Check error message
   - Update component or test
   - Rerun

3. **Visual browser testing**
   ```bash
   npm run dev
   ```
   - Navigate to enquiry
   - Click Workflow tab
   - Test interactions

4. **Check coverage**
   ```bash
   npm run test:phase3:coverage
   ```

5. **Ready for Phase 4!** 🚀

---

## 📞 Test Report Format

After running `npm run test:phase3`, share:

```
npm run test:phase3 result:
- Tests: [PASS/FAIL]
- Passed: X/40
- Failed: X/40
- Duration: Xs
- Coverage: X%

Any errors:
[paste error message here]
```

---

**Ready to test?**
```bash
npm run test:phase3
```

✅ All tests should pass within 5 seconds.
