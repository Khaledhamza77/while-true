import operator
from typing import Annotated, AsyncGenerator
from typing_extensions import TypedDict
from pydantic import BaseModel

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END

from backend.config import get_chat_model
from backend.tools.search import search as tavily_search

MAX_CYCLES = 3

_GRAPH_NODES = {"plan", "search", "synthesize", "evaluate"}


# --- State ---

class ResearchState(TypedDict):
    topic: str
    queries: list[str]
    search_results: Annotated[list[dict], operator.add]  # accumulates across cycles
    draft: str
    gaps: list[str]
    cycle: int
    max_cycles: int


# --- Structured output schemas ---

class PlanResult(BaseModel):
    queries: list[str]


class EvaluationResult(BaseModel):
    complete: bool
    gap_queries: list[str]


# --- Prompts ---

PLAN_PROMPT = (
    "You are a research planner. Given a research topic, generate 2 to 3 focused "
    "search queries that cover the most important angles of the topic. "
    "Return only the list of queries in the queries field — no explanations."
)

SYNTHESIZE_PROMPT = (
    "You are a research analyst. Given a research topic and a collection of web search results, "
    "synthesize them into a structured, comprehensive report with clear headers. "
    "Cover key findings, comparisons, tradeoffs, and practical insights. "
    "Write in clear prose. Do not suggest follow-up questions or offer to research further."
)

EVALUATE_PROMPT = (
    "You are a research quality evaluator. Given a research topic and a draft report, "
    "assess whether the draft covers the topic's most important angles and tradeoffs. "
    "If meaningful gaps remain — missing perspectives, unaddressed tradeoffs, or key practical "
    "details — set complete=false and return up to 3 targeted search queries to fill them. "
    "Set complete=true only when the draft gives a well-rounded answer, not just a partial one."
)


# --- Nodes ---

def plan(state: ResearchState) -> dict:
    model = get_chat_model().with_structured_output(PlanResult)
    result: PlanResult = model.invoke([
        SystemMessage(content=PLAN_PROMPT),
        HumanMessage(content=f"Research topic: {state['topic']}"),
    ])
    return {"queries": result.queries}


def search(state: ResearchState) -> dict:
    results = []
    for query in state["queries"]:
        results.extend(tavily_search(query, max_results=2))
    return {"search_results": results}


def synthesize(state: ResearchState) -> dict:
    model = get_chat_model()
    results_text = "\n\n".join(
        f"[{r['title']}]({r['url']})\n{r['content']}"
        for r in state["search_results"]
    )
    response = model.invoke([
        SystemMessage(content=SYNTHESIZE_PROMPT),
        HumanMessage(content=f"Topic: {state['topic']}\n\nSearch results:\n{results_text}"),
    ])
    return {"draft": response.content}


def evaluate(state: ResearchState) -> dict:
    model = get_chat_model().with_structured_output(EvaluationResult)
    result: EvaluationResult = model.invoke([
        SystemMessage(content=EVALUATE_PROMPT),
        HumanMessage(content=f"Topic: {state['topic']}\n\nDraft:\n{state['draft']}"),
    ])
    return {
        "gaps": result.gap_queries if not result.complete else [],
        "cycle": state["cycle"] + 1,
    }


# --- Routing ---

def should_continue(state: ResearchState) -> str:
    if state["gaps"] and state["cycle"] < state["max_cycles"]:
        return "search"
    return END


# --- Graph ---

_builder = StateGraph(ResearchState)
_builder.add_node("plan", plan)
_builder.add_node("search", search)
_builder.add_node("synthesize", synthesize)
_builder.add_node("evaluate", evaluate)
_builder.set_entry_point("plan")
_builder.add_edge("plan", "search")
_builder.add_edge("search", "synthesize")
_builder.add_edge("synthesize", "evaluate")
_builder.add_conditional_edges(
    "evaluate", should_continue, {"search": "search", END: END}
)

research_graph = _builder.compile()


# --- SSE event stream ---

async def run_graph(topic: str) -> AsyncGenerator[dict, None]:
    initial_state = {
        "topic": topic,
        "queries": [],
        "search_results": [],
        "draft": "",
        "gaps": [],
        "cycle": 0,
        "max_cycles": MAX_CYCLES,
    }

    search_count = 0       # tracks how many times search node has started
    in_synthesize = False  # gate: only buffer tokens from the synthesize node
    draft_buffer: list[str] = []

    try:
        async for event in research_graph.astream_events(initial_state, version="v2"):
            kind = event["event"]
            name = event.get("name", "")

            if kind == "on_chain_start" and name in _GRAPH_NODES:
                if name == "search":
                    if search_count > 0:
                        yield {
                            "type": "loop_back",
                            "from": "evaluate",
                            "to": "search",
                            "iteration": search_count,
                        }
                    search_count += 1
                if name == "synthesize":
                    in_synthesize = True
                    draft_buffer.clear()  # reset for each new synthesis pass
                yield {"type": "node_enter", "node": name}

            elif kind == "on_chain_end" and name in _GRAPH_NODES:
                if name == "synthesize":
                    in_synthesize = False
                yield {"type": "node_exit", "node": name}

            elif kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if chunk.content:
                    if in_synthesize:
                        draft_buffer.append(chunk.content)
                    yield {"type": "token", "content": chunk.content}

        yield {"type": "done", "result": "".join(draft_buffer)}

    except Exception as e:
        yield {"type": "error", "message": str(e)}
