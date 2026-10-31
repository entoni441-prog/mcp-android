@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Windows Local Notepad - One-Time Consent
echo This is a LOCAL, ONE-TIME operation. No remote access or background service.
echo By opening this file, you approve opening Notepad on this PC once.
where node.exe >nul 2>&1
if errorlevel 1 (
  echo BLOCKED: existing Node.js runtime not found. Nothing was installed.
  pause
  exit /b 2
)
node.exe "%~dp0launch-once.mjs" --app=notepad --approve-once
set "STATUS=%ERRORLEVEL%"
if not "%STATUS%"=="0" (
  echo BLOCKED: Notepad could not be started.
)
echo Local operation finished.
pause
exit /b %STATUS%
