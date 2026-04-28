@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "LANDING_DIR=%ROOT%frontend\apps\koderkids-landing-astro"
set "VENV_PY=%ROOT%.venv\Scripts\python.exe"

if not exist "%VENV_PY%" (
  echo [ERROR] Python venv executable not found: %VENV_PY%
  pause
  exit /b 1
)

if not exist "%LANDING_DIR%\package.json" (
  echo [ERROR] Landing app not found: %LANDING_DIR%
  pause
  exit /b 1
)

echo Starting backend in LOCAL mode (console email backend)...
start "Landing Backend Local" cmd /k "cd /d ""%BACKEND_DIR%"" && set ""DJANGO_SETTINGS_MODULE=config.settings"" && set ""ENVIRONMENT=local"" && set ""EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend"" && "%VENV_PY%" manage.py runserver 8000"

echo Starting Astro landing app in LOCAL mode...
start "Landing Astro Local" cmd /k "cd /d ""%LANDING_DIR%"" && npm run dev"

echo.
echo Local mode launched:
echo   Backend: http://127.0.0.1:8000/
echo   Landing: http://127.0.0.1:4321/
echo.
pause
