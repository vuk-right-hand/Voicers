# Voicer Desktop Host

Lightweight Python server that runs on your PC/Mac/laptop. It receives commands from the Voicer PWA on your phone and controls your desktop.

## Quick Start

```bash
cd host
pip install -r requirements.txt
cp .env.example .env  # Add your BYOK API keys here
uvicorn server:app --host 0.0.0.0 --port 8000
```

## Endpoints

| Method | Path       | Description                              |
|--------|------------|------------------------------------------|
| GET    | /health    | Health check                             |
| POST   | /tap       | Click at normalized (x, y) coordinates   |
| POST   | /type      | Type a text string                       |
| POST   | /scroll    | Scroll up/down                           |
| POST   | /command   | Execute system command (shortcut, focus)  |

## Security Note

Your BYOK API keys (Anthropic, OpenAI, Deepgram) are stored **only** in the local `.env` file on this machine. They are never uploaded to any cloud service.
