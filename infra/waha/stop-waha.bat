@echo off
setlocal
cd /d "%~dp0"

echo Stopping WAHA stack in this directory...
docker compose down
if errorlevel 1 (
  echo [ERROR] docker compose down failed.
) else (
  echo WAHA stack stopped.
)
echo.
docker compose ps -a
pause
