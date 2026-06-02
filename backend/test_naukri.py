import asyncio
import os

from dotenv import load_dotenv

from portals.naukri.auth import NaukriAuthClient
from portals.naukri.jobs import NaukriJobClient

load_dotenv()


async def main():
    print("=== Naukri Portal Test ===")

    # 1. Login
    username = os.getenv("NAUKRI_USERNAME")
    password = os.getenv("NAUKRI_PASSWORD")
    if not username or not password:
        raise RuntimeError(
            "Missing NAUKRI_USERNAME or NAUKRI_PASSWORD. "
            "Add them to backend/.env or export them before running this test."
        )

    auth = NaukriAuthClient()
    session = auth.login(username, password)
    assert session.bearer_token, "No bearer token"
    assert session.profile_id, "No profile ID"
    print(f"[PASS] Login - token: {session.bearer_token[:20]}... profile: {session.profile_id}")

    jc = NaukriJobClient(auth)

    # 2. Recommended jobs
    reco = jc.get_recommended_jobs()
    assert len(reco) > 0, "No recommended jobs returned"
    print(f"[PASS] Recommended jobs - {len(reco)} returned")
    for j in reco[:2]:
        print(f"       {j.title} @ {j.company} | {j.location}")

    # 3. Job search
    jobs = await jc.search_jobs(keyword="React developer", location="Bangalore", experience=2)
    assert len(jobs) > 0, "No jobs from search"
    print(f"[PASS] Job search - {len(jobs)} returned")
    for j in jobs[:3]:
        print(f"       {j.title} @ {j.company} | Score-ready tags: {j.tags[:3]}")

    # 4. Apply - uncomment ONLY when ready to test a real apply
    user_id = os.getenv("TEST_USER_ID")
    target = next((j for j in jobs if not j.has_questionnaire), None)
    if user_id and target:
        from portals.base import run_safe_apply_for_user
        result = await run_safe_apply_for_user(
            user_id=user_id,
            job=target,
            apply_callable=lambda: jc.apply_job(target),
        )
        print(f"[APPLY TEST] {result}")
    elif not user_id:
        print("[SKIP] TEST_USER_ID required for SafeApplyManager logging")
    else:
        print("[SKIP] All jobs have questionnaires")

    print("\n=== All tests PASSED ===")


asyncio.run(main())
