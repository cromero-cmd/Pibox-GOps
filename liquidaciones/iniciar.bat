@echo off
title Pipeline TaDa -> Trump
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo No se encontro Node.js en este equipo.
  echo Instalalo desde https://nodejs.org y vuelve a hacer doble clic en este archivo.
  pause
  exit /b 1
)

node server.js
echo.
echo El servidor se detuvo.
pause
