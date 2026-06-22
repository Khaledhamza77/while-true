import sys, os, warnings
warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.graphs.react_loop import react_graph
from backend.graphs.autoresearch_loop import research_graph
from langchain_core.runnables.graph import MermaidDrawMethod

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "graphs")
os.makedirs(OUT, exist_ok=True)

graphs = [
    ("react_loop", react_graph),
    ("autoresearch_loop", research_graph),
]

for name, graph in graphs:
    # Mermaid source
    mmd = graph.get_graph().draw_mermaid()
    mmd_path = os.path.join(OUT, f"{name}.mmd")
    with open(mmd_path, "w") as f:
        f.write(mmd)
    print(f"[mmd] docs/graphs/{name}.mmd")

    # PNG via Mermaid.ink API (no local dependencies needed)
    try:
        png = graph.get_graph().draw_mermaid_png(draw_method=MermaidDrawMethod.API)
        png_path = os.path.join(OUT, f"{name}.png")
        with open(png_path, "wb") as f:
            f.write(png)
        print(f"[png] docs/graphs/{name}.png")
    except Exception as e:
        print(f"[!]  PNG failed for {name}: {e}")
