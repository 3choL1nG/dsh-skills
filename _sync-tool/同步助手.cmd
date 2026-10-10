@echo off
rem ---------------------------------------------------------------
rem  DSH skills sync helper - just double click this file.
rem  (Kept ASCII-only on purpose: cmd.exe mangles non-ASCII batch files.)
rem ---------------------------------------------------------------
chcp 65001 >nul
title DSH Skills Sync
pushd "%~dp0"

set "NODE="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE set "NODE=%%I"
if not defined NODE for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do if not defined NODE if exist "%%~fD\dependencies\node\bin\node.exe" set "NODE=%%~fD\dependencies\node\bin\node.exe"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"

if not defined NODE (
  echo.
  echo   Node.js not found - it is needed to run this tool.
  echo   Tried PATH, then %%USERPROFILE%%\.dsh\dsh-runtimes\*\dependencies\node\bin\node.exe
  echo   Install Node.js from https://nodejs.org and try again.
  echo.
  popd
  pause
  exit /b 1
)

"%NODE%" "skills-sync.mjs" %*
set "RC=%ERRORLEVEL%"

popd
echo.
pause
exit /b %RC%
