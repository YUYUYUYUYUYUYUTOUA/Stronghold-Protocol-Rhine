@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "LAB_NODE=%~dp0runtime\node\node.exe"
if not exist "%LAB_NODE%" set "LAB_NODE=node"
"%LAB_NODE%" scripts\test-lab-launch.mjs %*
if errorlevel 1 pause
endlocal
