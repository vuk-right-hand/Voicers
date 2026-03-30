@echo off
:: Voicer Desktop Host — Auto-start script
:: Drop a shortcut to this file in:
::   C:\Users\<you>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
:: The host will start silently in the background every time Windows boots.

cd /d "%~dp0"

:: Activate the virtual environment
call venv\Scripts\activate.bat

:: Start the host (minimized window)
start /min "" uvicorn server:app --host 0.0.0.0 --port 8000
