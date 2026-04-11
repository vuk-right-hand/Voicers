#!/bin/bash
# ─── Voicer First-Run Setup Wizard (macOS) ──────────────────────────────────
# Called by Contents/MacOS/voicer on first launch (no .env exists).
# Uses osascript for native macOS dialogs.
#
# Args: $1 = path to Contents/Resources/
# ─────────────────────────────────────────────────────────────────────────────

set -e

RESOURCES_DIR="$1"
if [ -z "$RESOURCES_DIR" ]; then
    echo "ERROR: Resources path not provided"
    exit 1
fi

CONFIG_DIR="$HOME/.voicer"
ENV_FILE="$CONFIG_DIR/.env"
TEMPLATE="$RESOURCES_DIR/env.template"

# ── Helper: show dialog and capture result ──────────────────────────────────
ask_text() {
    local prompt="$1"
    local default="$2"
    local result
    # || block absorbs non-zero exit so set -e doesn't kill us silently
    result=$(osascript -e "text returned of (display dialog \"$prompt\" default answer \"$default\" with title \"Voicer Setup\")" 2>/dev/null) || {
        osascript -e 'display alert "Setup Cancelled" message "You can restart setup by opening Voicer again." as informational' 2>/dev/null
        exit 1
    }
    echo "$result"
}

ask_ok() {
    local message="$1"
    osascript -e "display dialog \"$message\" with title \"Voicer Setup\" buttons {\"OK\"} default button \"OK\"" 2>/dev/null
}

# ── Step 1: Find activation file ────────────────────────────────────────────
ACTIVATION_FILE=""

# Search Downloads for most recent match (handles browser renames like "(1)")
FOUND=$(ls -t ~/Downloads/voicer-activation*.txt 2>/dev/null | head -n 1)
if [ -n "$FOUND" ]; then
    ACTIVATION_FILE="$FOUND"
else
    # Show file picker — POSIX path to avoid HFS colon-separated paths
    PICKED=$(osascript -e 'POSIX path of (choose file with prompt "Select your voicer-activation.txt file" of type {"txt"})' 2>/dev/null) || true
    if [ -n "$PICKED" ]; then
        ACTIVATION_FILE="$PICKED"
    fi
fi

if [ -z "$ACTIVATION_FILE" ] || [ ! -f "$ACTIVATION_FILE" ]; then
    osascript -e 'display alert "Setup Cancelled" message "Could not find voicer-activation.txt. Download it from voicers.vercel.app after purchase." as critical'
    exit 1
fi

# Read activation data
USER_ID=$(sed -n '1p' "$ACTIVATION_FILE" | tr -d '[:space:]')
PLAN=$(sed -n '2p' "$ACTIVATION_FILE" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')

if [ -z "$USER_ID" ]; then
    osascript -e 'display alert "Invalid Activation File" message "USER_ID not found in activation file." as critical'
    exit 1
fi

if [ -z "$PLAN" ]; then
    PLAN="free"
fi

# ── Step 2: Collect API keys ────────────────────────────────────────────────
GEMINI_KEY=""
CF_TURN_KEY_ID=""
CF_TURN_API_TOKEN=""

if [ "$PLAN" == "byok" ] || [ "$PLAN" == "free" ]; then
    # Free devs run fully self-hosted — same key collection as BYOK.
    # Free also needs their own Supabase (handled in Step 3).

    # Gemini API Key — required
    while true; do
        GEMINI_KEY=$(ask_text "Enter your Gemini API Key:\n\nGet a free key at https://aistudio.google.com/apikeys" "")
        if [ -n "$GEMINI_KEY" ]; then
            break
        fi
        osascript -e 'display alert "API Key Required" message "A Gemini API key is required." as warning' 2>/dev/null
    done

    # Cloudflare TURN — optional
    CF_TURN_KEY_ID=$(ask_text "Cloudflare TURN Token ID (optional):\n\nCreate a free key at dash.cloudflare.com > Realtime > TURN\nLeave blank to skip — voice will still work on same network." "") || true
    if [ -n "$CF_TURN_KEY_ID" ]; then
        CF_TURN_API_TOKEN=$(ask_text "Cloudflare TURN API Token:" "") || true
    fi
fi

# Free devs need their own Supabase — ask for URL + service role key
if [ "$PLAN" == "free" ]; then
    SUPABASE_URL_OVERRIDE=$(ask_text "Enter your Supabase URL:\n\nhttps://YOUR_PROJECT.supabase.co" "")
    SUPABASE_SRK_OVERRIDE=$(ask_text "Enter your Supabase Service Role Key:" "")
fi

# ── Step 3: Resolve infra keys per plan ─────────────────────────────────────
read_template_key() {
    local key="$1"
    grep "^${key}=" "$TEMPLATE" 2>/dev/null | head -1 | cut -d'=' -f2-
}

if [ "$PLAN" == "pro" ]; then
    # Pro uses our infra — baked Supabase, hosted API, no local keys
    SUPABASE_URL=$(read_template_key "SUPABASE_URL")
    SUPABASE_SRK=$(read_template_key "SUPABASE_SERVICE_ROLE_KEY")
    CF_TURN_KEY_ID=""
    CF_TURN_API_TOKEN=""
    USE_HOSTED_API="true"
elif [ "$PLAN" == "free" ]; then
    # Free devs are fully self-hosted — their own Supabase + keys from Step 2
    SUPABASE_URL="$SUPABASE_URL_OVERRIDE"
    SUPABASE_SRK="$SUPABASE_SRK_OVERRIDE"
    USE_HOSTED_API="false"
else
    # BYOK — our Supabase, their API keys (already collected in Step 2)
    SUPABASE_URL=$(read_template_key "SUPABASE_URL")
    SUPABASE_SRK=$(read_template_key "SUPABASE_SERVICE_ROLE_KEY")
    USE_HOSTED_API="false"
fi

# ── Step 4: Write .env ──────────────────────────────────────────────────────
mkdir -p "$CONFIG_DIR"

# Write .env safely — printf '%s=...\n' keeps values out of shell expansion.
# The key name is a literal '%s', the value is passed as a separate argument
# via %s, so bash never interprets $, `, or ! inside the value.
# ALL values single-quoted in the file so the daemon's parser stays safe.
printf '%s\n' "# Voicer Desktop Host Configuration" > "$ENV_FILE"
printf '%s\n' "# Generated by Voicer Setup — $(date)" >> "$ENV_FILE"
printf '%s\n' "" >> "$ENV_FILE"
printf "SUPABASE_URL='%s'\n" "$SUPABASE_URL" >> "$ENV_FILE"
printf "SUPABASE_SERVICE_ROLE_KEY='%s'\n" "$SUPABASE_SRK" >> "$ENV_FILE"
printf "USER_ID='%s'\n" "$USER_ID" >> "$ENV_FILE"
printf "GEMINI_API_KEY='%s'\n" "$GEMINI_KEY" >> "$ENV_FILE"
printf "USE_HOSTED_API='%s'\n" "$USE_HOSTED_API" >> "$ENV_FILE"
printf "CF_TURN_KEY_ID='%s'\n" "$CF_TURN_KEY_ID" >> "$ENV_FILE"
printf "CF_TURN_API_TOKEN='%s'\n" "$CF_TURN_API_TOKEN" >> "$ENV_FILE"

# Restrict permissions — default umask 022 would make it world-readable
chmod 600 "$ENV_FILE"

# ── Step 5: Install launchd plist ────────────────────────────────────────────
# Resolve actual .app path (two levels up from Resources/)
ACTUAL_APP_DIR="$(cd "$RESOURCES_DIR/../.." && pwd)"

PLIST_DIR="$HOME/Library/LaunchAgents"
mkdir -p "$PLIST_DIR"

sed -e "s|__APP_PATH__|$ACTUAL_APP_DIR|g" \
    -e "s|__HOME__|$HOME|g" \
    "$RESOURCES_DIR/com.voicer.host.plist.template" \
    > "$PLIST_DIR/com.voicer.host.plist"

# ── Step 6: Copy uninstall script to ~/.voicer/ ─────────────────────────────
# (survives if user drags .app to Trash before uninstalling)
cp "$RESOURCES_DIR/uninstall.sh" "$CONFIG_DIR/uninstall.sh"
chmod +x "$CONFIG_DIR/uninstall.sh"

# ── Step 7: Guide user through macOS permissions ────────────────────────────
ask_ok "Voicer needs two macOS permissions to work:\n\n1. Accessibility (mouse/keyboard control)\n2. Screen Recording (screen streaming)\n\nClick OK to open System Settings.\nAdd Voicer (or python3) to both lists and toggle them ON."

# Open Accessibility pane
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"

# Wait, then open Screen Recording
sleep 2
ask_ok "After enabling Accessibility, click OK to open Screen Recording settings."
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"

ask_ok "Setup complete!\n\nVoicer will start automatically and run in the background.\nTo fully uninstall later, run:\n~/.voicer/uninstall.sh"

echo "Setup complete for user $USER_ID (plan: $PLAN)"
exit 0
