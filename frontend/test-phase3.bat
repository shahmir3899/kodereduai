@echo off
REM Phase 3 Test Runner for Windows
REM Tests all Phase 3 components using Vitest
REM Usage: test-phase3.bat

setlocal enabledelayedexpansion

echo.
echo =====================================
echo Phase 3 Component Testing
echo =====================================
echo.

REM Check if npm is installed
npm --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found. Please install Node.js
    exit /b 1
)

echo Testing Phase 3 Components...
echo.

REM Run tests
npm run test:phase3

set TEST_RESULT=%ERRORLEVEL%

echo.
echo =====================================

if %TEST_RESULT% equ 0 (
    echo [SUCCESS] All Phase 3 tests passed!
    echo.
    echo Test Results Summary:
    echo  ✓ WorkflowProgressBar component
    echo  ✓ StageTransitionPanel component
    echo  ✓ FeePaymentWidget component
    echo  ✓ WorkflowStageNotes component
    echo  ✓ EnquiryDetail integration
    echo.
    echo Next Steps:
    echo  1. Run: npm run dev
    echo  2. Open: http://localhost:3001/admissions/enquiries
    echo  3. Click an enquiry
    echo  4. Click "Workflow ^& Progress" tab
    echo  5. Test stage transitions
) else (
    echo [FAILED] Some tests did not pass
    echo.
    echo Debug Options:
    echo  - npm run vitest -- src/components/WorkflowProgressBar.test.js
    echo  - npm run vitest -- src/components/StageTransitionPanel.test.js
    echo  - npm run vitest -- src/components/FeePaymentWidget.test.js
    echo  - npm run vitest -- src/components/WorkflowStageNotes.test.js
)

echo.
echo =====================================

exit /b %TEST_RESULT%
