@echo off
:: Voicer Desktop Host — launched on boot via Task Scheduler
:: Logs to voicer.log in the install directory for diagnostics.

cd /d "%~dp0host"
echo [%date% %time%] Starting Voicer Host... >> "%~dp0voicer.log"
"%~dp0python\python.exe" -m uvicorn server:app --host 0.0.0.0 --port 8000 >> "%~dp0voicer.log" 2>&1
echo [%date% %time%] Voicer Host exited with code %errorlevel% >> "%~dp0voicer.log"
