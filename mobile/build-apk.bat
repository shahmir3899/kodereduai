@echo off
rem Builds the Education AI APK on this PC. Double-click it.
rem   build-apk.bat check   look around and report, change nothing
rem   build-apk.bat nogit   skip commit, merge and push
rem   build-apk.bat clean   force a fresh native project
rem The work is in build-apk.ps1 next to this file.
rem
rem If it stops with "package-lock.json is missing":
rem   1. Restore the last committed copy (exact tested versions). In the mobile folder:
rem        git log --oneline -- mobile/package-lock.json
rem        git show ^<commit-before-deletion^>:mobile/package-lock.json ^> package-lock.json
rem   2. If there is no committed copy, create a new one from package.json:
rem        npm install --package-lock-only
rem   Then commit it and run this file again.
setlocal
title Education AI - build APK
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-apk.ps1" %*
set RESULT=%ERRORLEVEL%
echo.
if %RESULT% NEQ 0 (
  echo The build did NOT finish. Read the message above.
) else (
  echo Finished.
)
pause
exit /b %RESULT%
