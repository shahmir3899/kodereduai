@echo off
setlocal
cd /d "%~dp0"

echo Container status:
docker compose ps -a
echo.
echo Quick HTTP check ^(/ping^):
curl -s -o NUL -w "HTTP %%{http_code}\n" http://127.0.0.1:3080/ping 2>nul
if errorlevel 1 (
  echo curl not found or request failed - try: http://127.0.0.1:3080/ping in browser
)
echo Tip: /ping is reachability only. Authenticated REST calls need header X-Api-Key ^(see README^).
echo.
pause
