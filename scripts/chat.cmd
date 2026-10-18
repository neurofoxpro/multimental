@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0chat.ps1" %*
exit /b %ERRORLEVEL%
