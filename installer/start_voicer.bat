@echo off
:: Voicer Desktop Host — launched by Windows Task Scheduler (VoicerHost task).
:: Task Scheduler owns lifecycle: starts on logon, restarts on failure every 1 min.
:: Single source of truth — do NOT add an internal restart loop here, or it races
:: with the scheduler and spawns zombie bat instances.
if not "%1"=="min" (
    start /min "" "%~f0" min
    exit /b
)

cd /d "%~dp0host"
echo [%date% %time%] Starting Voicer Host... >> "%~dp0voicer.log"
"%~dp0python\python.exe" -m uvicorn server:app --host 0.0.0.0 --port 8000 >> "%~dp0voicer.log" 2>&1
echo [%date% %time%] Voicer Host exited with code %errorlevel% >> "%~dp0voicer.log"
exit /b %errorlevel%
