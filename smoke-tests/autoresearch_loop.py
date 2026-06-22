import asyncio, sys, os, warnings
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.graphs.autoresearch_loop import run_graph

async def main():
    topic = "What is the meaning of Dasein in Heidegger's philosophy and how does it relate to history and facticity? Find the origins of these concepts in Hegelian thought."
    async for event in run_graph(topic):
        t = event["type"]
        if t == "node_enter":
            print(f"[>>] {event['node']}")
        elif t == "node_exit":
            print(f"[<<] {event['node']}")
        elif t == "loop_back":
            print(f"[~~] loop back iteration={event['iteration']}")
        elif t == "token":
            print(event["content"].encode("ascii", "replace").decode(), end="", flush=True)
        elif t == "done":
            print(f"\n[DONE] draft length={len(event['result'])} chars")
        elif t == "error":
            print(f"[ERR] {event['message']}")

asyncio.run(main())
