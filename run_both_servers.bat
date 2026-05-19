@echo off
setlocal

set "ROOT=%~dp0"
set "VENV_PY=%ROOT%.venv\Scripts\python.exe"

echo Starting backend server...
if exist "%VENV_PY%" (
	start "Smart Attendance Backend" cmd /k "cd /d ""%ROOT%backend"" && "%VENV_PY%" manage.py runserver 8000"
) else (
	echo Warning: %VENV_PY% not found. Falling back to system Python.
	start "Smart Attendance Backend" cmd /k "cd /d ""%ROOT%backend"" && python manage.py runserver 8000"
)

echo Starting frontend server...
start "Smart Attendance Frontend" cmd /k "cd /d ""%ROOT%frontend"" && npm run dev"

echo.
echo Both servers were started in separate terminals.
echo Close this window or press any key to exit.
pause >nul
