@echo off
cd /d "%~dp0"

echo Iniciando servidor...
start cmd /k npm start

timeout /t 3 > nul

start http://localhost:3000/admin.html
