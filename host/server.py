"""
Voicer Desktop Host — FastAPI server that receives commands from the phone PWA.

Endpoints:
  POST /tap    — Move mouse to (x, y) normalized coords and click
  POST /type   — Type a text string
  POST /scroll — Scroll up or down
  POST /command — Execute a system command (keyboard shortcut, focus window, etc.)

Run: uvicorn server:app --host 0.0.0.0 --port 8000
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from input import tap, type_text, scroll, execute_command
from webrtc_host import start_host, stop_host

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start WebRTC host on boot, clean up on shutdown."""
    await start_host()
    yield
    await stop_host()


app = FastAPI(title="Voicer Host", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://voicers.vercel.app", "http://localhost:3000"],
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


class TapRequest(BaseModel):
    x: float = Field(ge=0.0, le=1.0, description="Normalized X coordinate (0.0 = left, 1.0 = right)")
    y: float = Field(ge=0.0, le=1.0, description="Normalized Y coordinate (0.0 = top, 1.0 = bottom)")


class TypeRequest(BaseModel):
    text: str


class ScrollRequest(BaseModel):
    delta: int = Field(description="Positive = scroll up, negative = scroll down")


class CommandRequest(BaseModel):
    action: str = Field(description="Command name: 'focus', 'shortcut', 'open_url', etc.")
    payload: dict = Field(default_factory=dict)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "voicer-host"}


@app.post("/tap")
def handle_tap(req: TapRequest):
    tap(req.x, req.y)
    return {"ok": True}


@app.post("/type")
def handle_type(req: TypeRequest):
    type_text(req.text)
    return {"ok": True}


@app.post("/scroll")
def handle_scroll(req: ScrollRequest):
    scroll(req.delta)
    return {"ok": True}


@app.post("/command")
def handle_command(req: CommandRequest):
    result = execute_command(req.action, req.payload)
    return {"ok": True, "result": result}
