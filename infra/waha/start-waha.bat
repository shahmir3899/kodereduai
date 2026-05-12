@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo [ERROR] Missing .env - copy .env.example to .env and edit credentials.
  pause
  exit /b 1
)

echo Starting WAHA ^(Docker^)...
docker compose up -d
if errorlevel 1 (
  echo [ERROR] docker compose failed. Is Docker Desktop running?
  pause
  exit /b 1
)

echo.
docker compose ps
echo.
echo Dashboard: http://127.0.0.1:3080/dashboard ^(port 3080 - avoids Vite on 3000^)
echo Ping: http://127.0.0.1:3080/ping
echo Tip: When calling the REST API, send HTTP header X-Api-Key with the same value as WAHA_API_KEY in the local .env ^(see README^).
echo.
pause
