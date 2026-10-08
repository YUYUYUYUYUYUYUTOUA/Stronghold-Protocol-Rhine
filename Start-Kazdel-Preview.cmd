@echo off
setlocal
pushd "%~dp0" || exit /b 1
node scripts\launch.mjs --port 3001 --host 127.0.0.1 --no-setup
set "KAZDEL_EXIT=%errorlevel%"
popd
if not "%KAZDEL_EXIT%"=="0" pause
exit /b %KAZDEL_EXIT%
