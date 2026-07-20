# while-true : Loop Engineering vs Autoresearch Interactive Demo

A local demo application that explains and contrasts two AI agent paradigms — **Loop Engineering** and **Autoresearch** — through concept pages and a live chat interface with real-time graph animation showing how each agent traverses its state graph.

---

## What Is This?

Modern AI agents are not single-shot prompt-response systems. They operate in **loops** — iterating, calling tools, evaluating results, and deciding what to do next. This demo makes two distinct looping patterns tangible and interactive.

### Loop Engineering (ReAct Pattern)

The agent **reasons**, **acts**, **observes** the result, and repeats — until it decides the task is complete. This is the foundational pattern behind most tool-using AI agents.

```
REASON → TOOL CALL → OBSERVE → REASON (loop)
                             ↘ DONE
```

The agent is given a question and a set of tools. Each iteration it decides: do I have enough to answer, or do I need to use another tool? It loops until confident.

### Autoresearch

A more structured loop designed for deep research tasks. The agent **plans** a set of search queries, **searches** for information, **synthesizes** the results into a draft, and **evaluates** whether the draft is complete. If it finds gaps, it loops back to search.

```
PLAN → SEARCH → SYNTHESIZE → EVALUATE → SEARCH (loop if gaps)
                                      ↘ DONE
```

This pattern mirrors how a research analyst would work: break the question down, gather sources, write a draft, identify what's still missing, and keep researching until the answer is complete.

---

## Features

- **Concept pages** explaining each paradigm with static graph diagrams
- **Live demo** — type a question, choose a mode, and watch the agent traverse its graph in real time
- **Graph animation** — nodes highlight as they are entered, loop-back edges are visually distinct, iteration count is displayed
- **Streaming output** — LLM tokens stream as they are generated, with a collapsible tool call log showing every search query and result

---

## Tech Stack

| Layer               | Technology                                                  |
| ------------------- | ----------------------------------------------------------- |
| Backend             | Python, FastAPI, Server-Sent Events (SSE)                   |
| LLM                 | OpenAI SDK (supports OpenAI API and Ollama interchangeably) |
| Web Search          | Tavily API                                                  |
| Agent Graphs        | Pure Python state machines (no agent frameworks)            |
| Frontend            | Vanilla HTML, CSS, JavaScript                               |
| Graph Visualization | vis.js Network                                              |

The two agent graphs are implemented as explicit Python state machines — no LangGraph or other orchestration framework. This keeps the logic readable and the demo focused.

---

## Project Structure

```
loop_autoresearch_demo/
├── backend/
│   ├── main.py                  # FastAPI app and SSE streaming endpoint
│   ├── graphs/
│   │   ├── loop_graph.py        # ReAct agentic loop
│   │   └── research_graph.py    # Autoresearch pipeline
│   ├── tools/
│   │   └── search.py            # Tavily web search wrapper
│   ├── config.py                # Environment config and LLM client factory
│   └── requirements.txt
├── frontend/
│   ├── index.html               # Homepage
│   ├── loop-engineering.html    # Loop Engineering concept page
│   ├── autoresearch.html        # Autoresearch concept page
│   ├── demo.html                # Live demo: chat interface + graph animation
│   ├── css/style.css
│   └── js/
│       ├── graph-viz.js         # Graph rendering and node animation
│       └── demo.js              # SSE client and chat UI
└── docs/
    └── plan.md                  # Full implementation plan
```

---

## Setup

### Prerequisites

- Python 3.11+
- An OpenAI API key **or** [Ollama](https://ollama.com) running locally
- A [Tavily API key](https://tavily.com) (free tier: 1,000 searches/month)

### Installation

```bash
git clone https://github.com/sarmadi/loop_autoresearch_demo.git
cd loop_autoresearch_demo

cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS/Linux

pip install -r requirements.txt
```

### Configuration

Copy `.env.example` to `.env` and fill in your keys:

```env
# LLM — choose one:
OPENAI_API_KEY=sk-...
# OLLAMA_BASE_URL=http://localhost:11434/v1

MODEL_NAME=gpt-4o-mini

# Search
TAVILY_API_KEY=tvly-...
```

To use Ollama instead of OpenAI, comment out `OPENAI_API_KEY`, set `OLLAMA_BASE_URL`, and set `MODEL_NAME` to your local model (e.g. `llama3`).

### Running

```bash
# From the backend directory, with .venv active:
uvicorn main:app --reload
```

Then open `frontend/index.html` directly in your browser. No separate frontend server needed.

---

## How the Demo Works

1. Go to the **Demo** page
2. Select a mode: **Loop Engineering** or **Autoresearch**
3. Type a question and submit
4. Watch the graph animate as the agent moves through its nodes
5. Read the streaming output in the right panel — including tool calls and search results

---

## Limitations

This is an internal demo, not a production application:

- Local use only — no deployment configuration, no authentication
- One active run per browser session
- Iteration caps applied (loop: 10 iterations, autoresearch: 3 research cycles) to limit API costs

---

## License

MIT