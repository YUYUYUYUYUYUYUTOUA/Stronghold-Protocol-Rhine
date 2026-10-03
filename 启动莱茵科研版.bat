@echo off
chcp 65001 >nul
cd /d "%~dp0"
node scripts\launch.mjs --port 3000 --host 0.0.0.0 --no-setup %*
if errorlevel 1 pause
