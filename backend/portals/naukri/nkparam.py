import asyncio
import base64
import time

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import padding
from playwright.async_api import async_playwright

PUBLIC_KEY = b"""-----BEGIN PUBLIC KEY-----
MFwwDQYJKoZIhvcNAQEBBQADSwAwSAJBALrlQ+djR0RjJwBF1xuisHmdFv334MIm
K6LgzJhmLhN7B5yuEyaKoasgXQk3+OQglsOaBxEJ0j5PcTL3nbOvt80CAwEAAQ==
-----END PUBLIC KEY-----"""

_public_key = serialization.load_pem_public_key(PUBLIC_KEY)


def generate_nkparam(page_type: str = "srp") -> str:
    timestamp = int(time.time() * 1000)
    message = f"v0|{timestamp}|121_{page_type}".encode("utf-8")
    encrypted = _public_key.encrypt(message, padding.PKCS1v15())
    return base64.b64encode(encrypted).decode("utf-8")


async def capture_nkparam(keyword: str = "developer") -> str:
    captured = {}

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir="./chrome_profiles/naukri",
            headless=False,
        )
        page = await browser.new_page()

        async def on_request(request):
            if "jobapi/v3/search" in request.url:
                nk = request.headers.get("nkparam")
                if nk:
                    captured["nkparam"] = nk

        page.on("request", on_request)

        # Navigate to search page - this triggers the API call with nkparam.
        await page.goto(f"https://www.naukri.com/{keyword.replace(' ', '-')}-jobs")
        await asyncio.sleep(5)
        await browser.close()

    if not captured.get("nkparam"):
        raise RuntimeError("Could not capture nkparam - is the browser logged in?")
    return captured["nkparam"]
