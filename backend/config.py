import os
from openai import OpenAI
from langchain_openai import ChatOpenAI
from dotenv import load_dotenv

load_dotenv()


def get_client() -> tuple[OpenAI, str]:
    """Return (OpenAI client, model name) for whichever provider is configured.

    Prefers OpenAI if OPENAI_API_KEY is set; falls back to Ollama.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    ollama_url = os.getenv("OLLAMA_BASE_URL")

    if openai_key:
        client = OpenAI(api_key=openai_key)
        model = os.environ["OPENAI_MODEL"]
        return client, model

    if ollama_url:
        client = OpenAI(base_url=f"{ollama_url.rstrip('/')}/v1", api_key="ollama")
        model = os.environ["OLLAMA_MODEL"]
        return client, model

    raise RuntimeError(
        "No LLM provider configured. Set OPENAI_API_KEY or OLLAMA_BASE_URL in .env"
    )


def get_chat_model() -> ChatOpenAI:
    """Return a streaming-enabled ChatOpenAI for whichever provider is configured."""
    openai_key = os.getenv("OPENAI_API_KEY")
    ollama_url = os.getenv("OLLAMA_BASE_URL")

    if openai_key:
        return ChatOpenAI(
            model=os.environ["OPENAI_MODEL"],
            api_key=openai_key,
            streaming=True,
        )

    if ollama_url:
        return ChatOpenAI(
            model=os.environ["OLLAMA_MODEL"],
            base_url=f"{ollama_url.rstrip('/')}/v1",
            api_key="ollama",
            streaming=True,
        )

    raise RuntimeError(
        "No LLM provider configured. Set OPENAI_API_KEY or OLLAMA_BASE_URL in .env"
    )


def get_tavily_key() -> str:
    key = os.getenv("TAVILY_API_KEY")
    if not key:
        raise RuntimeError("TAVILY_API_KEY is not set in .env")
    return key
