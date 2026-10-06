@echo off
chcp 65001 >nul
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\rhine-bundle-update.ps1" %*
set "RHINE_UPDATE_EXIT=%errorlevel%"
if not "%RHINE_NO_PAUSE%"=="1" pause
exit /b %RHINE_UPDATE_EXIT%
