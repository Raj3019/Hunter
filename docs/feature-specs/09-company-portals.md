# Feature Spec 09 — Company Portals (TCS, Infosys, Cognizant, Wipro)

## What This Is

Handling company career portals that require a registered account — TCS iBegin, Infosys Careers, Cognizant Careers, Wipro Careers, HCL, and others. The approach: user creates an account once manually on each portal; our app stores the credentials AES-256 encrypted; Playwright logs in automatically using the saved session and handles the apply form. This is the most security-critical feature in the entire app.

## Prerequisites

- `02-core-backend-setup.md` complete (`core/encryption.py` ready)
- `01-database-schema.md` complete (`company_accounts` table exists)
- `10-ai-layer.md` spec reviewed (uses `qa_answerer`)
- `portals/custom/` directory inside `backend/`
- One Chrome profile directory per company: `chrome_profiles/companies/tcs/`, etc.

## Security Rules (Non-Negotiable)

```
✅ Encrypt password immediately on receipt — before any DB write
✅ Decrypt only at the exact moment of page.fill() — nowhere else
✅ Delete decrypted password from memory immediately: del password
✅ ENCRYPTION_KEY only in .env — never in code
✅ Never log or return password or password_encrypted in any response
✅ User must be able to delete all their credentials (hard delete from DB + Chrome profile)
```

---

## Implementation Steps

### Step 1 — `backend/portals/custom/registry.py`

Central source of truth for all company portal configurations. Add new companies here only:

```python
COMPANY_PORTALS = {
    "tcs": {
        "name": "TCS iBegin",
        "signup_url": "https://ibegin.tcs.com/iBegin/",
        "login_url": "https://ibegin.tcs.com/iBegin/",
        "username_selector": "input[name='email'], input[id='email'], input[type='email']",
        "password_selector": "input[type='password']",
        "submit_selector": "button[type='submit'], input[type='submit']",
        "success_indicator": ".dashboard, #dashboard, .home-page, .profile-section",
        "chrome_profile_subdir": "tcs",
    },
    "infosys": {
        "name": "Infosys Careers",
        "signup_url": "https://career.infosys.com/register",
        "login_url": "https://career.infosys.com/login",
        "username_selector": "input[name='email'], input[id='email']",
        "password_selector": "input[name='password'], input[type='password']",
        "submit_selector": "button[type='submit']",
        "success_indicator": ".candidate-dashboard, .profile-section, .my-applications",
        "chrome_profile_subdir": "infosys",
    },
    "cognizant": {
        "name": "Cognizant Careers",
        "signup_url": "https://careers.cognizant.com/global/en/register",
        "login_url": "https://careers.cognizant.com/global/en/login",
        "username_selector": "input[type='email'], input[name='email']",
        "password_selector": "input[type='password']",
        "submit_selector": "button[type='submit']",
        "success_indicator": ".logged-in, .account-nav, .user-profile",
        "chrome_profile_subdir": "cognizant",
    },
    "wipro": {
        "name": "Wipro Careers",
        "signup_url": "https://careers.wipro.com/careers-home/",
        "login_url": "https://careers.wipro.com/careers-home/",
        "username_selector": "input[type='email']",
        "password_selector": "input[type='password']",
        "submit_selector": "button[type='submit']",
        "success_indicator": ".loggedin-nav, .user-account, .nav-signed-in",
        "chrome_profile_subdir": "wipro",
    },
    "hcl": {
        "name": "HCL Technologies",
        "signup_url": "https://www.hcltech.com/careers",
        "login_url": "https://hcl.taleo.net/careersection/hcl_professional/jobsearch.ftl",
        "username_selector": "input[name='j_username']",
        "password_selector": "input[name='j_password']",
        "submit_selector": "input[type='submit'], button[type='submit']",
        "success_indicator": ".candidate-dashboard, .loggedIn",
        "chrome_profile_subdir": "hcl",
    },
}
```

---

### Step 2 — `backend/portals/custom/account_login.py`

```python
from playwright.async_api import async_playwright
from core.encryption import decrypt
import asyncio
import logging

logger = logging.getLogger(__name__)
BASE_PROFILE_DIR = "./chrome_profiles/companies"

async def login_to_company_portal(
    company_key: str,
    username: str,
    password_encrypted: str,
) -> dict:
    from .registry import COMPANY_PORTALS
    company = COMPANY_PORTALS.get(company_key)
    if not company:
        return {"success": False, "reason": f"Unknown company key: {company_key}"}

    profile_dir = f"{BASE_PROFILE_DIR}/{company['chrome_profile_subdir']}"

    # Decrypt only here — at the point of use
    password = decrypt(password_encrypted)

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False  # visible — easier to handle popups
        )
        page = await browser.new_page()

        try:
            await page.goto(company["login_url"], wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)

            # Check if already logged in from saved session
            already_in = await page.query_selector(company["success_indicator"])
            if already_in:
                logger.info(f"Already logged in to {company['name']}")
                await browser.close()
                del password
                return {"success": True, "reason": "Existing session still active"}

            # Fill username
            await page.fill(company["username_selector"], username)
            await page.wait_for_timeout(500)

            # Fill password — decrypt is already done above, use and delete immediately
            await page.fill(company["password_selector"], password)
            del password  # clear from memory right after fill

            await page.wait_for_timeout(500)

            # Submit
            await page.click(company["submit_selector"])
            await page.wait_for_timeout(4000)

            # Verify success
            logged_in = await page.query_selector(company["success_indicator"])
            current_url = page.url

            await browser.close()

            if logged_in:
                logger.info(f"Login successful: {company['name']}")
                return {"success": True, "reason": "Logged in successfully"}
            else:
                return {
                    "success": False,
                    "reason": f"Login may have failed. Current URL: {current_url}"
                }

        except Exception as e:
            try:
                await browser.close()
            except Exception:
                pass
            if "password" in dir():
                del password  # safety net
            logger.error(f"Login error for {company['name']}: {e}")
            return {"success": False, "reason": str(e)}


async def is_session_active(company_key: str) -> bool:
    from .registry import COMPANY_PORTALS
    company = COMPANY_PORTALS.get(company_key)
    if not company:
        return False

    profile_dir = f"{BASE_PROFILE_DIR}/{company['chrome_profile_subdir']}"

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=True
        )
        page = await browser.new_page()

        try:
            await page.goto(company["login_url"], wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)
            logged_in = await page.query_selector(company["success_indicator"])
            await browser.close()
            return bool(logged_in)
        except Exception:
            await browser.close()
            return False
```

---

### Step 3 — `backend/portals/custom/company_apply.py`

```python
from playwright.async_api import async_playwright
from .account_login import login_to_company_portal, is_session_active
from .registry import COMPANY_PORTALS
from ai.qa_answerer import answer_question
from portals.naukri.jobs import Job
import asyncio
import random
import logging

BASE_PROFILE_DIR = "./chrome_profiles/companies"
logger = logging.getLogger(__name__)

async def apply_with_company_account(
    company_key: str,
    job: Job,
    resume_path: str,
    user_profile: dict,
    username: str,
    password_encrypted: str,
) -> dict:
    company = COMPANY_PORTALS.get(company_key)
    if not company:
        return {"success": False, "reason": "Unknown company"}

    # Step 1 — ensure we're logged in
    session_ok = await is_session_active(company_key)
    if not session_ok:
        login_result = await login_to_company_portal(company_key, username, password_encrypted)
        if not login_result["success"]:
            return {"success": False, "reason": f"Login failed: {login_result['reason']}"}

    # Step 2 — apply
    profile_dir = f"{BASE_PROFILE_DIR}/{company['chrome_profile_subdir']}"

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False
        )
        page = await browser.new_page()

        try:
            await page.goto(job.apply_link, wait_until="domcontentloaded")
            await page.wait_for_timeout(2500)

            # Click Apply button
            apply_selectors = [
                "button:has-text('Apply')",
                "a:has-text('Apply Now')",
                "button:has-text('Apply Now')",
                "input[value='Apply']",
                "input[value='Apply Now']",
            ]
            clicked = False
            for selector in apply_selectors:
                try:
                    await page.click(selector, timeout=3000)
                    clicked = True
                    break
                except Exception:
                    continue

            if not clicked:
                await browser.close()
                return {"success": False, "reason": "No Apply button found on job page"}

            await page.wait_for_timeout(2500)

            # Walk through form
            for step in range(15):
                await page.wait_for_timeout(2000)

                # File upload
                file_input = await page.query_selector("input[type='file']")
                if file_input:
                    await file_input.set_input_files(resume_path)
                    await page.wait_for_timeout(1500)

                # Text fields
                inputs = await page.query_selector_all(
                    "input[type='text']:not([readonly]):not([disabled]), "
                    "input[type='tel']:not([readonly]):not([disabled]), "
                    "textarea:not([readonly]):not([disabled])"
                )
                for inp in inputs:
                    try:
                        val = await inp.input_value()
                        if val:
                            continue
                        label = (
                            await inp.get_attribute("aria-label") or
                            await inp.get_attribute("placeholder") or
                            await inp.get_attribute("name") or
                            ""
                        )
                        if label:
                            answer = await answer_question(label, user_profile)
                            if answer:
                                await inp.fill(answer)
                                await page.wait_for_timeout(350)
                    except Exception:
                        continue

                # Dropdowns
                selects = await page.query_selector_all("select:not([disabled])")
                for sel in selects:
                    try:
                        val = await sel.input_value()
                        if not val:
                            options = await sel.query_selector_all("option")
                            if len(options) > 1:
                                await sel.select_option(index=1)
                    except Exception:
                        continue

                # Submit or next
                submit = await page.query_selector(
                    "button[type='submit']:has-text('Submit'), "
                    "button:has-text('Submit Application'), "
                    "input[type='submit'][value*='Submit']"
                )
                next_btn = await page.query_selector(
                    "button:has-text('Next'), button:has-text('Continue'), "
                    "button:has-text('Save and Continue'), input[value='Next']"
                )

                if submit:
                    await submit.click()
                    await page.wait_for_timeout(3000)
                    await browser.close()
                    await asyncio.sleep(random.uniform(60, 180))
                    return {"success": True}
                elif next_btn:
                    await next_btn.click()
                else:
                    logger.warning(f"No navigation at step {step + 1} for {job.title}")
                    break

            await browser.close()
            return {"success": False, "reason": "Could not complete application form"}

        except Exception as e:
            try:
                await browser.close()
            except Exception:
                pass
            logger.error(f"Company apply error ({company_key}): {e}")
            return {"success": False, "reason": str(e)}
```

---

### Step 4 — API Routes for Company Accounts

```python
# backend/api/routes/company_accounts.py

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from core.encryption import encrypt
from core.auth import get_current_user_id
from core.database import get_db
from portals.custom.account_login import is_session_active
from portals.custom.registry import COMPANY_PORTALS

router = APIRouter()

class CompanyAccountIn(BaseModel):
    company_key: str
    username: str
    password: str  # plain text from frontend — encrypted immediately, never stored

class CompanyAccountStatusUpdate(BaseModel):
    account_status: str  # 'active', 'manual_only'

@router.post("")
async def save_company_account(
    body: CompanyAccountIn,
    user_id: str = Depends(get_current_user_id)
):
    if body.company_key not in COMPANY_PORTALS:
        raise HTTPException(status_code=400, detail=f"Unknown company: {body.company_key}")

    encrypted = encrypt(body.password)
    # Immediately clear the plain text from the request body
    body.password = ""

    company_info = COMPANY_PORTALS[body.company_key]
    db = get_db()
    db.table("company_accounts").upsert({
        "user_id": user_id,
        "company_key": body.company_key,
        "company_name": company_info["name"],
        "login_url": company_info["login_url"],
        "signup_url": company_info["signup_url"],
        "username": body.username,
        "password_encrypted": encrypted,
        "account_status": "active",
    }, on_conflict="user_id,company_key").execute()

    # Never return the password or encrypted value
    return {"success": True, "company": body.company_key, "username": body.username}


@router.get("")
async def list_company_accounts(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    rows = db.table("company_accounts").select(
        "company_key, company_name, username, account_status, last_login_at, signup_url"
        # NOTE: password_encrypted is deliberately excluded
    ).eq("user_id", user_id).execute()
    return {"accounts": rows.data}


@router.get("/{company_key}/status")
async def check_session_status(
    company_key: str,
    user_id: str = Depends(get_current_user_id)
):
    active = await is_session_active(company_key)
    return {"company_key": company_key, "session_active": active}


@router.delete("/{company_key}")
async def delete_company_account(
    company_key: str,
    user_id: str = Depends(get_current_user_id)
):
    db = get_db()
    db.table("company_accounts").delete().eq("user_id", user_id).eq("company_key", company_key).execute()

    # Also remove the Chrome profile for that company
    import shutil, os
    from portals.custom.registry import COMPANY_PORTALS
    company = COMPANY_PORTALS.get(company_key, {})
    profile_path = f"./chrome_profiles/companies/{company.get('chrome_profile_subdir', company_key)}"
    if os.path.exists(profile_path):
        shutil.rmtree(profile_path)

    return {"success": True, "deleted": company_key}
```

---

### Step 5 — Test Script

```python
# backend/test_company_portals.py
import asyncio
from core.encryption import encrypt, decrypt
from portals.custom.registry import COMPANY_PORTALS
from portals.custom.account_login import is_session_active, login_to_company_portal
from dotenv import load_dotenv
import os

load_dotenv()

async def main():
    print("=== Company Portal Tests ===")

    # 1. Encryption round-trip
    test_pw = "test_password_123"
    enc = encrypt(test_pw)
    assert enc != test_pw
    assert decrypt(enc) == test_pw
    print("[PASS] Encryption/decryption round-trip")

    # 2. Registry sanity check
    for key, conf in COMPANY_PORTALS.items():
        assert conf.get("login_url"), f"Missing login_url for {key}"
        assert conf.get("username_selector"), f"Missing username_selector for {key}"
        assert conf.get("success_indicator"), f"Missing success_indicator for {key}"
    print(f"[PASS] Registry has {len(COMPANY_PORTALS)} companies, all fields present")

    # 3. Session check (before any login)
    active = await is_session_active("tcs")
    print(f"[INFO] TCS session active before login: {active}")

    # 4. Live login test — requires real credentials in .env
    # tcs_username = os.getenv("TCS_USERNAME")
    # tcs_password = os.getenv("TCS_PASSWORD")
    # if tcs_username and tcs_password:
    #     enc_pw = encrypt(tcs_password)
    #     result = await login_to_company_portal("tcs", tcs_username, enc_pw)
    #     print(f"[LOGIN TEST] TCS: {result}")
    #     active_after = await is_session_active("tcs")
    #     assert active_after, "Session not active after login"
    #     print("[PASS] TCS login + session check")

    print("\n=== Tests complete ===")

asyncio.run(main())
```

---

## Expected Success Behaviour

- Encryption round-trip test passes: `decrypt(encrypt(password)) == password`
- `is_session_active()` returns `False` when no Chrome profile exists, `True` after a successful login
- `login_to_company_portal()` returns `{"success": True}` when credentials are correct
- After login, subsequent `is_session_active()` calls return `True` without re-entering credentials
- Apply form walks through all steps and returns `{"success": True}`
- DELETE endpoint removes the DB row and deletes the Chrome profile directory
- No password, encrypted or plain, appears in any API response

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `{"success": False, "reason": "Login may have failed"}` | Wrong credentials or portal changed login form | Log the `current_url` after submit; inspect what happened |
| `success_indicator` not found after login | Selector outdated — portal redesigned | Open the portal manually after login; find the new element that indicates logged-in state; update `registry.py` |
| Session active but apply fails | Session is valid but user lacks a completed profile on that portal | User must complete their profile on the company portal manually first |
| `shutil.rmtree` fails on delete | Chrome profile directory in use (browser still open) | Ensure all browser contexts are closed before deletion |
| `decrypt()` raises `InvalidToken` | `ENCRYPTION_KEY` changed since encryption | Do not change `ENCRYPTION_KEY` — user must re-enter credentials |

## Challenges

- **Success indicator selectors are the most fragile part**: Company career portals redesign frequently. When `is_session_active()` starts returning `False` even though you're logged in, the `success_indicator` selector is the first thing to check. Inspect the page after login and find a reliable element (e.g., user avatar, logout button, navigation item).
- **TCS iBegin is particularly tricky**: TCS's portal uses a complex single-page app. The session check must wait for JavaScript to fully render before looking for the success indicator.
- **Profile completeness**: Many company portals require you to have a complete profile (education, work history, skills filled in) before you can apply. If the apply form shows "Complete your profile first," the user must do this manually once.
- **CAPTCHA on login**: Some portals show CAPTCHA after a few failed login attempts. The persistent Chrome profile avoids this because the session is already established — CAPTCHA typically only appears on fresh logins.
- **Hard delete is a user right**: The delete endpoint must remove both the DB record AND the Chrome profile directory. An incomplete delete (only DB) leaves the user's session data on disk, which is a privacy violation.
