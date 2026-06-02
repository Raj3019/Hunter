import asyncio
import os

from dotenv import load_dotenv

from portals.foundit.auth import FounditAuthClient
from portals.foundit.jobs import FounditJobClient

load_dotenv()


async def main():
    print("=== Foundit Portal Test ===")

    # 1. Login
    email = os.getenv("FOUNDIT_EMAIL")
    password = os.getenv("FOUNDIT_PASSWORD")
    if not email or not password:
        raise RuntimeError(
            "Missing FOUNDIT_EMAIL or FOUNDIT_PASSWORD. "
            "Add them to backend/.env or export them before running this test."
        )

    auth = FounditAuthClient()
    session = auth.login(email, password)
    assert session.bearer_token, "No bearer token"
    print(f"[PASS] Login - token: {session.bearer_token[:20]}... user: {session.user_id}")

    # 2. Token validity check
    valid = auth.is_token_valid()
    assert valid, "Token invalid immediately after login"
    print("[PASS] Token validity check")

    jc = FounditJobClient(auth)

    # 3. Job search
    jobs = jc.search_jobs(keyword="Python developer", location="Hyderabad", experience=1)
    assert len(jobs) > 0, "No jobs returned. Check response structure."
    print(f"[PASS] Search - {len(jobs)} jobs returned")
    for j in jobs[:3]:
        print(f"       [{j.job_id}] {j.title} @ {j.company} | {j.location}")
        assert j.job_id, "Missing job_id"
        assert j.title, "Missing title"

    # 4. Apply test - uncomment only when ready
    # user_id = os.getenv("TEST_USER_ID")
    # if user_id:
    #     from portals.base import run_safe_apply_for_user
    #     result = await run_safe_apply_for_user(
    #         user_id=user_id,
    #         job=jobs[0],
    #         apply_callable=lambda: jc.apply_job(jobs[0]),
    #     )
    #     print(f"[APPLY TEST] {result}")
    # else:
    #     print("[SKIP] TEST_USER_ID required for SafeApplyManager logging")

    print("\n=== All tests PASSED ===")


asyncio.run(main())
