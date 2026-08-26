@echo off
setlocal

rem Resolve the PowerShell entry point relative to this CMD file.
set "SCRIPT=%~dp0start-codex-with-skin.ps1"

rem Bypass policy for this process only; no user or machine policy is changed.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%" %*
set "EXIT_CODE=%ERRORLEVEL%"

endlocal & exit /b %EXIT_CODE%
