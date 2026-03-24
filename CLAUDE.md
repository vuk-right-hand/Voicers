# Voicer

## Vision

Voicer is a voice-first PWA that turns your phone into a remote controller for vibe coding on your PC/Mac/laptop. It mirrors your desktop screen via WebRTC and lets you control it with voice commands, smart gestures, and a minimal touch UI. The goal: code from the BBQ, the hammock, the commute — anywhere.

**"We don't just type with voice; we drive with voice."**

## Architecture

```
Phone (PWA)  ←— WebRTC (video + data channel) —→  Desktop Host (Python/FastAPI)
     ↕                                                    ↕
Supabase (Auth, Signaling, Subscriptions)          Local .env (BYOK keys)
```

- **PWA (Next.js 15):** Mobile-first web app. Displays the desktop stream, captures gestures and voice, sends commands.
- **Desktop Host (Python):** Lightweight FastAPI server running on the user's PC. Receives commands, controls mouse/keyboard via pyautogui, captures screen via mss, streams via WebRTC.
- **Supabase:** Auth (magic link + Google + GitHub), Realtime signaling for WebRTC handshake, user profiles, subscriptions.
- **Connection:** WebRTC for low-latency video streaming and data channel. Supabase Realtime for initial signaling (SDP/ICE exchange).

## Monorepo Structure

```
Voicer/
  src/                          # Next.js PWA
    app/
      (auth)/login/             # Login page (magic link + OAuth)
      (auth)/callback/          # Auth callback handler
      (app)/dashboard/          # "Connect to my rig" main screen
      (app)/session/            # Active session (stream + controls)
      (app)/settings/           # Account + subscription
      api/stripe/               # Stripe checkout, webhook, portal (Phase 2)
    components/
      ui/                       # Shared UI primitives
      auth/                     # Auth-related components
      session/                  # Stream viewer, Comms button, gesture layer
    lib/
      supabase/                 # Supabase client (browser + server + middleware)
      webrtc/                   # Signaling + peer connection
      stripe/                   # Stripe client + config (Phase 2)
      constants.ts              # App-wide constants
    hooks/                      # Zustand stores + React hooks
    types/                      # Shared TypeScript types
  host/                         # Python Desktop Host
    server.py                   # FastAPI entry point
    input.py                    # Mouse/keyboard control (pyautogui)
    screen.py                   # Screen capture (mss)
    .env.example                # BYOK keys template
  middleware.ts                 # Next.js middleware (auth guard)
  CLAUDE.md                     # This file
```

## UX Rules (Critical — Read Before Writing UI Code)

### Comms Button (Single Button, Two Modes)
- **Double-tap** = Start dictating a prompt into the editor (STT → text)
- **Press and hold** = Issue a system command ("Run", "Open Terminal", "Send")
- Holding takes much less time than dictating, so hold = execute, not dictate

### Touch Gestures on Stream
- **Quick tap** = Normal mouse click at that position
- **Hold for 0.2 seconds** = Trigger 150% "Sniper Zoom" for precision clicks
- **3-finger tap** = Pop floating keyboard (vertical layout in horizontal mode, draggable)
- Apply `touch-action: none` on the stream view — we own ALL gestures, no browser defaults

### Pocket Mode (Commute/Headless Coding)
- Activate via UI toggle or gesture
- Screen goes OLED black (`#000000`) — on OLED screens, pixels physically turn off = battery savings
- `navigator.wakeLock.request('screen')` keeps the browser alive
- Microphone stays hot — user talks to Claude via earbuds
- **Double-tap on black screen** to restore the stream UI

### Floating Keyboard
- Vertical keyboard in horizontal phone orientation
- Draggable so user can position it left or right side
- Evoked with 3-finger tap, dismissed with same gesture

## Voice Engine

- **STT:** Deepgram (streaming, near real-time)
- **TTS:** Kokoro (local on PC, free) or OpenAI TTS API
- Audio streams to PC via WebRTC audio track
- PC processes voice → text → sends to editor or executes command
- "Jarvis" feedback: PC summarizes AI output in 1-2 sentences, sends TTS back to phone earbuds

### The Interpreter Layer
When Claude/AI finishes generating code, the host passes the output to a summarizer prompt:
> "Summarize what was just coded in one sentence for voice playback. Do NOT read code."

Then TTS plays: *"I've refactored the database schema and updated the API endpoints. There are two minor syntax warnings. Should I fix them or commit?"*

## BYOK Security (Non-Negotiable)

**API keys NEVER touch our cloud database.**

- BYOK users store their API keys locally:
  - On PC: in `host/.env` file
  - On phone: in PWA `localStorage`
  - Keys are sent directly to the PC via WebRTC data channel (peer-to-peer, encrypted)
- There is NO `api_keys` table in Supabase
- If the user's PC is off, their keys are simply not accessible — by design

## Wake-Up

- Smart plug ($15) + BIOS setting "Restore on AC Power Loss"
- PWA sends command → smart plug API toggles power → PC boots
- No Wake-on-LAN, no ethernet hacks, no router port-forwarding

## Plans & Pricing

| Plan | Price | What They Get |
|------|-------|---------------|
| Free | $0    | Trial (limited sessions) |
| BYOK | $4/m  | Full access, bring your own API keys (stored locally) |
| Pro  | $9/m  | Full access, we provide the AI/voice infrastructure |

## Referral System

- Honor-system share link → 1 month free
- No tracking if user actually posted — "When a man does a handshake we trust it"
- Dismissible banner at 15 days: "Still coding from the hammock? We'd massively appreciate a shoutout on X or Discord. [Copy Link] [Dismiss]"

## Signaling (WebRTC Handshake)

Uses Supabase Realtime on the `sessions` table:
1. Desktop host creates session row: `pc_status = 'waiting'`
2. Phone subscribes to Realtime changes on that session
3. SDP offer/answer + ICE candidates exchanged via `signaling_data` JSONB column
4. Once connected: `pc_status = 'connected'`
5. All subsequent data flows over WebRTC — Supabase is out of the loop

## Push Notifications

When the PC finishes a task while user is in another app:
- Web Push Notification: "Claude finished the API setup."
- Tap banner → reopens PWA, reconnects audio, reads Executive Summary

## Tech Stack

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4
- **State:** Zustand
- **Validation:** Zod
- **Auth:** Supabase Auth (magic link via Resend + Google OAuth + GitHub OAuth)
- **Database:** Supabase Postgres
- **Realtime:** Supabase Realtime (WebSocket signaling)
- **Payments:** Stripe (Phase 2)
- **Email:** Resend (Phase 2)
- **Desktop Host:** Python, FastAPI, pyautogui, mss
- **Voice STT:** Deepgram
- **Voice TTS:** Kokoro (local) or OpenAI TTS
- **Streaming:** WebRTC (native RTCPeerConnection + public STUN servers)

## Development Commands

```bash
# PWA (from repo root)
npm run dev          # Start Next.js dev server
npm run build        # Production build
npm run lint         # ESLint

# Desktop Host (from host/ directory)
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

## Environment Variables

### PWA (.env.local)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=    # Phase 2
STRIPE_SECRET_KEY=                      # Phase 2
STRIPE_WEBHOOK_SECRET=                  # Phase 2
STRIPE_PRICE_BYOK=                      # Phase 2
STRIPE_PRICE_PRO=                       # Phase 2
RESEND_API_KEY=                         # Phase 2
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Desktop Host (host/.env)
```
DEEPGRAM_API_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
TTS_PROVIDER=kokoro
HOST_PORT=8000
```

## Conventions

- Server Components by default. Add `"use client"` only when needed (interactivity, hooks, browser APIs).
- Tailwind only — no CSS modules, no styled-components.
- All database access through Supabase client (not raw SQL in app code).
- RLS enabled on every table. Users can only access their own data.
- No secrets in client-side code. `NEXT_PUBLIC_` prefix only for truly public values.
- Keep components small and focused. One component = one job.
- Mobile-first design. Test on phone-sized viewport.
