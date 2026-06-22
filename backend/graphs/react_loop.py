from typing import Annotated, AsyncGenerator
from typing_extensions import TypedDict

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode

from backend.config import get_chat_model
from backend.tools.search import search as tavily_search

SYSTEM_PROMPT = (
    "You are a research assistant with access to web search. "
    "Use the search tool to find current, accurate information. "
    "Search one focused query at a time — break multi-part questions into sequential searches. "
    "When you have gathered enough information to fully answer the question, "
    "write your final answer without calling any tools. "
    "Answer the question directly and completely. "
    "Do not suggest follow-up questions, do not ask if the user wants more information, "
    "and do not offer to look up anything else."
)

MAX_ITERATIONS = 10

_GRAPH_NODES = {"reason", "tool_call", "observe"}


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]
    iteration: int
    max_iterations: int


@tool
def search(query: str) -> str:
    """Search the web for current information on a topic."""
    results = tavily_search(query)
    return "\n\n".join(
        f"Title: {r['title']}\nURL: {r['url']}\nContent: {r['content']}"
        for r in results
    )


def reason(state: AgentState) -> dict:
    model = get_chat_model().bind_tools([search])
    response = model.invoke(state["messages"])
    return {"messages": [response]}


def observe(state: AgentState) -> dict:
    return {"iteration": state["iteration"] + 1}


def should_continue(state: AgentState) -> str:
    last = state["messages"][-1]
    if last.tool_calls and state["iteration"] < state["max_iterations"]:
        return "tool_call"
    return END


_tool_node = ToolNode([search])

_builder = StateGraph(AgentState)
_builder.add_node("reason", reason)
_builder.add_node("tool_call", _tool_node)
_builder.add_node("observe", observe)
_builder.set_entry_point("reason")
_builder.add_conditional_edges(
    "reason", should_continue, {"tool_call": "tool_call", END: END}
)
_builder.add_edge("tool_call", "observe")
_builder.add_edge("observe", "reason")

react_graph = _builder.compile()


async def run_graph(query: str) -> AsyncGenerator[dict, None]:
    initial_state = {
        "messages": [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=query),
        ],
        "iteration": 0,
        "max_iterations": MAX_ITERATIONS,
    }

    iteration = 0
    content_buffer: list[str] = []

    try:
        async for event in react_graph.astream_events(initial_state, version="v2"):
            kind = event["event"]
            name = event.get("name", "")

            if kind == "on_chain_start" and name in _GRAPH_NODES:
                if name == "reason" and iteration > 0:
                    yield {
                        "type": "loop_back",
                        "from": "observe",
                        "to": "reason",
                        "iteration": iteration,
                    }
                yield {"type": "node_enter", "node": name}

            elif kind == "on_chain_end" and name in _GRAPH_NODES:
                yield {"type": "node_exit", "node": name}
                if name == "observe":
                    iteration += 1

            elif kind == "on_chat_model_stream":
                chunk = event["data"]["chunk"]
                if chunk.content:
                    content_buffer.append(chunk.content)
                    yield {"type": "token", "content": chunk.content}

            elif kind == "on_tool_start" and name == "search":
                content_buffer.clear()
                args = event["data"].get("input", {})
                yield {"type": "tool_call", "tool": "search", "args": args}

            elif kind == "on_tool_end" and name == "search":
                output = event["data"].get("output", "")
                yield {"type": "tool_result", "tool": "search", "content": str(output)}

        yield {"type": "done", "result": "".join(content_buffer)}

    except Exception as e:
        yield {"type": "error", "message": str(e)}
