from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup

INTERNSHALA_BASE = "https://internshala.com"
LOGIN_PAGE_URL = f"{INTERNSHALA_BASE}/login/user"
LOGIN_URL = f"{INTERNSHALA_BASE}/login/verify_ajax/user/dashboard"


@dataclass
class InternshalaSession:
    csrf_token: str
    session_id: str


class InternshalaAuthClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "application/json, text/plain, */*",
        })
        self.csrf_token: str = ""
        self.csrf_field_name: str = ""

    def _get_csrf_token(self) -> str:
        """Fetch the login page and extract the CSRF token."""
        resp = self.session.get(LOGIN_PAGE_URL)

        csrf = self.session.cookies.get("csrf_token") or self.session.cookies.get("csrftoken")
        if csrf:
            self.csrf_field_name = "csrf_token"
            return csrf

        soup = BeautifulSoup(resp.text, "html.parser")
        token_input = (
            soup.find("input", {"name": "csrf_test_name"}) or
            soup.find("input", {"name": "_token"}) or
            soup.find("input", {"name": "csrf_token"})
        )
        if token_input:
            self.csrf_field_name = token_input.get("name", "")
            return token_input.get("value", "")
        return ""

    def login(self, email: str, password: str) -> InternshalaSession:
        if not email or not password:
            raise ValueError("INTERNSHALA_EMAIL and INTERNSHALA_PASSWORD must be set before login")

        self.csrf_token = self._get_csrf_token()

        payload = {
            "source": "",
            "email": email,
            "password": password,
            "g-recaptcha-response": "",
            "action": "login_submit",
        }
        if self.csrf_token:
            payload[self.csrf_field_name or "csrf_test_name"] = self.csrf_token

        self.session.headers.update({
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": LOGIN_PAGE_URL,
        })

        response = self.session.post(
            LOGIN_URL,
            data=payload,
        )

        if response.status_code != 200:
            body_preview = response.text[:500].replace(password, "[REDACTED]")
            raise RuntimeError(
                f"Internshala login may have failed. "
                f"Status: {response.status_code}. Response: {body_preview}"
            )
        try:
            data = response.json()
        except ValueError:
            data = {}

        if data and not data.get("success", False):
            error_message = data.get("errorThrown") or data.get("error") or data.get("message") or data
            raise RuntimeError(f"Internshala login failed: {error_message}")

        session_id = (
            self.session.cookies.get("PHPSESSID") or
            self.session.cookies.get("internshala_session") or
            ""
        )

        return InternshalaSession(csrf_token=self.csrf_token, session_id=session_id)

    def is_logged_in(self) -> bool:
        resp = self.session.get(f"{INTERNSHALA_BASE}/dashboard")
        return "login" not in resp.url and resp.status_code == 200
