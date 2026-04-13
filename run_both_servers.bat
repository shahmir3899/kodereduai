@echo off
setlocal

set "ROOT=%~dp0"

echo Starting backend server...
start "Smart Attendance Backend" cmd /k "cd /d ""%ROOT%backend"" && python manage.py runserver 8000"

echo Starting frontend server...
start "Smart Attendance Frontend" cmd /k "cd /d ""%ROOT%frontend"" && npm run dev"

echo.
echo Both servers were started in separate terminals.
echo Close this window or press any key to exit.
pause >nul
