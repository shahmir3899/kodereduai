@echo off
setlocal
cd /d "%~dp0"

echo Streaming WAHA service logs ^(Ctrl+C to exit^)...
docker compose logs -f waha
