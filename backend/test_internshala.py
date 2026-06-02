import asyncio
import os

from dotenv import load_dotenv

from portals.internshala.apply import internshala_apply
from portals.internshala.auth import InternshalaAuthClient
from portals.internshala.jobs import InternshalaJobClient

load_dotenv()


def safe_text(value: str) -> str:
    return str(value).encode("ascii", "backslashreplace").decode()


async def main():
    print("=== Internshala Portal Test ===")

    email = os.getenv("INTERNSHALA_EMAIL")
    password = os.getenv("INTERNSHALA_PASSWORD")
    if not email or not password:
        raise RuntimeError(
            "Missing INTERNSHALA_EMAIL or INTERNSHALA_PASSWORD. "
            "Add them to backend/.env or export them before running this test."
        )

    auth = InternshalaAuthClient()
    try:
        session = auth.login(email, password)
        print(f"[PASS] Login - session_id: {session.session_id[:15] if session.session_id else 'cookie-based'}")

        assert auth.is_logged_in(), "is_logged_in() returned False after successful login"
        print("[PASS] is_logged_in() check")
    except RuntimeError as exc:
        if "captcha" not in str(exc).lower():
            raise
        print("[SKIP] Requests login blocked by Internshala captcha.")
        print("       Run: python -m portals.internshala.setup_browser_session")
        print("       Search endpoints are public, so continuing search checks.")

    jc = InternshalaJobClient(auth)

    internships = jc.search_internships(keyword="web development", location="Delhi")
    assert len(internships) > 0, "No internships returned"
    print(f"[PASS] Internship search - {len(internships)} returned")
    for internship in internships[:2]:
        print(
            "       "
            f"{safe_text(internship.title)} @ {safe_text(internship.company)} | "
            f"{safe_text(internship.salary)} | {safe_text(internship.location)}"
        )
        assert internship.job_id, "Missing job_id"
        assert internship.apply_link.startswith("https://internshala.com"), "Bad apply link"

    jobs = jc.search_jobs(keyword="Python", location="Bangalore")
    print(f"[PASS] Job search - {len(jobs)} returned")

    # Apply test - uncomment only when ready for real test
    # user_id = os.getenv("TEST_USER_ID")
    # if user_id and internships:
    #     from portals.base import run_safe_apply_for_user
    #     result = await run_safe_apply_for_user(
    #         user_id=user_id,
    #         job=internships[0],
    #         apply_callable=lambda: internshala_apply(
    #             job_url=internships[0].apply_link,
    #             cover_letter="I am excited about this opportunity...",
    #         ),
    #     )
    #     print(f"[APPLY TEST] {result}")
    # elif not user_id:
    #     print("[SKIP] TEST_USER_ID required for SafeApplyManager logging")

    print("\n=== All tests PASSED ===")


asyncio.run(main())
