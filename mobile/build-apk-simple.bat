@echo off
rem Simple local APK build for Education AI. Double-click it. It does not touch git
rem (it only reads the branch and commit for the file name).
rem   build-apk-simple.bat clean   force a fresh native android folder
rem   build-apk-simple.bat check   only check the tools, build nothing
setlocal
title Education AI - build APK (simple)
cd /d "%~dp0"
set "MOBILE=%CD%"
set "ANDROID_DIR=%MOBILE%\android"
set "OUT_DIR=%MOBILE%\build-output"
set "APK=%ANDROID_DIR%\app\build\outputs\apk\release\app-release.apk"
set "API_URL=https://personal-gateway-sg.onrender.com/educationai"
set "NEED=0"
set "CHECK=0"
if /i "%~1"=="clean" set "NEED=1"
if /i "%~1"=="check" set "CHECK=1"

echo.
echo [1/5] Checking tools
where node >nul 2>&1 || (set "MSG=Node.js is not installed or not on PATH." & goto :fail)
where npm >nul 2>&1 || (set "MSG=npm is not installed or not on PATH." & goto :fail)

if defined JAVA_HOME if exist "%JAVA_HOME%\bin\java.exe" goto :java_ok
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
if not exist "%JAVA_HOME%\bin\java.exe" (set "MSG=No JDK found. Install Android Studio or JDK 17 and set JAVA_HOME." & goto :fail)
:java_ok
echo       JDK: %JAVA_HOME%

set "SDK="
if defined ANDROID_HOME if exist "%ANDROID_HOME%\platforms\android-36" set "SDK=%ANDROID_HOME%"
if not defined SDK if exist "%LOCALAPPDATA%\Android\Sdk\platforms\android-36" set "SDK=%LOCALAPPDATA%\Android\Sdk"
if not defined SDK (set "MSG=Android SDK with platform android-36 not found. Install it in Android Studio, SDK Manager." & goto :fail)
if not exist "%SDK%\ndk\27.1.12297006" (set "MSG=NDK 27.1.12297006 is missing. Android Studio, SDK Manager, SDK Tools, NDK (Side by side), Show Package Details." & goto :fail)
set "ANDROID_HOME=%SDK%"
set "ANDROID_SDK_ROOT=%SDK%"
echo       Android SDK: %SDK%

if not exist "%MOBILE%\package-lock.json" (set "MSG=package-lock.json is missing. Restore it first: git checkout -- package-lock.json" & goto :fail)

if "%CHECK%"=="1" (
  echo.
  echo Check finished: tools are fine. Nothing was built.
  goto :end
)

echo.
echo [2/5] JavaScript packages
if exist "%MOBILE%\node_modules" goto :deps_ok
echo       node_modules is missing, running npm ci. This takes a few minutes.
call npm ci --no-audit --no-fund
if errorlevel 1 (set "MSG=npm ci failed." & goto :fail)
:deps_ok
echo       OK

echo.
echo [3/5] Native android folder
if not exist "%ANDROID_DIR%\app\build.gradle" set "NEED=1"
if not exist "%ANDROID_DIR%\.build-stamp" set "NEED=1"
if "%NEED%"=="0" for /f "usebackq" %%R in (`powershell -NoProfile -Command "$s=(Get-Item '%ANDROID_DIR%\.build-stamp').LastWriteTime; $n=0; foreach($f in 'app.json','package.json','package-lock.json'){ if((Get-Item (Join-Path '%MOBILE%' $f)).LastWriteTime -gt $s){$n=1} }; $n"`) do set "NEED=%%R"

set "EXPO_PUBLIC_API_URL=%API_URL%"
set "EXPO_PUBLIC_APP_ENV=internal"
set "EXPO_PUBLIC_ALLOW_INSECURE_HTTP=true"
set "NODE_ENV=production"
set "CI=1"

if "%NEED%"=="0" goto :prebuild_ok
echo       Regenerating it from app.json. It is generated and ignored by git.
del "%ANDROID_DIR%\.build-stamp" >nul 2>&1
call npx expo prebuild --platform android --clean --no-install
if errorlevel 1 (set "MSG=expo prebuild failed." & goto :fail)
echo built> "%ANDROID_DIR%\.build-stamp"
goto :prebuild_done
:prebuild_ok
echo       Up to date, reusing it.
:prebuild_done
rem Gradle finds the SDK here. Forward slashes: a backslash path broke an earlier build.
set "SDK_FWD=%SDK:\=/%"
echo sdk.dir=%SDK_FWD%> "%ANDROID_DIR%\local.properties"

echo.
echo [4/5] Building the APK. The first build takes about 20 minutes.
del "%APK%" >nul 2>&1
pushd "%ANDROID_DIR%"
call gradlew.bat assembleRelease
set "GRADLE_EXIT=%ERRORLEVEL%"
call gradlew.bat --stop >nul 2>&1
popd
if not "%GRADLE_EXIT%"=="0" (set "MSG=Gradle failed. The reason is above, near the first line that says FAILED or What went wrong." & goto :fail)

echo.
echo [5/5] Saving the APK
if not exist "%APK%" (set "MSG=Gradle finished but there is no APK." & goto :fail)
set "SIZE=0"
for %%F in ("%APK%") do set "SIZE=%%~zF"
if %SIZE% LSS 30000000 (set "MSG=The APK is far too small, so something is wrong with the build." & goto :fail)

set "STAMP=now"
for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "STAMP=%%T"
set "BRANCH=nogit"
set "COMMIT="
set "DIRTY="
for /f %%G in ('git -C "%MOBILE%" branch --show-current 2^>nul') do set "BRANCH=%%G"
for /f %%G in ('git -C "%MOBILE%" rev-parse --short HEAD 2^>nul') do set "COMMIT=_%%G"
for /f %%G in ('git -C "%MOBILE%" status --porcelain 2^>nul') do set "DIRTY=_dirty"
set "BRANCH=%BRANCH:/=-%"
if not exist "%OUT_DIR%" mkdir "%OUT_DIR%"
set "FINAL=%OUT_DIR%\EducationAI_%BRANCH%%COMMIT%%DIRTY%_%STAMP%.apk"
copy /y "%APK%" "%FINAL%" >nul
if errorlevel 1 (set "MSG=Could not copy the APK to build-output." & goto :fail)

echo.
echo ===== DONE =====
echo APK: %FINAL%
echo Server: %API_URL%
echo Install it by copying it to the phone. It is signed with a debug key,
echo so uninstall any EAS-built Education AI first.
start "" explorer.exe /select,"%FINAL%"
goto :end

:fail
echo.
echo ===== BUILD STOPPED =====
echo %MSG%
pause
exit /b 1

:end
echo.
pause
exit /b 0
