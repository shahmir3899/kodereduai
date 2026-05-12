@echo off
setlocal
cd /d "%~dp0"

if not exist ".env" (
  echo [ERROR] Missing .env - copy .env.example to .env first.
  pause
  exit /b 1
)

echo.
echo Dashboard: http://127.0.0.1:3080/dashboard ^(port 3080 - avoids Vite on 3000^)
echo Ping: http://127.0.0.1:3080/ping
echo Tip: When calling the REST API, send HTTP header X-Api-Key with the same value as WAHA_API_KEY in the local .env ^(see README^).
echo.
echo WAHA running in this window ^(Ctrl+C stops the container^)...
docker compose up
