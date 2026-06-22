from tavily import TavilyClient
from backend.config import get_tavily_key


def search(query: str, max_results: int = 5) -> list[dict]:
    """Run a web search and return a list of {title, url, content} results."""
    client = TavilyClient(api_key=get_tavily_key())
    response = client.search(query=query, max_results=max_results)
    return [
        {"title": r["title"], "url": r["url"], "content": r["content"]}
        for r in response["results"]
    ]
