import asyncio
import json
import uuid
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.graphs.react_loop import run_graph as run_react
from backend.graphs.autoresearch_loop import run_graph as run_research

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# run_id → asyncio.Queue[dict | None]
_registry: dict[str, asyncio.Queue] = {}


class RunRequest(BaseModel):
    mode: Literal["react", "autoresearch"]
    query: str


async def _feed_queue(queue: asyncio.Queue, run_gen) -> None:
    try:
        async for event in run_gen:
            await queue.put(event)
            if event.get("type") in ("done", "error"):
                return
    except Exception as e:
        await queue.put({"type": "error", "message": str(e)})
    finally:
        await queue.put(None)  # sentinel: stream is over


@app.post("/api/run")
async def start_run(req: RunRequest) -> dict:
    run_id = str(uuid.uuid4())
    queue: asyncio.Queue = asyncio.Queue()
    _registry[run_id] = queue

    gen = run_react(req.query) if req.mode == "react" else run_research(req.query)
    asyncio.create_task(_feed_queue(queue, gen))

    return {"run_id": run_id}


@app.get("/api/stream/{run_id}")
async def stream_run(run_id: str) -> StreamingResponse:
    queue = _registry.get(run_id)
    if queue is None:
        raise HTTPException(status_code=404, detail="run_id not found")

    async def event_generator():
        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n"
                if event.get("type") in ("done", "error"):
                    break
        finally:
            _registry.pop(run_id, None)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
