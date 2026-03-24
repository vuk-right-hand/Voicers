# Voicer

Voice-first PWA that turns your phone into a remote controller for vibe coding on your PC/Mac/laptop. Mirrors desktop via WebRTC, controls via voice + gestures + minimal touch.

```
Phone (PWA)  ←— WebRTC (video + data channel) —→  Desktop Host (Python/FastAPI)
     ↕                                                    ↕
Supabase (Auth, Signaling)                         Local .env (BYOK keys)
```

Monorepo: `src/` = Next.js 16 PWA, `host/` = Python desktop receiver.

**Next.js 16:** `middleware.ts` is deprecated — use `src/proxy.ts` with `export function proxy()` instead.

---

## 1. The Self-Annealing Repair Loop

When a script fails or an error occurs:
1. **Analyze:** Read the stack trace and error message.
2. **Patch:** Fix the specific code. Do not rewrite entire files unless requested.
3. **Document:** Log the root cause and fix in `.claude_learnings.md` so you do not repeat the mistake. Always read this file before debugging.

## 2. The Data-First Rule

Never write application logic before the database reality is strictly defined.
- When building a feature, first define the exact Supabase schema (tables, data types, RLS policies) and the JSON payload shapes.
- Ask for explicit confirmation on the data shape. Coding only begins once approved.

## 3. Coding Standards

- **Server Components by default.** Add `"use client"` only when needed.
- **Tailwind only** — no CSS modules, no styled-components.
- **RLS on every table.** Users can only access their own data. Assume the frontend is entirely insecure.
- **No secrets in client code.** `NEXT_PUBLIC_` prefix only for truly public values.
- **Query efficiency** — always account for indexing and pagination when fetching from Supabase.
- **Mobile-first.** Test on phone-sized viewport.
- **Patch, don't rewrite.** Fix the specific broken thing. Don't refactor surrounding code unless asked.

## 4. Testing Rules

- Write tests for: data transformations, webhook handlers, Supabase Edge Functions, WebRTC signaling logic.
- Do NOT write tests for: basic UI components, simple routing, static pages.
- Focus testing on data integrity and security.

## 5. BYOK Security (Non-Negotiable)

**API keys NEVER touch our cloud database.** No `api_keys` table exists.
- PC: stored in `host/.env`
- Phone: PWA `localStorage` → sent to PC via WebRTC data channel only

## 6. UX Rules (Read Before Writing UI Code)

**Comms Button** — Single button, two modes:
- Double-tap = dictate prompt (STT → text)
- Hold = execute system command ("Run", "Send", "Open Terminal")

**Touch on Stream:**
- Quick tap = mouse click
- 0.2s hold = 150% sniper zoom for precision
- 3-finger tap = floating keyboard (vertical, draggable)
- `touch-action: none` on stream — we own ALL gestures

**Pocket Mode:**
- OLED black (`#000000`) + WakeLock API + mic stays hot
- Double-tap black screen to restore

## 7. WebRTC Rules (Non-Negotiable)

**Phone is ALWAYS the caller.** Host never generates SDP offers — it waits with `host-ready`. Phone creates a fresh offer on "Connect" tap. Stale offers = dead connections.

**Handshake via Supabase Realtime** on `sessions` table:
1. Host boots → upserts session: `pc_status = 'waiting'`, `signaling_data = { type: "host-ready" }`
2. Phone taps Connect → creates data channel FIRST, then SDP offer → writes to Supabase
3. Host receives offer → creates answer → writes to Supabase
4. ICE candidates exchanged via `signaling_data`. **Both sides MUST queue ICE candidates if remote description isn't set yet.**
5. Connected → all data flows over WebRTC (UDP), Supabase exits

**Phone creates the data channel BEFORE the SDP offer.** If created after, SDP won't include data transport rules. Host receives it via `ondatachannel`.

**Video: `<video autoPlay playsInline muted>`** — `muted` is mandatory or iOS Safari blocks auto-play (black screen).

**Never stream video over WebSocket/TCP.** TCP head-of-line blocking causes freezes on unstable networks. Always use WebRTC (UDP).

**Never use Object URLs for video frames.** Creating/destroying blob URLs at 15-30 FPS causes React re-render storms and memory leaks. Use native `MediaStream` → `video.srcObject`.

**Always downscale screen capture before encoding.** Max 1280x720 for phone viewing. Native 4K/1440p will max out CPU and lag the code editor.

## 8. Voice

- **STT:** Deepgram (streaming). **TTS:** Kokoro (local) or OpenAI.
- Jarvis feedback: host summarizes AI output in 1-2 sentences via TTS — never reads raw code.

---

## Commands

```bash
npm run dev                    # Next.js dev server
npm run build                  # Production build
cd host && uvicorn server:app --host 0.0.0.0 --port 8000 --reload  # Desktop host
```
