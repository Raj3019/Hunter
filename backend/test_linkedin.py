import asyncio
import os

from dotenv import load_dotenv

from portals.linkedin.auth import is_session_active
from portals.linkedin.jobs import search_linkedin_jobs

load_dotenv()


async def main():
    print("=== LinkedIn Portal Test ===")

    active = await is_session_active()
    assert active, "Session not active - run python -m portals.linkedin.setup_session first"
    print("[PASS] Session active")

    jobs = await search_linkedin_jobs(
        keyword="React developer",
        location="Bangalore",
        experience_level="entry",
        max_jobs=20,
    )
    assert len(jobs) > 0, "No jobs returned from LinkedIn"
    print(f"[PASS] Search - {len(jobs)} jobs intercepted")

    for job in jobs[:3]:
        assert job.job_id, "Missing job_id"
        assert job.apply_link.startswith("https://www.linkedin.com/jobs/view/"), "Bad apply link"
        print(f"       [{job.job_id}] {job.title} @ {job.company} | {job.location}")

    # Easy Apply test - uncomment ONLY on a test/throwaway listing
    # user_id = os.getenv("TEST_USER_ID")
    # from portals.linkedin.apply import linkedin_easy_apply
    # if user_id:
    #     from portals.base import run_safe_apply_for_user
    #     result = await run_safe_apply_for_user(
    #         user_id=user_id,
    #         job=jobs[0],
    #         apply_callable=lambda: linkedin_easy_apply(jobs[0], user_profile={...}),
    #     )
    #     print(f"[APPLY TEST] {result}")
    # else:
    #     print("[SKIP] TEST_USER_ID required for SafeApplyManager logging")

    print("\n=== All tests PASSED ===")


asyncio.run(main())
