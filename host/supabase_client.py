"""
Supabase client for the desktop host — lightweight (httpx + websockets).

Uses service_role key to bypass RLS. Talks directly to PostgREST (REST)
and Supabase Realtime (WebSocket) without the heavy `supabase` Python SDK
which drags in pyiceberg and requires a C compiler.
"""

import os
import json
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


def upsert_session() -> str:
    """Create or update the session row. Returns session ID."""
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
