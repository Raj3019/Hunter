import asyncio
import os

from portals.workday.jobs import search_workday_jobs


async def main():
    print("=== Workday Portal Test ===")

    test_companies = ["wipro", "capgemini", "adobe"]

    for company_key in test_companies:
        try:
            jobs = await search_workday_jobs(
                company_key=company_key,
                keyword="software engineer",
                location="India",
                max_jobs=10,
            )
        except Exception as exc:
            print(f"[WARN] {company_key}: search failed - {exc}")
            continue

        status = (
            f"[PASS] {company_key}: {len(jobs)} jobs"
            if jobs else
            f"[WARN] {company_key}: 0 jobs - check URL or selector"
        )
        print(status)
        for job in jobs[:2]:
            print(f"       {job.title} | link: {job.apply_link[:60]}...")

    # Apply test (manual - pick a job you don't mind applying to)
    # jobs = await search_workday_jobs("wipro", "Python developer")
    # user_id = os.getenv("TEST_USER_ID")
    # if user_id and jobs:
    #     from portals.workday.apply import workday_apply
    #     from portals.base import run_safe_apply_for_user
    #     result = await run_safe_apply_for_user(
    #         user_id=user_id,
    #         job=jobs[0],
    #         apply_callable=lambda: workday_apply(jobs[0], "./test_resume.pdf", user_profile={...}),
    #     )
    #     print(f"[APPLY TEST] {result}")
    # elif not user_id:
    #     print("[SKIP] TEST_USER_ID required for SafeApplyManager logging")

    print("\n=== Test complete ===")


asyncio.run(main())
