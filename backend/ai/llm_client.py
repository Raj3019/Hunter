import httpx
import anthropic

from core.config import (
    AI_MODEL,
    AI_PROVIDER,
    ANTHROPIC_API_KEY,
    OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL,
)

_anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None


async def complete_text(prompt: str, max_tokens: int) -> str:
    if AI_PROVIDER == "openrouter":
        return await _complete_openrouter(prompt, max_tokens)
    return _complete_anthropic(prompt, max_tokens)


def _complete_anthropic(prompt: str, max_tokens: int) -> str:
    if not _anthropic_client:
        raise RuntimeError("Missing ANTHROPIC_API_KEY for AI_PROVIDER=anthropic")

    message = _anthropic_client.messages.create(
        model=AI_MODEL,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text.strip()


async def _complete_openrouter(prompt: str, max_tokens: int) -> str:
    if not OPENROUTER_API_KEY:
        raise RuntimeError("Missing OPENROUTER_API_KEY for AI_PROVIDER=openrouter")

    url = f"{OPENROUTER_BASE_URL.rstrip('/')}/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": AI_MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "user", "content": prompt}],
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()

    return data["choices"][0]["message"]["content"].strip()
