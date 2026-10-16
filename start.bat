@echo off
rem One-click start for Windows: installs on first run, then starts MagicFinder.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo MagicFinder needs Node.js 22.13 or newer. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)"
if errorlevel 1 (
  echo MagicFinder needs Node.js 22.13 or newer. Update it from https://nodejs.org.
  pause
  exit /b 1
)
if not exist node_modules (
  echo First run: installing, this takes a minute...
  call npm install || (pause & exit /b 1)
)
call npm start
pause
