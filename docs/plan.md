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
| Graphs | LangGraph | First-class graph orchestration, built-in state management, cycle support, and streaming |
| Frontend | Vanilla HTML/CSS/JS | No build step, no framework, easy to audit and modify |
| Graph viz | `vis.js` Network | Handles directed graphs natively, easy to animate node/edge states |

---

## Project Structure

```
loop_autoresearch_demo/
├── backend/
│   ├── main.py                  # FastAPI app + SSE endpoint
│   ├── graphs/
│   │   ├── loop_graph.py        # ReAct agentic loop (LangGraph StateGraph)
│   │   └── research_graph.py    # Autoresearch pipeline (LangGraph StateGraph)
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

Models the core loop engineering pattern: the agent reasons, acts, observes the result, and loops until the task is complete. Implemented as a LangGraph `StateGraph` with typed `TypedDict` state.

```
START → REASON → TOOL_CALL → OBSERVE → REASON (loop)
                            ↘
                            DONE (agent decides task is complete)
```

**Nodes (LangGraph node functions):**
- `START` — built-in LangGraph entry point; initializes `AgentState` with user query
- `REASON` — LLM call via `ChatOpenAI` bound with tools; decides next action or finish
- `TOOL_CALL` — executes the chosen tool (web search) via `ToolNode`
- `OBSERVE` — appends tool result to `messages`, increments iteration counter
- `DONE` — emits final answer, terminates

**Edges:**
- Conditional edge from `REASON`: routes to `TOOL_CALL` or `DONE` based on whether the LLM returned a tool call
- Back-edge from `OBSERVE` → `REASON` forms the loop

**Loop condition:** Conditional edge checks for `AIMessage` with no tool calls, or max iterations reached.

---

### Graph 2 — Autoresearch Loop

Models a structured research pipeline where the agent plans queries, searches, synthesizes findings, evaluates quality, and loops back to search if gaps remain. Implemented as a LangGraph `StateGraph` with typed `TypedDict` state.

```
START → PLAN → SEARCH → SYNTHESIZE → EVALUATE → SEARCH (loop if gaps found)
                                              ↘
                                              DONE (quality threshold met)
```

**Nodes (LangGraph node functions):**
- `START` — built-in LangGraph entry point; initializes `ResearchState` with topic
- `PLAN` — LLM call: break topic into specific search queries (3–5 queries); writes to `state["queries"]`
- `SEARCH` — executes queries via Tavily in parallel; appends to `state["search_results"]`
- `SYNTHESIZE` — LLM call: combines all search results into a structured draft; writes to `state["draft"]`
- `EVALUATE` — LLM call with structured output: assesses draft completeness; returns gaps or done signal
- `DONE` — emits final research report, terminates

**Edges:**
- Linear edges: `PLAN → SEARCH → SYNTHESIZE → EVALUATE`
- Conditional edge from `EVALUATE`: routes back to `SEARCH` (with new queries) or to `DONE`

**Loop condition:** Conditional edge checks evaluator output — gap queries present → `SEARCH`; satisfied or max cycles reached → `DONE`.

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
3. **Loop graph** — `graphs/loop_graph.py` as a LangGraph `StateGraph`; stream events via `.astream_events()` and translate to SSE payloads
4. **Autoresearch graph** — `graphs/research_graph.py` as a LangGraph `StateGraph`; same streaming approach
5. **FastAPI app** — `main.py` with `/api/run` and `/api/stream/{run_id}` endpoints
6. **Frontend static pages** — homepage, loop engineering page, autoresearch page
7. **Demo page** — graph viz animation, SSE client wiring, chat UI

---

## Constraints

- Local use only — no deployment, no auth, no persistent storage
- Single active run at a time per browser session (run_id scoped to session)
- Max iterations capped (loop: 10, autoresearch: 3 research cycles) to prevent runaway costs
- LangGraph used for graph orchestration; no higher-level agent frameworks (no LangChain agents, no AutoGen, etc.)
