#!/bin/bash
# Voicer Desktop Host — Auto-start script (macOS)
# To run on login: System Settings → General → Login Items → add this file
# Or: launchctl load ~/Library/LaunchAgents/com.voicer.host.plist

cd "$(dirname "$0")"
source venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8000
