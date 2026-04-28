@echo off
setlocal

set "ROOT=%~dp0"

echo Starting backend server...
start "Smart Attendance Backend" cmd /k "cd /d ""%ROOT%backend"" && python manage.py runserver 8000"

echo Starting landing app server...
start "KoderKids Landing Frontend" cmd /k "cd /d ""%ROOT%frontend\apps\koderkids-landing"" && npm run dev"

echo.
echo Backend and landing app were started in separate terminals.
echo Close this window or press any key to exit.
pause >nul
