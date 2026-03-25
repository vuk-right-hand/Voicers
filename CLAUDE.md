# Voicers System Context
**Project:** Voice-first headless coding PWA & Desktop Host.
**Topology:** Phone PWA ← [WebRTC UDP] → Python Host. (Supabase for initial signaling only).
**Frameworks:** Next.js 16 (PWA), Python/FastAPI + aiortc (Host), Supabase.

## 1. WebRTC Protocol (Strict)
* **Phone is Caller:** Host waits with `pc_status = 'waiting'`. Phone generates fresh SDP offer on connect.
* **Data Channel First:** Phone MUST execute `pc.createDataChannel()` BEFORE creating the SDP offer. Host receives via `pc.on("datachannel")`.
* **ICE Queue:** Both clients MUST queue incoming ICE candidates until the Remote Description is fully set.
* **Video Transport:** Native `MediaStream` direct to `<video autoPlay playsInline muted>`. 
* **Banned:** NEVER stream video over WebSockets. NEVER use Object URLs for frames. 
* **Host Processing:** Python MUST downscale screen capture to max 1280x720 before WebRTC encoding.

## 2. Gesture Engine (Sticky Scope)
We own 100% of gestures. Use native `TouchEvent` API (`onTouchStart/Move/End`), NOT `PointerEvents`.
* **DOM Structure:** Outer wrapper gets `<div className="overflow-hidden w-full h-full touch-none">`. Inner element is `<video style={zoomStyle}>`.
* **Coordinate Math:** `sendTap()` MUST calculate `(clientX - rect.left) / rect.width` using `videoRef.current.getBoundingClientRect()` at `touchend`. Never use `window.innerWidth`.
* **State Machine Logic:**
  * **Hold 200ms:** 200% Zoom (Sticky - stays zoomed when finger lifts). Slop radius = 10px to cancel.
  * **Zoomed + 1-Finger Drag:** Pan viewport.
  * **Zoomed + Quick Tap:** Precision click at zoomed coords + Exit zoom.
  * **Zoomed + 2-Finger Tap:** Cancel zoom (NO click).
  * **Idle + 2-Finger Drag:** Scroll (`sendScroll`).

## 3. Voice Engine & Hardware Control
* **Deepgram STT:** Always pass `keywords=["Next.js:10", "FastAPI:10", "pyautogui:10"]` (and other tech slang) to bias the transcription.
* **Two-Lane Shortcut Engine:** Voice parsing executes on the Python Host via local `shortcuts.json`.
  * **Lane 1 (Dictation):** String replacement (e.g., "repo" -> "repository").
  * **Lane 2 (Commands):** Direct OS macros (e.g., "go" -> `pyautogui.press('enter')`).
* **Hardware Config:** `host/input.py` MUST set `pyautogui.PAUSE = 0` and `pyautogui.FAILSAFE = False` to allow zero-latency physical double-taps.

## 4. Architecture & Security Boundaries
* **BYOK Security:** API keys (OpenAI, Deepgram) NEVER touch Supabase. Store in `host/.env` or PWA `localStorage`.
* **No Secrets in Client Code:** Only `NEXT_PUBLIC_` for truly public values (Supabase URL, anon key). Never expose API keys in the client bundle.
* **Data-First Rule:** Define exact Supabase schemas and JSON payloads. Get explicit user confirmation before writing logic.
* **RLS:** Enforce on all tables. Assume PWA is entirely insecure.
* **Tailwind Only:** No CSS modules, no styled-components, no inline style objects (except dynamic values like zoom transforms).
* **Next.js 16:** Use Server Components by default. Use `src/proxy.ts` with `export function proxy()` instead of `middleware.ts`.

## 5. The Repair Loop
When an error occurs:
1. **Analyze:** Read the stack trace. Check WebRTC SDP formats and ICE states first for connection failures.
2. **Patch:** Fix the specific broken logic. Do NOT rewrite entire files or refactor surrounding code unless requested.
3. **Document:** Log root cause and fix in `.claude_learnings.md`. Read this file before beginning any debugging.

## 6. UX Modes
* **Comms Button** — Single button, two modes:
  * **Double-tap:** Dictate prompt (STT → text into active editor).
  * **Hold:** Execute system command ("Run", "Send", "Open Terminal").
* **Pocket Mode:** OLED black (`#000000`) + WakeLock API + mic stays hot. Double-tap black screen to restore.

## 7. Testing Rules
* **Test:** Data transformations, webhook handlers, Supabase Edge Functions, WebRTC signaling logic.
* **Skip:** Basic UI components, simple routing, static pages.
* Focus on data integrity and security boundaries.

## Commands
```bash
npm run dev                    # Next.js dev server
npm run build                  # Production build
cd host && python -m venv venv # Virtual env setup
uvicorn server:app --host 0.0.0.0 --port 8000 --reload  # Desktop host