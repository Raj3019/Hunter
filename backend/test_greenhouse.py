import asyncio
import os

from portals.greenhouse.jobs import get_job_detail, search_greenhouse_jobs


async def main():
    print("=== Greenhouse Portal Test ===\n")

    print("Testing API access (no auth required)...")
    jobs = await search_greenhouse_jobs(
        keyword="",
        companies=["phonepe"],
        location_filter="india",
        max_per_company=5,
    )
    assert len(jobs) > 0, "PhonePe Greenhouse API returned 0 jobs - slug may have changed"
    print(f"[PASS] PhonePe: {len(jobs)} jobs found")
    for job in jobs[:2]:
        print(f"       {job.title} | {job.location} | link: {job.apply_link}")
        assert job.job_id, "Missing job_id"
        assert (
            job.apply_link.startswith("https://boards.greenhouse.io") or
            job.apply_link.startswith("https://job-boards.greenhouse.io")
        ), "Bad apply link"

    frontend_jobs = await search_greenhouse_jobs(
        keyword="frontend",
        companies=["phonepe", "groww", "postman"],
        location_filter="india",
        max_per_company=10,
    )
    print(f"\n[PASS] Keyword 'frontend' across 3 companies: {len(frontend_jobs)} jobs")
    for job in frontend_jobs[:3]:
        assert "frontend" in job.title.lower(), f"Keyword filter failed: got '{job.title}'"
        print(f"       [{job.company}] {job.title}")

    all_jobs = await search_greenhouse_jobs(
        keyword="engineer",
        companies=["phonepe", "groww", "postman"],
        location_filter="india",
        max_per_company=5,
    )
    print(f"\n[PASS] Multi-company search: {len(all_jobs)} total jobs from 3 live companies")

    if jobs:
        detail = await get_job_detail("phonepe", jobs[0].job_id)
        assert "title" in detail, "Job detail missing title"
        print(f"\n[PASS] Job detail fetch: {detail.get('title')}")
        print(f"       Description length: {len(detail.get('content', ''))} chars")

    # Apply test - uncomment ONLY with explicit approval on a real target job
    # user_id = os.getenv("TEST_USER_ID")
    # if user_id and jobs:
    #     from portals.greenhouse.apply import greenhouse_apply
    #     from portals.base import run_safe_apply_for_user
    #     result = await run_safe_apply_for_user(
    #         user_id=user_id,
    #         job=jobs[0],
    #         apply_callable=lambda: greenhouse_apply(
    #             jobs[0],
    #             "./test_resume.pdf",
    #             user_profile={...},
    #             cover_letter="",
    #         ),
    #     )
    #     print(f"[APPLY TEST] {result}")
    # elif not user_id:
    #     print("[SKIP] TEST_USER_ID required for SafeApplyManager logging")

    bad_jobs = await search_greenhouse_jobs(
        keyword="engineer",
        companies=["definitely_not_a_real_company_xyz"],
        location_filter="india",
    )
    assert bad_jobs == [], "Should return [] for unknown slug"
    print("\n[PASS] Unknown slug returns [] gracefully")

    print("\n=== All Greenhouse tests PASSED ===")


asyncio.run(main())
