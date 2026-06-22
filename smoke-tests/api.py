"""Smoke test for the FastAPI SSE layer (no live LLM needed).

Run with:
    python smoke-tests/api.py
"""
import asyncio
import json
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from unittest.mock import patch


async def fake_react(query):
    yield {"type": "node_enter", "node": "reason"}
    yield {"type": "token", "content": "Hello world"}
    yield {"type": "done", "result": "Hello world"}


async def fake_research(topic):
    yield {"type": "node_enter", "node": "plan"}
    yield {"type": "done", "result": "Research complete"}


async def fake_react_error(query):
    yield {"type": "error", "message": "LLM unavailable"}


async def main() -> int:
    from httpx import AsyncClient, ASGITransport

    with (
        patch("backend.main.run_react", side_effect=fake_react),
        patch("backend.main.run_research", side_effect=fake_research),
    ):
        from backend.main import app

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
            # POST /api/run
            r = await c.post("/api/run", json={"mode": "react", "query": "test"})
            assert r.status_code == 200, f"POST /api/run failed: {r.text}"
            run_id = r.json()["run_id"]
            print(f"PASS  POST /api/run returns run_id ({run_id[:8]}...)")

            # GET /api/stream/{run_id}
            events = []
            async with c.stream("GET", f"/api/stream/{run_id}") as resp:
                assert resp.status_code == 200
                async for line in resp.aiter_lines():
                    if line.startswith("data: "):
                        events.append(json.loads(line[6:]))

            types = [e["type"] for e in events]
            print(f"PASS  GET /api/stream -- events: {types}")
            assert events[-1]["type"] == "done", f"last event was {events[-1]}"
            print("PASS  stream closes with done event")

            # autoresearch mode
            r2 = await c.post("/api/run", json={"mode": "autoresearch", "query": "RAG vs fine-tuning"})
            assert r2.status_code == 200
            run_id2 = r2.json()["run_id"]
            events2 = []
            async with c.stream("GET", f"/api/stream/{run_id2}") as resp2:
                async for line in resp2.aiter_lines():
                    if line.startswith("data: "):
                        events2.append(json.loads(line[6:]))
            assert events2[-1]["type"] == "done"
            print("PASS  autoresearch mode streams and closes cleanly")

            # 404 for unknown run_id
            r3 = await c.get("/api/stream/nonexistent-id")
            assert r3.status_code == 404
            print("PASS  unknown run_id returns 404")

            # error event propagates
            with patch("backend.main.run_react", side_effect=fake_react_error):
                r4 = await c.post("/api/run", json={"mode": "react", "query": "boom"})
                run_id4 = r4.json()["run_id"]
                err_events = []
                async with c.stream("GET", f"/api/stream/{run_id4}") as resp4:
                    async for line in resp4.aiter_lines():
                        if line.startswith("data: "):
                            err_events.append(json.loads(line[6:]))
                assert any(e["type"] == "error" for e in err_events), f"no error event: {err_events}"
                print("PASS  error event propagates through SSE stream")

    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
