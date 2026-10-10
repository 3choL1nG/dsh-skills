@echo off
rem DSH knowledge-base sync launcher (Windows).
rem ASCII only + CRLF on purpose: cmd.exe misparses non-ASCII batch files.
chcp 65001 >nul
pushd "%~dp0"
set "NODE="
for /f "delims=" %%I in ('where node 2^>nul') do if not defined NODE set "NODE=%%I"
if not defined NODE (
  for /d %%D in ("%USERPROFILE%\.dsh\dsh-runtimes\*") do (
    if not defined NODE if exist "%%D\dependencies\node\bin\node.exe" set "NODE=%%D\dependencies\node\bin\node.exe"
  )
)
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE (
  echo.
  echo   [ERROR] Node.js not found.
  echo   Install it from https://nodejs.org  ^(LTS^)  then run this again.
  echo.
  popd
  pause
  exit /b 1
)
"%NODE%" "skills-sync.mjs" --unit kb %*
popd
echo.
pause
