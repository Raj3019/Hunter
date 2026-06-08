"""
Foundit applied-jobs (My Applies) auto-detect test.

Exercises the real code path used by the applied-status sync:
  login -> FounditJobClient.get_application_history() -> normalized apply records.

Requires FOUNDIT_EMAIL / FOUNDIT_PASSWORD in backend/.env. Read-only: never
applies to or modifies anything on the account.

Run:
    cd backend
    python test_foundit_history.py
"""

import os

from dotenv import load_dotenv

from portals.foundit.auth import FounditAuthClient
from portals.foundit.jobs import FounditJobClient

load_dotenv()


def main():
    print("=== Foundit Applied-Jobs History Test ===")
    email = os.getenv("FOUNDIT_EMAIL")
    password = os.getenv("FOUNDIT_PASSWORD")
    if not email or not password:
        raise RuntimeError("Set FOUNDIT_EMAIL and FOUNDIT_PASSWORD in backend/.env first.")

    auth = FounditAuthClient()
    auth.login(email, password)
    print("[PASS] Login")

    client = FounditJobClient(auth)
    history = client.get_application_history()
    assert isinstance(history, list), "history should be a list"
    print(f"[PASS] Fetched {len(history)} applied jobs")

    for record in history[:5]:
        assert record["job_id"], "each record needs a job_id"
        assert record["status_value"], "each record needs a status_value"
        print(f"   - {record['job_id']} | {record['status_value']} | "
              f"{record['title'][:40]} | {record['company'][:30]}")

    print("\n[OK] Applied-jobs history path works end to end.")


if __name__ == "__main__":
    main()
