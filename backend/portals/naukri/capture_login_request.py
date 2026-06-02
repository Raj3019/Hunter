import asyncio
import json
from typing import Optional
from urllib.parse import parse_qsl, urlencode

from playwright.async_api import async_playwright

PROFILE_DIR = "./chrome_profiles/naukri"
LOGIN_URL = "https://www.naukri.com/nlogin/login"

SENSITIVE_HEADERS = {"authorization", "cookie", "set-cookie"}
SENSITIVE_FIELDS = {"password", "pwd", "pass"}


def _redact_headers(headers: dict) -> dict:
    redacted = {}
    for key, value in headers.items():
        if key.lower() in SENSITIVE_HEADERS:
            redacted[key] = "[REDACTED]"
        else:
            redacted[key] = value
    return redacted


def _redact_post_data(post_data: Optional[str]) -> str:
    if not post_data:
        return ""

    try:
        parsed = json.loads(post_data)
        if isinstance(parsed, dict):
            for key in list(parsed.keys()):
                if key.lower() in SENSITIVE_FIELDS:
                    parsed[key] = "[REDACTED]"
            return json.dumps(parsed, indent=2)
    except json.JSONDecodeError:
        pass

    pairs = parse_qsl(post_data, keep_blank_values=True)
    if pairs:
        safe_pairs = [
            (key, "[REDACTED]" if key.lower() in SENSITIVE_FIELDS else value)
            for key, value in pairs
        ]
        return urlencode(safe_pairs)

    return post_data[:1000]


async def main():
    print("=== Naukri Login Request Capture ===")
    print("A browser will open. Log in to Naukri manually.")
    print("The script will print matching login API requests with sensitive values redacted.")
    print("Press Enter here after login is complete.\n")

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            viewport={"width": 1280, "height": 800},
        )
        page = await browser.new_page()

        async def on_request(request):
            url = request.url.lower()
            if "login" not in url and "auth" not in url:
                return
            if request.method not in {"POST", "PUT"}:
                return

            print("\n--- REQUEST ---")
            print(f"{request.method} {request.url}")
            print("Headers:")
            print(json.dumps(_redact_headers(request.headers), indent=2))
            print("Post data:")
            print(_redact_post_data(request.post_data))

        async def on_response(response):
            url = response.url.lower()
            if "login" not in url and "auth" not in url:
                return
            if response.request.method not in {"POST", "PUT"}:
                return

            print("\n--- RESPONSE ---")
            print(f"{response.status} {response.url}")
            try:
                body = await response.text()
                print(body[:1000])
            except Exception as exc:
                print(f"Could not read response body: {exc}")

        page.on("request", on_request)
        page.on("response", on_response)

        await page.goto(LOGIN_URL, wait_until="domcontentloaded")
        await asyncio.to_thread(input)
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
