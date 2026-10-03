@echo off
chcp 65001 >nul
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\rhine-bundle-launch.ps1" %*
set "RHINE_EXIT_CODE=%errorlevel%"
if not "%RHINE_EXIT_CODE%"=="0" if not "%RHINE_NO_PAUSE%"=="1" pause
exit /b %RHINE_EXIT_CODE%
