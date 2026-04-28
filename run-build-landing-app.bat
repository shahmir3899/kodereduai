@echo off
setlocal

set "ROOT=%~dp0"
set "LANDING_DIR=%ROOT%frontend\apps\koderkids-landing-astro"
set "LANDING_ENV=%LANDING_DIR%\.env"

if not exist "%LANDING_DIR%\package.json" (
  echo [ERROR] Landing app not found: %LANDING_DIR%
  pause
  exit /b 1
)

echo Writing landing .env in DEV mode...
(
  echo SITE_URL=http://127.0.0.1:4321
  echo PUBLIC_MAIN_APP_API_BASE_URL=http://127.0.0.1:8000
  echo PUBLIC_LANDING_METRICS_PATH=/api/public/landing-metrics/
  echo PUBLIC_SCHOOL_ID=37
  echo PUBLIC_CAREERS_FORM_ENDPOINT=
  echo PUBLIC_DEMO_FORM_ENDPOINT=
  echo PUBLIC_CONTACT_FORM_ENDPOINT=
) > "%LANDING_ENV%"

echo Building Astro landing app...
cd /d "%LANDING_DIR%"
call npm run build
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)

echo Closing landing/backend terminal windows started by scripts...
for %%T in (
  "Landing Backend Local"
  "Landing Astro Local"
  "Landing Backend Dev"
  "Landing Astro Dev"
  "Smart Attendance Backend"
  "KoderKids Landing Astro"
  "KoderKids Landing Frontend"
) do (
  taskkill /FI "WINDOWTITLE eq %%~T" /F >nul 2>nul
)

echo Opening build output...
start "" "%LANDING_DIR%\dist\"
if exist "%LANDING_DIR%\dist\index.html" (
  start "" "%LANDING_DIR%\dist\index.html"
)

echo.
echo Build complete. Dev-mode .env written to:
echo   %LANDING_ENV%
echo.
pause
