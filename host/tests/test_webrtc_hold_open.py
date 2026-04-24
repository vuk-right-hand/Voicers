"""
Regression test — connection must stay open for a long enough hold.

Reproduces the production symptom from voicer.log where every WebRTC connection
dies at ~45-60s with `Connection(N) Consent to send expired`. Two independent
checks:

  1. **Event loop health** — schedules a 100 ms heartbeat for the duration of
     the test. If any iteration slips by >250 ms, the event loop was blocked
     long enough that aioice's consent-check timer (5 s) would miss responses
     and consent would expire after 30 s.

  2. **aiortc loopback** — spins up two RTCPeerConnections in the same event
     loop (host_pc + phone_pc), establishes a real WebRTC connection over
     host candidates (no TURN, no network), and asserts connectionState
     stays "connected" for HOLD_SECONDS.

Concurrently runs a fake GeminiLive session (FakeLiveSession from conftest)
so the host's _send_loop / _recv_loop / _flush_loop background tasks are
present — that's what we're testing for event-loop interference.

Why this matters: April 13 LTE worked for 45 min. April 24 dies at 45 s.
Three commits landed since (2f5008b, 5e24e84, f014b2d) plus 5 uncommitted
files. This test discriminates: if it fails on a checkout, that checkout
contains the regression.

Run:  cd host && venv/Scripts/python.exe -m pytest tests/test_webrtc_hold_open.py -v -s
"""
from __future__ import annotations

import asyncio
import logging
import sys
import time
from pathlib import Path

import pytest

HOST_DIR = Path(__file__).resolve().parents[1]
if str(HOST_DIR) not in sys.path:
    sys.path.insert(0, str(HOST_DIR))

import os

import httpx
from aiortc import (
    RTCConfiguration,
    RTCIceServer,
    RTCPeerConnection,
    RTCSessionDescription,
)


# ── Tunables ──────────────────────────────────────────────────────────────────
# HOLD_SECONDS = 90 — production symptom is consent expiry at 45-60 s, so
# we need a hold longer than that. STUN consent freshness retries at 5 s
# intervals and gives up after 30 s of failures, so 90 s gives 2-3 windows
# for the failure to surface.
HOLD_SECONDS = 90.0
HEARTBEAT_INTERVAL = 0.1
SLIPPAGE_FAIL_MS = 250  # 2.5x the heartbeat interval


@pytest.mark.asyncio
async def test_event_loop_stays_responsive_under_gemini_load(fake_client_factory):
    """No real WebRTC — just measures event loop slippage while GeminiLive runs.

    Faster signal than the full loopback test. If this fails, the loopback
    test is essentially guaranteed to fail too — and we know the bug is in
    one of the Gemini background tasks blocking the loop.
    """
    import gemini_live

    factory, _ = fake_client_factory
    factory()  # installs FakeClient on gemini_live.genai.Client

    transcripts: list[str] = []
    g = gemini_live.GeminiLive(
        on_transcript=lambda text, final: transcripts.append(text),
        on_session_dead=None,
    )
    await g.start()

    slippages_ms: list[float] = []
    deadline = time.monotonic() + 5.0  # short — just sanity-check

    try:
        next_tick = time.monotonic()
        while time.monotonic() < deadline:
            next_tick += HEARTBEAT_INTERVAL
            sleep_for = max(0.0, next_tick - time.monotonic())
            await asyncio.sleep(sleep_for)
            actual_slip = (time.monotonic() - next_tick) * 1000
            slippages_ms.append(actual_slip)
    finally:
        await g.stop()

    max_slip = max(slippages_ms) if slippages_ms else 0
    p99 = sorted(slippages_ms)[int(len(slippages_ms) * 0.99)] if slippages_ms else 0
    print(
        f"\n[event-loop] samples={len(slippages_ms)} "
        f"max_slip={max_slip:.1f}ms p99={p99:.1f}ms"
    )
    assert max_slip < SLIPPAGE_FAIL_MS, (
        f"Event loop blocked for {max_slip:.0f}ms — aioice consent checks would "
        f"miss and connection would die at 30 s. Suspect a sync call in a "
        f"GeminiLive background task."
    )


@pytest.mark.asyncio
async def test_loopback_connection_stays_alive_for_hold_period(fake_client_factory, caplog):
    """Real aiortc loopback — two PCs, real ICE+DTLS+SCTP, no network needed.

    Reproduces the symptom from production. If this test fails on a given
    code revision, that revision contains the regression. If it passes,
    the regression is elsewhere (network/TURN/uncommitted code/etc).
    """
    caplog.set_level(logging.WARNING)

    import gemini_live

    # Start a fake Gemini session running concurrently so the host's
    # background tasks (send_loop, recv_loop, flush_loop) are exercised.
    factory, _ = fake_client_factory
    factory()  # installs FakeClient on gemini_live.genai.Client

    g = gemini_live.GeminiLive(
        on_transcript=lambda *a: None, on_session_dead=None,
    )
    await g.start()

    # ── Two PCs in the same event loop ───────────────────────────────────────
    host_pc = RTCPeerConnection()
    phone_pc = RTCPeerConnection()

    state_history_host: list[str] = []
    state_history_phone: list[str] = []

    @host_pc.on("connectionstatechange")
    async def _h():
        state_history_host.append(host_pc.connectionState)

    @phone_pc.on("connectionstatechange")
    async def _p():
        state_history_phone.append(phone_pc.connectionState)

    # Phone is the caller — creates DC before offer (matches production)
    dc_phone = phone_pc.createDataChannel("commands")
    phone_pc.addTransceiver("video", direction="recvonly")

    dc_open_event = asyncio.Event()
    dc_host_holder: list[object] = []

    @host_pc.on("datachannel")
    def _on_dc(channel):
        dc_host_holder.append(channel)

        @channel.on("open")
        def _on_open():
            dc_open_event.set()

        # aiortc fires 'open' before _on_dc runs — guard against the race
        # (same defense as host/webrtc_host.py:_setup_data_channel)
        if channel.readyState == "open":
            dc_open_event.set()

    # Phone-side open also signals (phone created the channel)
    @dc_phone.on("open")
    def _phone_open():
        dc_open_event.set()
    if dc_phone.readyState == "open":
        dc_open_event.set()

    # ── Offer / answer / ICE (vanilla, no trickle) ───────────────────────────
    await phone_pc.setLocalDescription(await phone_pc.createOffer())
    await host_pc.setRemoteDescription(
        RTCSessionDescription(sdp=phone_pc.localDescription.sdp, type="offer")
    )
    await host_pc.setLocalDescription(await host_pc.createAnswer())
    await phone_pc.setRemoteDescription(
        RTCSessionDescription(sdp=host_pc.localDescription.sdp, type="answer")
    )

    # Wait for the connection to actually establish
    try:
        await asyncio.wait_for(dc_open_event.wait(), timeout=10.0)
    except asyncio.TimeoutError:
        pytest.fail(
            f"DC never opened. host states={state_history_host} "
            f"phone states={state_history_phone}"
        )

    print(f"\n[loopback] connected — holding for {HOLD_SECONDS}s")

    # ── Hold the connection open and watch for state changes ─────────────────
    bad_states_host: list[tuple[float, str]] = []
    bad_states_phone: list[tuple[float, str]] = []
    slippages_ms: list[float] = []

    start = time.monotonic()
    next_tick = start
    while time.monotonic() - start < HOLD_SECONDS:
        next_tick += HEARTBEAT_INTERVAL
        sleep_for = max(0.0, next_tick - time.monotonic())
        await asyncio.sleep(sleep_for)
        slip = (time.monotonic() - next_tick) * 1000
        slippages_ms.append(slip)

        if host_pc.connectionState not in ("connected", "new"):
            bad_states_host.append((time.monotonic() - start, host_pc.connectionState))
        if phone_pc.connectionState not in ("connected", "new"):
            bad_states_phone.append((time.monotonic() - start, phone_pc.connectionState))

        # Bail early if we've already failed
        if bad_states_host or bad_states_phone:
            break

    # ── Cleanup ──────────────────────────────────────────────────────────────
    await g.stop()
    await host_pc.close()
    await phone_pc.close()

    max_slip = max(slippages_ms) if slippages_ms else 0
    print(
        f"[loopback] held={time.monotonic() - start:.1f}s "
        f"host_final={host_pc.connectionState} phone_final={phone_pc.connectionState} "
        f"max_event_loop_slip={max_slip:.0f}ms"
    )

    # Surface "Task was destroyed but it is pending!" — if this appears in
    # captured stderr/logs, aiortc background tasks were GC'd live. That's
    # one of the production symptoms.
    destroyed_task_warnings = [
        rec.message for rec in caplog.records
        if "destroyed but it is pending" in rec.message
    ]

    assert not bad_states_host, (
        f"host PC left 'connected' state during hold: {bad_states_host[:5]}"
    )
    assert not bad_states_phone, (
        f"phone PC left 'connected' state during hold: {bad_states_phone[:5]}"
    )
    assert max_slip < SLIPPAGE_FAIL_MS, (
        f"Event loop blocked for {max_slip:.0f}ms during hold — "
        f"aioice consent checks would miss"
    )
    assert not destroyed_task_warnings, (
        f"aiortc/aioice tasks destroyed mid-flight: {destroyed_task_warnings[:3]}"
    )


# Live TURN-relay test removed — aiortc 1.14 RTCConfiguration doesn't expose
# iceTransportPolicy, so we can't force relay-only mode in pure loopback.
# (Both PCs share localhost host candidates and would always prefer those.)
# Real-network TURN behavior must be verified end-to-end with a phone client.


def _fetch_real_turn_or_skip() -> list[RTCIceServer]:
    """Pull live Cloudflare TURN credentials from Vercel using the installed
    .env. Skips the test if creds aren't reachable (e.g. running off network
    or in CI without the env)."""
    from dotenv import load_dotenv
    # Load the host's actual .env so SUPABASE_SERVICE_ROLE_KEY + USER_ID work
    load_dotenv(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Voicer" / "host" / ".env")
    site = os.environ.get("SITE_URL", "https://voicers.vercel.app")
    user_id = os.environ.get("USER_ID")
    sb_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not user_id or not sb_key:
        pytest.skip("USER_ID/SUPABASE_SERVICE_ROLE_KEY not in env — skipping live TURN test")
    try:
        resp = httpx.post(
            f"{site}/api/turn-credentials",
            headers={
                "Authorization": f"Bearer {sb_key}",
                "Content-Type": "application/json",
            },
            json={"user_id": user_id},
            timeout=10.0,
        )
    except Exception as exc:
        pytest.skip(f"Could not reach Vercel TURN API: {exc}")
    if resp.status_code != 200:
        pytest.skip(f"TURN API returned {resp.status_code}: {resp.text[:200]}")
    raw = resp.json().get("iceServers", [])
    out: list[RTCIceServer] = []
    for s in raw:
        urls = s.get("urls", [])
        username = s.get("username")
        credential = s.get("credential")
        if username and credential:
            out.append(RTCIceServer(urls=urls, username=username, credential=credential))
    if not out:
        pytest.skip("TURN API returned no usable servers")
    return out


@pytest.mark.skip(reason="aiortc 1.14 RTCConfiguration has no iceTransportPolicy — needs phone for real TURN test")
@pytest.mark.asyncio
async def test_loopback_through_real_cloudflare_turn(fake_client_factory, caplog):
    """The honest test — both PCs forced through real Cloudflare TURN relay,
    held for HOLD_SECONDS. This is the path your phone takes in production.

    If this fails on HEAD, the regression is in our aiortc/aioice + Cloudflare
    TURN integration. If it passes, the production failure is specific to the
    real phone's WebRTC stack interacting with Cloudflare from your LTE NAT.

    Skipped automatically if env doesn't have credentials.
    """
    caplog.set_level(logging.WARNING)

    ice_servers = _fetch_real_turn_or_skip()
    print(f"\n[turn-relay] fetched {len(ice_servers)} TURN servers from Cloudflare")

    import gemini_live
    factory, _ = fake_client_factory
    factory()
    g = gemini_live.GeminiLive(
        on_transcript=lambda *a: None, on_session_dead=None,
    )
    await g.start()

    # iceTransportPolicy="relay" forces both peers through TURN — the same
    # network path your phone uses when LTE NAT prevents direct connection.
    cfg = RTCConfiguration(iceServers=ice_servers, iceTransportPolicy="relay")
    host_pc = RTCPeerConnection(configuration=cfg)
    phone_pc = RTCPeerConnection(configuration=cfg)

    dc_open = asyncio.Event()

    @host_pc.on("datachannel")
    def _on_dc(channel):
        @channel.on("open")
        def _o():
            dc_open.set()
        if channel.readyState == "open":
            dc_open.set()

    dc_phone = phone_pc.createDataChannel("commands")
    phone_pc.addTransceiver("video", direction="recvonly")

    @dc_phone.on("open")
    def _po():
        dc_open.set()
    if dc_phone.readyState == "open":
        dc_open.set()

    await phone_pc.setLocalDescription(await phone_pc.createOffer())
    await host_pc.setRemoteDescription(
        RTCSessionDescription(sdp=phone_pc.localDescription.sdp, type="offer")
    )
    await host_pc.setLocalDescription(await host_pc.createAnswer())
    await phone_pc.setRemoteDescription(
        RTCSessionDescription(sdp=host_pc.localDescription.sdp, type="answer")
    )

    try:
        await asyncio.wait_for(dc_open.wait(), timeout=20.0)
    except asyncio.TimeoutError:
        pytest.fail(
            f"DC never opened through TURN relay. "
            f"host={host_pc.connectionState} phone={phone_pc.connectionState}"
        )

    print(f"[turn-relay] connected via TURN — holding for {HOLD_SECONDS}s")

    bad_states: list[tuple[float, str, str]] = []
    start = time.monotonic()
    while time.monotonic() - start < HOLD_SECONDS:
        await asyncio.sleep(0.5)
        elapsed = time.monotonic() - start
        if host_pc.connectionState not in ("connected", "new"):
            bad_states.append((elapsed, "host", host_pc.connectionState))
        if phone_pc.connectionState not in ("connected", "new"):
            bad_states.append((elapsed, "phone", phone_pc.connectionState))
        if bad_states:
            print(f"[turn-relay] FAILED at {elapsed:.1f}s — {bad_states[:3]}")
            break

    await g.stop()
    await host_pc.close()
    await phone_pc.close()

    print(
        f"[turn-relay] held={time.monotonic() - start:.1f}s "
        f"host_final={host_pc.connectionState} phone_final={phone_pc.connectionState}"
    )

    consent_warnings = [
        rec.message for rec in caplog.records
        if "Consent to send expired" in rec.message
    ]
    assert not bad_states, (
        f"Connection died through Cloudflare TURN relay: {bad_states[:5]}\n"
        f"This reproduces the production symptom. The bug is in our "
        f"aiortc/aioice + Cloudflare TURN integration."
    )
    assert not consent_warnings, (
        f"Consent expiry occurred: {consent_warnings}"
    )
