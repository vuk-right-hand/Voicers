#!/bin/bash
# ─── Voicer Uninstaller (macOS) ─────────────────────────────────────────────
# Removes the launchd daemon, config, and logs.
# Does NOT remove Voicer.app — user should drag that to Trash separately.
#
# Run: ~/.voicer/uninstall.sh
# ─────────────────────────────────────────────────────────────────────────────

UID_NUM="$(id -u)"
PLIST="$HOME/Library/LaunchAgents/com.voicer.host.plist"

echo "Voicer Uninstaller"
echo "=================="

# Stop and remove launchd service
if launchctl print "gui/$UID_NUM/com.voicer.host" >/dev/null 2>&1; then
    echo "Stopping Voicer daemon..."
    launchctl bootout "gui/$UID_NUM/com.voicer.host" 2>/dev/null
fi

if [ -f "$PLIST" ]; then
    echo "Removing launchd plist..."
    rm "$PLIST"
fi

# Remove config and logs
if [ -d "$HOME/.voicer" ]; then
    echo "Removing ~/.voicer/ (config + logs)..."
    rm -rf "$HOME/.voicer"
fi

echo ""
echo "Done. To complete uninstall, drag Voicer.app to Trash."
echo "You may also want to remove Voicer from:"
echo "  System Settings > Privacy > Accessibility"
echo "  System Settings > Privacy > Screen Recording"
