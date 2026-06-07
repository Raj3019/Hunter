import requests
from dataclasses import dataclass
from typing import Optional
from requests import HTTPError

from core.retry import with_retry

NAUKRI_BASE = "https://www.naukri.com"
LOGIN_URL = f"{NAUKRI_BASE}/central-login-services/v1/login"
DASHBOARD_URL = (
    f"{NAUKRI_BASE}/cloudgateway-mynaukri/resman-aggregator-services/v0/"
    "users/self/dashboard"
)
RESUME_UPDATE_URL_TEMPLATE = (
    f"{NAUKRI_BASE}/cloudgateway-mynaukri/resman-aggregator-services/v0/"
    "users/self/profiles/{profile_id}/advResume"
)

BASE_HEADERS = {
    "accept": "application/json",
    "appid": "105",
    "clientid": "d3skt0p",
    "content-type": "application/json",
    "referer": "https://www.naukri.com/nlogin/login",
    "systemid": "jobseeker",
    "x-requested-with": "XMLHttpRequest",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
}


@dataclass
class NaukriSession:
    bearer_token: str
    profile_id: str
    username: str


class NaukriAuthClient:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update(BASE_HEADERS)
        self.bearer_token: Optional[str] = None
        self.profile_id: Optional[str] = None

    def _build_headers(self, auth: bool = False, extra: Optional[dict] = None) -> dict:
        headers = BASE_HEADERS.copy()
        if auth:
            if not self.bearer_token:
                raise ValueError("Login required before building authenticated headers")
            headers["authorization"] = f"Bearer {self.bearer_token}"
            headers["systemid"] = "Naukri"
        if extra:
            headers.update(extra)
        return headers

    @with_retry(label="naukri-login")
    def _post_login(self, username: str, password: str):
        return self.session.post(
            LOGIN_URL,
            headers=self._build_headers(),
            json={"username": username, "password": password},
        )

    def login(self, username: str, password: str) -> NaukriSession:
        if not username or not password:
            raise ValueError("NAUKRI_USERNAME and NAUKRI_PASSWORD must be set before login")

        response = self._post_login(username, password)
        try:
            response.raise_for_status()
        except HTTPError as exc:
            body_preview = response.text[:500].replace(password, "[REDACTED]")
            raise RuntimeError(
                f"Naukri login failed with HTTP {response.status_code}. "
                f"URL: {LOGIN_URL}. Response: {body_preview}"
            ) from exc

        data = response.json() if response.text else {}
        self.bearer_token = (
            self.session.cookies.get("nauk_at") or
            data.get("authToken") or
            data.get("token") or
            data.get("bearerToken")
        )

        if not self.bearer_token:
            raise ValueError(
                "Login succeeded but no auth token was found in cookies or response. "
                f"Response keys: {list(data.keys())}"
            )

        self.session.headers.update({"Authorization": f"Bearer {self.bearer_token}"})
        self.profile_id = (
            data.get("profileId") or
            data.get("userId") or
            data.get("id") or
            self.fetch_profile_id()
        )
        return NaukriSession(self.bearer_token, self.profile_id, username)

    def fetch_profile_id(self) -> str:
        if self.profile_id:
            return self.profile_id

        response = self.session.get(DASHBOARD_URL, headers=self._build_headers(auth=True))
        response.raise_for_status()
        data = response.json()
        profile_id = data.get("profileId") or data.get("dashBoard", {}).get("profileId")
        if not profile_id:
            raise ValueError("Profile ID missing from Naukri dashboard response")
        self.profile_id = profile_id
        return self.profile_id

    def upload_resume(self, pdf_path: str) -> dict:
        if not self.profile_id:
            self.fetch_profile_id()
        url = RESUME_UPDATE_URL_TEMPLATE.format(profile_id=self.profile_id)
        with open(pdf_path, "rb") as f:
            response = self.session.post(
                url, files={"resume": (pdf_path.split("/")[-1], f, "application/pdf")}
            )
        return response.json()
