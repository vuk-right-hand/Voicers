#!/bin/bash
set -e

# ─── Voicer macOS Installer Build Script ─────────────────────────────────────
# Downloads standalone Python, installs deps, assembles .app bundle, creates DMG.
# Run from: installer-mac/ directory on a Mac.
# ─────────────────────────────────────────────────────────────────────────────

# python-build-standalone release (arm64 for Apple Silicon, Rosetta for Intel)
PYTHON_VERSION="3.12.8"
PYTHON_BUILD_TAG="20241219"
PYTHON_ARCHIVE="cpython-${PYTHON_VERSION}+${PYTHON_BUILD_TAG}-aarch64-apple-darwin-install_only_stripped.tar.gz"
PYTHON_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD_TAG}/${PYTHON_ARCHIVE}"

BUNDLE="bundle"
APP_NAME="Voicer.app"
DMG_NAME="VoicerInstaller.dmg"

HOST_FILES=(
    server.py
    webrtc_host.py
    screen.py
    input.py
    gemini_live.py
    supabase_client.py
    clipboard_watcher_mac.py
    requirements.txt
    requirements-mac.txt
)

# ─── Read config from host/.env (never hardcoded in source) ─────────────────
HOST_ENV="../host/.env"
if [ ! -f "$HOST_ENV" ]; then
    echo "ERROR: host/.env not found. Copy host/.env.example and fill in values."
    exit 1
fi

read_env_key() {
    grep "^${1}=" "$HOST_ENV" 2>/dev/null | head -1 | cut -d'=' -f2-
}

SUPABASE_URL=$(read_env_key "SUPABASE_URL")
SUPABASE_SRK=$(read_env_key "SUPABASE_SERVICE_ROLE_KEY")

if [ -z "$SUPABASE_URL" ] || [ -z "$SUPABASE_SRK" ]; then
    echo "ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required in host/.env"
    exit 1
fi

# Cloudflare TURN keys (optional — only needed for BYOK/dev builds)
CF_TURN_KEY_ID=$(read_env_key "CF_TURN_KEY_ID")
CF_TURN_API_TOKEN=$(read_env_key "CF_TURN_API_TOKEN")

echo "═══════════════════════════════════════════"
echo "  Voicer macOS Installer Build"
echo "═══════════════════════════════════════════"

# ─── Step 1: Clean previous build ───────────────────────────────────────────
echo ""
echo "[1/9] Cleaning previous build..."
rm -rf "$BUNDLE" "$APP_NAME" "$DMG_NAME"
mkdir -p "$BUNDLE"

# ─── Step 2: Download standalone Python ──────────────────────────────────────
echo "[2/9] Downloading Python ${PYTHON_VERSION} (standalone, arm64)..."
if [ ! -f "$PYTHON_ARCHIVE" ]; then
    curl -L -o "$PYTHON_ARCHIVE" "$PYTHON_URL"
fi

echo "Extracting..."
mkdir -p "$BUNDLE/python"
tar -xzf "$PYTHON_ARCHIVE" -C "$BUNDLE/python" --strip-components=1

# ─── Step 3: Install Python dependencies ─────────────────────────────────────
echo "[3/9] Installing Python dependencies..."
"$BUNDLE/python/bin/python3" -m pip install \
    -r "../host/requirements-mac.txt" \
    --no-warn-script-location -q

# ─── Step 4: Copy host files ────────────────────────────────────────────────
echo "[4/9] Copying host files..."
mkdir -p "$BUNDLE/host"
for f in "${HOST_FILES[@]}"; do
    if [ -f "../host/$f" ]; then
        cp "../host/$f" "$BUNDLE/host/$f"
    else
        echo "  WARNING: ../host/$f not found, skipping"
    fi
done

# ─── Step 5: Bake env.template ──────────────────────────────────────────────
echo "[5/9] Baking env.template..."
cat > "$BUNDLE/env.template" << TMPLEOF
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SRK}
USER_ID=
GEMINI_API_KEY=
USE_HOSTED_API=false
CF_TURN_KEY_ID=${CF_TURN_KEY_ID}
CF_TURN_API_TOKEN=${CF_TURN_API_TOKEN}
TMPLEOF

# ─── Step 6: Copy installer scripts ─────────────────────────────────────────
echo "[6/9] Copying installer scripts..."
cp setup.sh "$BUNDLE/setup.sh"
cp com.voicer.host.plist.template "$BUNDLE/com.voicer.host.plist.template"
cp uninstall.sh "$BUNDLE/uninstall.sh"

# ─── Step 7: Assemble .app bundle ───────────────────────────────────────────
echo "[7/9] Assembling ${APP_NAME}..."
mkdir -p "${APP_NAME}/Contents/MacOS"
mkdir -p "${APP_NAME}/Contents/Resources"

# Info.plist
cp Info.plist "${APP_NAME}/Contents/Info.plist"

# Entry point
cp voicer "${APP_NAME}/Contents/MacOS/voicer"

# Resources
cp -R "$BUNDLE/python" "${APP_NAME}/Contents/Resources/python"
cp -R "$BUNDLE/host" "${APP_NAME}/Contents/Resources/host"
cp "$BUNDLE/env.template" "${APP_NAME}/Contents/Resources/env.template"
cp "$BUNDLE/setup.sh" "${APP_NAME}/Contents/Resources/setup.sh"
cp "$BUNDLE/com.voicer.host.plist.template" "${APP_NAME}/Contents/Resources/com.voicer.host.plist.template"
cp "$BUNDLE/uninstall.sh" "${APP_NAME}/Contents/Resources/uninstall.sh"

# Icon (if available)
if [ -f "icon.icns" ]; then
    cp "icon.icns" "${APP_NAME}/Contents/Resources/icon.icns"
fi

# ─── Step 8: Set permissions ────────────────────────────────────────────────
echo "[8/9] Setting permissions..."
chmod +x "${APP_NAME}/Contents/MacOS/voicer"
chmod +x "${APP_NAME}/Contents/Resources/setup.sh"
chmod +x "${APP_NAME}/Contents/Resources/uninstall.sh"

# ─── Step 9: Create DMG ─────────────────────────────────────────────────────
echo "[9/9] Creating DMG..."
hdiutil create \
    -volname "Voicer" \
    -srcfolder "${APP_NAME}" \
    -ov \
    -format UDZO \
    "${DMG_NAME}"

echo ""
echo "═══════════════════════════════════════════"
echo "  BUILD COMPLETE"
echo "  Output: ${DMG_NAME}"
echo "═══════════════════════════════════════════"
