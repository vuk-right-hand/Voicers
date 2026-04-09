"""
Supabase client for the desktop host — lightweight (httpx + websockets).

Uses service_role key to bypass RLS. Talks directly to PostgREST (REST)
and Supabase Realtime (WebSocket) without the heavy `supabase` Python SDK
which drags in pyiceberg and requires a C compiler.
"""

import os
import json
import time
import asyncio
import logging
from typing import Callable

from dotenv import load_dotenv
import httpx
import websockets

load_dotenv()

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
USER_ID = os.environ["USER_ID"]

REST_URL = f"{SUPABASE_URL}/rest/v1"
REALTIME_URL = SUPABASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/realtime/v1/websocket"

_headers = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}


def check_subscription_blocked() -> bool:
    """Return True if the user should be blocked (lapsed paid subscriber).

    Logic: only block if plan == 'free' AND a subscription row exists with
    status 'canceled' or 'unpaid'.  Dev accounts, gifted users (plan set
    manually with no sub row), and active subscribers all pass through.
    """
    # 1. Fetch plan
    resp = httpx.get(
        f"{REST_URL}/profiles?id=eq.{USER_ID}&select=plan",
        headers=_headers,
    )
    resp.raise_for_status()
    rows = resp.json()
    plan = rows[0].get("plan", "free") if rows else "free"

    if plan != "free":
        return False  # Active paid plan — allow

    # 2. Plan is free — check if they have a canceled/unpaid subscription
    resp2 = httpx.get(
        f"{REST_URL}/subscriptions?user_id=eq.{USER_ID}&status=in.(canceled,unpaid)&select=id&limit=1",
        headers=_headers,
    )
    resp2.raise_for_status()
    return len(resp2.json()) > 0  # True = blocked (lapsed subscriber)


async def check_subscription_blocked_async() -> bool:
    return await asyncio.to_thread(check_subscription_blocked)


def upsert_session() -> str:
    """Create or update the session row. Returns session ID.

    Retries with backoff on network errors — on boot the Registry Run key
    fires before WiFi/Ethernet is fully connected, so the first few attempts
    may fail with ConnectTimeout or similar.
    """
    max_retries = 10
    for attempt in range(max_retries):
        try:
            # Delete any stale sessions for this user
            httpx.delete(
                f"{REST_URL}/sessions?user_id=eq.{USER_ID}",
                headers=_headers,
            )

            # Insert a fresh session
            resp = httpx.post(
                f"{REST_URL}/sessions",
                headers={**_headers, "Prefer": "return=representation"},
                json={
                    "user_id": USER_ID,
                    "pc_status": "waiting",
                    "signaling_data": {"type": "host-ready", "host_id": USER_ID},
                },
            )
            resp.raise_for_status()
            session = resp.json()[0]
            logger.info("Session created: %s (status: waiting)", session["id"])
            return session["id"]

        except (httpx.ConnectTimeout, httpx.ConnectError, httpx.TimeoutException, OSError) as exc:
            wait = min(2 ** attempt, 30)  # 1, 2, 4, 8, 16, 30, 30...
            logger.warning(
                "Network not ready (attempt %d/%d): %s — retrying in %ds",
                attempt + 1, max_retries, exc, wait,
            )
            time.sleep(wait)

    raise RuntimeError("Could not connect to Supabase after %d retries" % max_retries)


def write_signaling(session_id: str, data: dict) -> None:
    """Write signaling data (SDP answer or ICE candidate) to the session."""
    resp = httpx.patch(
        f"{REST_URL}/sessions?id=eq.{session_id}",
        headers=_headers,
        json={"signaling_data": data},
    )
    resp.raise_for_status()


def update_pc_status(session_id: str, status: str) -> None:
    """Update pc_status field."""
    resp = httpx.patch(
        f"{REST_URL}/sessions?id=eq.{session_id}",
        headers=_headers,
        json={"pc_status": status},
    )
    resp.raise_for_status()


# ── Async wrappers ─────────────────────────────────────────────────────────────
# httpx (sync) blocks the caller's thread. When called from an async def these
# wrappers route the blocking HTTP call into a thread pool so the aiortc/uvicorn
# event loop stays free — critical during the WebRTC handshake window when the
# phone is actively sending ICE candidates and every millisecond counts.

async def write_signaling_async(session_id: str, data: dict) -> None:
    await asyncio.to_thread(write_signaling, session_id, data)


async def update_pc_status_async(session_id: str, status: str) -> None:
    await asyncio.to_thread(update_pc_status, session_id, status)


async def upsert_session_async() -> str:
    return await asyncio.to_thread(upsert_session)


async def subscribe_signaling(session_id: str, callback: Callable[[dict], None]):
    """
    Subscribe to Realtime changes on the session row via WebSocket.
    Calls `callback` with the parsed signaling_data whenever it changes.
    Returns an asyncio Task (cancel it to unsubscribe).
    """
    url = f"{REALTIME_URL}?apikey={SUPABASE_KEY}&vsn=1.0.0"

    async def _listen():
        # Outer loop: survives hard network failures (WiFi drop, DNS error, sleep/wake).
        # websockets.connect()'s built-in async-for handles ConnectionClosed reconnects,
        # but socket-level exceptions (gaierror, TimeoutError, OSError) escape it and
        # would permanently kill the task without this wrapper.
        while True:
            try:
                async for ws in websockets.connect(url):
                    try:
                        # Join the realtime channel
                        join_msg = {
                            "topic": f"realtime:public:sessions:id=eq.{session_id}",
                            "event": "phx_join",
                            "payload": {
                                "config": {
                                    "broadcast": {"self": False},
                                    "postgres_changes": [
                                        {
                                            "event": "UPDATE",
                                            "schema": "public",
                                            "table": "sessions",
                                            "filter": f"id=eq.{session_id}",
                                        }
                                    ],
                                }
                            },
                            "ref": "1",
                        }
                        await ws.send(json.dumps(join_msg))
                        logger.info("Subscribed to Realtime for session %s", session_id)

                        # Heartbeat task
                        async def heartbeat():
                            while True:
                                await asyncio.sleep(30)
                                await ws.send(json.dumps({
                                    "topic": "phoenix",
                                    "event": "heartbeat",
                                    "payload": {},
                                    "ref": "hb",
                                }))

                        hb_task = asyncio.create_task(heartbeat())

                        try:
                            async for raw in ws:
                                msg = json.loads(raw)
                                event = msg.get("event")

                                if event == "postgres_changes":
                                    record = msg.get("payload", {}).get("data", {}).get("record", {})
                                    sig = record.get("signaling_data")
                                    if sig:
                                        parsed = json.loads(sig) if isinstance(sig, str) else sig
                                        callback(parsed)
                        finally:
                            hb_task.cancel()

                    except websockets.ConnectionClosed:
                        logger.warning("Realtime connection closed, reconnecting...")
                        continue

            except asyncio.CancelledError:
                logger.info("Realtime subscription cancelled")
                return  # Clean shutdown — do not retry

            except Exception as exc:
                # Network-level failure: WiFi drop, DNS error, laptop woke from sleep.
                # Wait 5s then let the outer while-loop attempt a fresh connection.
                logger.warning("Realtime network error (%s), retrying in 5s…", exc)
                await asyncio.sleep(5)

    task = asyncio.create_task(_listen())
    return task
