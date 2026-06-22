# Progress

## Phase 1 — LLM Client

- [x] Create `backend/config.py` with env var loading (`OPENAI_API_KEY`, `OLLAMA_BASE_URL`, `MODEL_NAME`)
- [x] Implement client factory: returns `openai.OpenAI` pointed at OpenAI or Ollama based on env
- [x] Create `.env.example` with all required keys documented
- [x] Smoke-test: client instantiates and completes a simple prompt

---

## Phase 2 — Web Search Tool

- [x] Create `backend/tools/search.py` wrapping Tavily API
- [x] Accept a query string, return a list of `{ title, url, content }` results
- [x] Load `TAVILY_API_KEY` from env via `config.py`
- [x] Smoke-test: tool returns results for a sample query

---

## Phase 3 — ReAct Graph

Demo query: *"Who is the current world chess champion, when did they win the title, and what is their FIDE rating right now?"*

- [x] Define `AgentState` TypedDict (`messages`, `iteration`, `max_iterations`)
- [x] Implement `reason` node — LLM call, decides next action or finish
- [x] Implement `tool_call` node — executes web search via `ToolNode`
- [x] Implement `observe` node — appends result to messages, increments iteration counter
- [x] Wire conditional edge from `reason`: tool call present → `tool_call`, else → `END`
- [x] Wire back-edge: `observe` → `reason`
- [x] Enforce max iteration guard on the conditional edge
- [x] Emit SSE events at each node: `node_enter`, `token`, `tool_call`, `tool_result`, `node_exit`, `loop_back`, `done`
- [x] Expose `run_graph(query) -> AsyncGenerator[dict]` for the API layer to consume

---

## Phase 4 — Autoresearch Graph

Demo query: *"What are the practical tradeoffs between RAG and fine-tuning for building LLM-powered products?"*

- [x] Define `ResearchState` TypedDict (`topic`, `queries`, `search_results`, `draft`, `gaps`, `cycle`, `max_cycles`)
- [x] Implement `plan` node — LLM call producing 3–5 search queries
- [x] Implement `search` node — runs all queries via Tavily, appends to `search_results`
- [x] Implement `synthesize` node — LLM call producing structured draft from all results
- [x] Implement `evaluate` node — LLM call with structured output: gaps list or done signal
- [x] Wire linear edges: `plan → search → synthesize → evaluate`
- [x] Wire conditional edge from `evaluate`: gaps present → `search`, else → `END`
- [x] Enforce max cycle guard on the conditional edge
- [x] Emit SSE events matching the same schema as Phase 3
- [x] Expose `run_graph(topic) -> AsyncGenerator[dict]` for the API layer

---

## Phase 5 — FastAPI + SSE Layer

- [x] Create `backend/main.py` with FastAPI app
- [x] `POST /api/run` — accepts `{ mode, query }`, creates a `run_id`, starts graph as background task, returns `{ run_id }`
- [x] `GET /api/stream/{run_id}` — SSE endpoint that streams events from the running graph
- [x] In-memory run registry mapping `run_id → asyncio.Queue`
- [x] Graph tasks push SSE event dicts into the queue; stream endpoint drains and flushes
- [x] Handle `done` and `error` events as terminal signals (close stream)
- [x] Add CORS middleware for local frontend dev
- [x] Dependencies declared in root `pyproject.toml` (no separate requirements.txt needed)

---

## Phase 6 — End-to-End Demo Case Testing

- [x] Run ReAct demo query; verify ≥ 2 `loop_back` events emitted and final answer is correct
- [x] Run Autoresearch demo query; verify `plan` produces ≥ 3 queries, `evaluate` fires at least once, final draft is substantive
- [x] Verify SSE stream closes cleanly with a `done` event for both modes
- [x] Verify `error` event is emitted and stream closes on LLM or search failure
- [x] Verify max iteration / max cycle caps are respected

---

## Phase 7 — Frontend

### Static concept pages
- [x] `frontend/index.html` — title, one-paragraph description, side-by-side paradigm comparison, nav links
- [x] `frontend/loop-engineering.html` — ReAct pattern explanation, step-by-step breakdown, static vis.js graph
- [x] `frontend/autoresearch.html` — research pipeline explanation, cycle breakdown, static vis.js graph
- [x] `frontend/css/style.css` — shared styles across all pages

### Demo page
- [x] `frontend/demo.html` — two-panel layout: graph (left) + output (right), mode toggle, chat input
- [x] `frontend/js/graph-viz.js` — vis.js graph rendering for both modes; node highlight on `node_enter`, pulse on `node_exit`, dashed animated edge on `loop_back`, iteration counter on looping nodes
- [x] `frontend/js/demo.js` — SSE client wiring: POST `/api/run`, open `/api/stream/{run_id}`, dispatch events to graph-viz and output panel
- [x] Token-by-token streaming rendered in output panel
- [x] Collapsible tool call log (query sent → results received)
- [x] Final answer rendered as markdown
- [x] Mode toggle switches both the active graph visualization and the backend mode
