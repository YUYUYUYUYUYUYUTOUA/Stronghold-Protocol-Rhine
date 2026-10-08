@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Restart-Kazdel-Preview.ps1"
if errorlevel 1 pause
