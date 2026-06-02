import requests
from dataclasses import dataclass
from typing import Optional
from requests import HTTPError

FOUNDIT_BASE = "https://www.foundit.in"
LOGIN_PAGE_URL = f"{FOUNDIT_BASE}/rio/login/seeker"
LOGIN_URL = f"{FOUNDIT_BASE}/seeker-profile/api/login"
PROFILE_URL = f"{FOUNDIT_BASE}/seeker-profile/api/rioMe"
CLIENT_ID = "fd111af2-493d-11e8-9621-24a074f06450"

BASE_HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Origin": "https://www.foundit.in",
    "Referer": LOGIN_PAGE_URL,
}


@dataclass
class FounditSession:
    bearer_token: str
    user_id: str
    email: str


class FounditAuthClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(BASE_HEADERS)
        self.bearer_token: Optional[str] = None
        self.user_id: Optional[str] = None

    def login(self, email: str, password: str) -> FounditSession:
        if not email or not password:
            raise ValueError("FOUNDIT_EMAIL and FOUNDIT_PASSWORD must be set before login")

        # Load the login page first so Foundit's Next.js middleware can set cookies.
        self.session.get(LOGIN_PAGE_URL)

        response = self.session.post(
            LOGIN_URL,
            json={
                "username": email,
                "password": password,
                "client_id": CLIENT_ID,
            },
        )
        try:
            response.raise_for_status()
        except HTTPError as exc:
            body_preview = response.text[:500].replace(password, "[REDACTED]")
            raise RuntimeError(
                f"Foundit login failed with HTTP {response.status_code}. "
                f"URL: {LOGIN_URL}. Response: {body_preview}"
            ) from exc

        data = response.json() if response.text else {}

        self.bearer_token = (
            data.get("authToken") or
            data.get("token") or
            data.get("bearerToken") or
            data.get("accessToken") or
            self.session.cookies.get("MSSOAT")
        )
        data_payload = data.get("data") if isinstance(data.get("data"), dict) else {}
        self.user_id = (
            data.get("userId") or
            data.get("id") or
            data.get("candidateId") or
            data_payload.get("userId") or
            data_payload.get("id") or
            data_payload.get("candidateId")
        )

        if not self.bearer_token:
            raise ValueError(
                "Foundit login succeeded but no token cookie or token field was found. "
                f"Response keys: {list(data.keys())}; cookies: {list(self.session.cookies.keys())}"
            )

        self.session.headers.update({"Authorization": f"Bearer {self.bearer_token}"})
        return FounditSession(self.bearer_token, self.user_id, email)

    def is_token_valid(self) -> bool:
        try:
            response = self.session.get(PROFILE_URL)
            return response.status_code == 200
        except Exception:
            return False
