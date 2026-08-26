@echo off
rem Thin double-click wrapper; the PowerShell process is the complete launcher.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-codex-with-skin.ps1" %*
exit /b %ERRORLEVEL%
