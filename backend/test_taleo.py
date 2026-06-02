import asyncio
import os

from portals.taleo.jobs import search_taleo_jobs


async def main():
    print("=== Taleo Portal Test (HCL focus) ===")

    jobs = await search_taleo_jobs(
        company_key="hcl",
        keyword="software engineer",
        max_jobs=10,
    )

    if jobs:
        print(f"[PASS] HCL: {len(jobs)} jobs found")
        for job in jobs[:3]:
            print(f"       [{job.job_id}] {job.title} | {job.location}")
            assert job.is_taleo, "is_taleo flag not set"
            assert job.apply_link.startswith("https://hcl.taleo.net"), "Bad apply link"
        print("[PASS] All assertions passed")

        # Apply test - uncomment ONLY with explicit approval on a real target job
        # user_id = os.getenv("TEST_USER_ID")
        # if user_id:
        #     from portals.taleo.apply import taleo_apply
        #     from portals.base import run_safe_apply_for_user
        #     result = await run_safe_apply_for_user(
        #         user_id=user_id,
        #         job=jobs[0],
        #         apply_callable=lambda: taleo_apply(jobs[0], "./test_resume.pdf", user_profile={...}),
        #     )
        #     print(f"[APPLY TEST] {result}")
        # else:
        #     print("[SKIP] TEST_USER_ID required for SafeApplyManager logging")
    else:
        print("[WARN] 0 jobs - check search URL and iframe selectors in DevTools")
        print("       Open https://hcl.taleo.net/careersection/hcl_professional/jobsearch.ftl")
        print("       Inspect the job results table structure and update selectors")


asyncio.run(main())
