@echo off
cd /d "%~dp0"
title AI Stack Launcher
start "AI Stack Launcher - server" cmd /k npm start
timeout /t 3 /nobreak >nul
start "" http://localhost:5000
