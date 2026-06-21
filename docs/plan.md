# Implementation Plan

## Overview

A single-shot local demo app contrasting two AI agent paradigms — **Loop Engineering** and **Autoresearch** — through explanatory pages and a live interactive chat interface with real-time graph animation.

---

## Stack

| Layer | Choice | Reason |
|---|---|---|
| LLM client | `openai` Python SDK | Single SDK; swap OpenAI ↔ Ollama via `OLLAMA_BASE_URL` env var |
| Web search | Tavily (free tier) | Required for autoresearch; 1k free searches/month covers demo use |
| Backend | Python FastAPI + SSE | Lightweight, streaming-native, no WebSocket overhead |
| Graphs | Pure Python state machines | Full control, no framework overhead, logic is explicit and readable |
| Frontend | Vanilla HTML/CSS/JS | No build step, no framework, easy to audit and modify |
| Graph viz | `vis.js` Network | Handles directed graphs natively, easy to animate node/edge states |

---

## Project Structure

```
loop_autoresearch_demo/
├── backend/
│   ├── main.py                  # FastAPI app + SSE endpoint
│   ├── graphs/
│   │   ├── loop_graph.py        # ReAct agentic loop
│   │   └── research_graph.py    # Autoresearch pipeline loop
│   ├── tools/
│   │   └── search.py            # Tavily search wrapper
│   ├── config.py                # Env var loading + model client factory
│   └── requirements.txt
├── frontend/
│   ├── index.html               # Homepage
│   ├── loop-engineering.html    # Loop Engineering concept page
│   ├── autoresearch.html        # Autoresearch concept page
│   ├── demo.html                # Live demo: chat + graph animation
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── graph-viz.js         # vis.js graph rendering + node animation
│       └── demo.js              # SSE client + chat UI logic
├── docs/
│   └── plan.md                  # This file
├── .env.example
└── README.md
```

---

## The Two Graphs

### Graph 1 — Agentic Loop (ReAct Pattern)

Models the core loop engineering pattern: the agent reasons, acts, observes the result, and loops until the task is complete.

```
START → REASON → TOOL_CALL → OBSERVE → REASON (loop)
                            ↘
                            DONE (agent decides task is complete)
```

**Nodes:**
- `START` — entry point, initializes state with user query
- `REASON` — LLM call: given history + tool results, decide next action or finish
- `TOOL_CALL` — execute the chosen tool (web search)
- `OBSERVE` — append tool result to context, increment iteration counter
- `DONE` — emit final answer, terminate

**Loop condition:** Agent outputs a final answer instead of a tool call, or max iterations reached.

---

### Graph 2 — Autoresearch Loop

Models a structured research pipeline where the agent plans queries, searches, synthesizes findings, evaluates quality, and loops back to search if gaps remain.

```
START → PLAN → SEARCH → SYNTHESIZE → EVALUATE → SEARCH (loop if gaps found)
                                              ↘
                                              DONE (quality threshold met)
```

**Nodes:**
- `START` — entry point, receives research topic
- `PLAN` — LLM call: break topic into specific search queries (3–5 queries)
- `SEARCH` — execute queries via Tavily, collect results
- `SYNTHESIZE` — LLM call: combine all search results into a structured draft
- `EVALUATE` — LLM call: assess draft completeness; output either gaps (new queries) or done signal
- `DONE` — emit final research report, terminate

**Loop condition:** Evaluator identifies knowledge gaps → generates new queries → loops back to SEARCH. Exits when satisfied or max iterations reached.

---

## Backend API

### Endpoints

**`POST /api/run`**
```json
// Request
{ "mode": "loop" | "research", "query": "string" }

// Response
{ "run_id": "uuid" }
```

**`GET /api/stream/{run_id}`**

SSE stream. Each event is a JSON payload on the `data:` field.

### SSE Event Schema

```json
{ "type": "node_enter", "node": "reason" }
{ "type": "token",      "content": "I should search for..." }
{ "type": "tool_call",  "tool": "search", "args": { "query": "..." } }
{ "type": "tool_result","tool": "search", "content": "..." }
{ "type": "node_exit",  "node": "reason" }
{ "type": "loop_back",  "from": "observe", "to": "reason", "iteration": 2 }
{ "type": "done",       "result": "final answer text" }
{ "type": "error",      "message": "..." }
```

### Configuration (`.env`)

```env
# LLM — pick one mode:
OPENAI_API_KEY=sk-...          # Use OpenAI API
# OLLAMA_BASE_URL=http://localhost:11434/v1   # Use local Ollama instead

MODEL_NAME=gpt-4o-mini         # Or any Ollama model name

# Search
TAVILY_API_KEY=tvly-...
```

`config.py` reads these and returns a configured `openai.OpenAI` client — OpenAI or Ollama transparently.

---

## Frontend Pages

### Homepage (`index.html`)
- Project title and one-paragraph description
- Navigation to all pages
- Brief explanation of the two paradigms side-by-side
- Link to the live demo

### Loop Engineering Page (`loop-engineering.html`)
- Written explanation of what loop engineering is
- The ReAct pattern explained step by step
- Static vis.js diagram of the loop graph
- When to use this approach

### Autoresearch Page (`autoresearch.html`)
- Written explanation of what autoresearch is
- The plan → search → synthesize → evaluate cycle explained
- Static vis.js diagram of the research graph
- When to use this approach

### Demo Page (`demo.html`)
- **Mode toggle** — Loop Engineering / Autoresearch (switches both the backend graph and the graph shown)
- **Chat input** — text field + submit button
- **Left panel** — live animated graph
  - Nodes highlight (yellow) when entered, pulse (green) when exiting
  - Edges animate on traversal
  - Loop-back edges visually distinct (dashed, animated arrow)
  - Iteration counter displayed on looping nodes
- **Right panel** — streaming output
  - Token-by-token LLM output
  - Collapsible tool call log (query sent → results received)
  - Final answer rendered in markdown

---

## Build Order

1. **Scaffold** — directory structure, `.env.example`, `requirements.txt`
2. **Config + tools** — `config.py` (OpenAI client factory), `tools/search.py` (Tavily)
3. **Loop graph** — `graphs/loop_graph.py` with SSE event emission
4. **Autoresearch graph** — `graphs/research_graph.py` with SSE event emission
5. **FastAPI app** — `main.py` with `/api/run` and `/api/stream/{run_id}` endpoints
6. **Frontend static pages** — homepage, loop engineering page, autoresearch page
7. **Demo page** — graph viz animation, SSE client wiring, chat UI

---

## Constraints

- Local use only — no deployment, no auth, no persistent storage
- Single active run at a time per browser session (run_id scoped to session)
- Max iterations capped (loop: 10, autoresearch: 3 research cycles) to prevent runaway costs
- No LangGraph, no agent frameworks — pure Python state machines for clarity and control
