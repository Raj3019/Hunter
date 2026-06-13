"""Clean end-to-end check for Wipro (SuccessFactors) applied-status auto-detect.

Read-only: logs in with WIPRO_TEST_EMAIL / WIPRO_TEST_PASSWORD (from the repo-root
.env) and prints the submitted applications the handler parses. It never applies.

    python test_wipro_applied.py
"""

import os
from pathlib import Path

from portals.successfactors.client import login_and_fetch

ROOT_ENV = Path(__file__).resolve().parents[1] / ".env"


def _load_env() -> None:
    if not ROOT_ENV.exists():
        return
    for line in ROOT_ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    _load_env()
    email = os.environ.get("WIPRO_TEST_EMAIL")
    password = os.environ.get("WIPRO_TEST_PASSWORD")
    if not (email and password):
        print("Set WIPRO_TEST_EMAIL and WIPRO_TEST_PASSWORD in .env to run this check.")
        return

    result = login_and_fetch("wipro", email, password)
    print("login ok:", result.get("ok"), "| error:", result.get("error"))
    apps = result.get("applications") or []
    print(f"applications found: {len(apps)}")
    for app in apps:
        print(f"  - {app['job_title']!r}  status={app['status']!r}  "
              f"appId={app['application_id']}  reqId={app['job_req_id'] or '-'}")


if __name__ == "__main__":
    main()
