@echo off
title 译文格式批量校对
cd /d "%~dp0"
echo Starting Translation Format Checker...
echo.
echo Please open your browser and go to: http://127.0.0.1:3001
echo.
echo Press Ctrl+C to stop the server.
echo.
node server.js
pause
