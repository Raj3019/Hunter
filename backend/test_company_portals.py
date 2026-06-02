import asyncio
import os

from dotenv import load_dotenv

from core.encryption import decrypt, encrypt
from portals.custom.account_login import is_session_active
from portals.custom.registry import COMPANY_PORTALS

load_dotenv()


async def main():
    print("=== Company Portal Tests ===")

    test_pw = "test_password_123"
    enc = encrypt(test_pw)
    assert enc != test_pw
    assert decrypt(enc) == test_pw
    print("[PASS] Encryption/decryption round-trip")

    for key, conf in COMPANY_PORTALS.items():
        assert conf.get("login_url"), f"Missing login_url for {key}"
        assert conf.get("username_selector"), f"Missing username_selector for {key}"
        assert conf.get("success_indicator"), f"Missing success_indicator for {key}"
    print(f"[PASS] Registry has {len(COMPANY_PORTALS)} companies, all fields present")

    if os.getenv("RUN_COMPANY_BROWSER_CHECK") == "1":
        active = await is_session_active("tcs")
        print(f"[INFO] TCS session active before login: {active}")
    else:
        print("[SKIP] Browser session check skipped. Set RUN_COMPANY_BROWSER_CHECK=1 to enable.")

    # Live login test - requires real credentials in .env
    # from portals.custom.account_login import login_to_company_portal
    # import os
    # tcs_username = os.getenv("TCS_USERNAME")
    # tcs_password = os.getenv("TCS_PASSWORD")
    # if tcs_username and tcs_password:
    #     enc_pw = encrypt(tcs_password)
    #     result = await login_to_company_portal("tcs", tcs_username, enc_pw)
    #     print(f"[LOGIN TEST] TCS: {result}")
    #     active_after = await is_session_active("tcs")
    #     assert active_after, "Session not active after login"
    #     print("[PASS] TCS login + session check")

    # Live apply test - requires explicit approval, a real job, and TEST_USER_ID
    # from portals.custom.company_apply import apply_with_company_account
    # from portals.base import run_safe_apply_for_user
    # user_id = os.getenv("TEST_USER_ID")
    # if user_id:
    #     result = await run_safe_apply_for_user(
    #         user_id=user_id,
    #         job=job,
    #         apply_callable=lambda: apply_with_company_account(
    #             "tcs",
    #             job,
    #             "./test_resume.pdf",
    #             user_profile={...},
    #             username=tcs_username,
    #             password_encrypted=enc_pw,
    #         ),
    #     )
    #     print(f"[APPLY TEST] TCS: {result}")
    # else:
    #     print("[SKIP] TEST_USER_ID required for SafeApplyManager logging")

    print("\n=== Tests complete ===")


asyncio.run(main())
