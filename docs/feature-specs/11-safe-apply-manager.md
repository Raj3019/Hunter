# Feature Spec 11 — Safe Apply Manager

## What This Is

The safety layer that sits between routes/scheduler jobs and portal-specific apply functions. Every apply runs pre-apply checks and writes an application audit record. Auto-apply additionally uses SafeApplyManager throttling: per-portal daily limits, time-of-day restrictions, human-like random delays, and safe logging. Manual Apply now is user-reviewed and should submit immediately after core blockers are clear.

## Prerequisites

- `01-database-schema.md` complete (`applications` table exists)
- `02-core-backend-setup.md` complete (DB client available)
- `backend/portals/base.py` file location

## Why This Exists

Without rate limiting:
- Naukri bans accounts applying more than 20 jobs/day
- LinkedIn triggers CAPTCHA and account restrictions above 30/day
- Any portal applies at 3am looks like a bot

These limits are not guidelines — exceeding them risks permanent account bans for the user.

---

## Apply Modes

SafeApplyManager exists mainly for **auto-apply** and batch automation. For a user-reviewed **Manual Apply now** action, Hunter should check approval, portal session/token, duplicate status, resume availability, job availability where supported, and questionnaire readiness, then submit immediately if checks pass.

| Mode | Trigger | Safety behavior |
|---|---|---|
| Manual Apply now | User clicks Apply on a reviewed, approved match | Run quick pre-apply checks, submit immediately if clear, log result. Do not add random delay unless a portal-specific hard safety rule requires it. |
| Auto-apply | User enables automated daily applying | Enforce safe window, daily limit, score threshold, allowed portals, tailored-resume requirement, random delay, and logging. |

Recommended auto-apply default window: **9am-8pm IST**.

## Implementation Steps

### Step 1 — `backend/portals/base.py`

```python
import time
import random
import logging
from datetime import datetime, date, timezone
from zoneinfo import ZoneInfo

from core.database import get_db

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")

# Daily apply limits per portal (conservative — err on the side of safety)
PORTAL_LIMITS = {
    "naukri":      20,
    "foundit":     20,
    "internshala": 30,
    "linkedin":    30,
    "workday":     50,   # company sites — conservative despite no platform limit
    "taleo":       50,
    "tcs":         10,   # custom portals — very conservative
    "infosys":     10,
    "cognizant":   10,
    "wipro":       10,
    "hcl":         10,
}

# Random delay range (seconds) between applies per portal
PORTAL_DELAYS = {
    "naukri":      (30,  90),
    "foundit":     (30,  90),
    "internshala": (20,  60),
    "linkedin":    (45, 120),
    "workday":     (60, 150),
    "taleo":       (60, 150),
    "tcs":         (60, 180),
    "infosys":     (60, 180),
    "cognizant":   (60, 180),
    "wipro":       (60, 180),
    "hcl":         (60, 180),
}

# Safe hours window (IST)
SAFE_HOUR_START = 9   # 9:00 AM IST
SAFE_HOUR_END   = 20  # 8:00 PM IST


class SafeApplyManager:
    def __init__(self):
        self.db = get_db()

    def can_apply(self, user_id: str, portal: str) -> tuple[bool, str]:
        """
        Returns (True, "ok") if safe to apply.
        Returns (False, reason_string) if blocked.
        """
        # 1. Time-of-day check
        now_ist = datetime.now(IST)
        hour = now_ist.hour
        if hour < SAFE_HOUR_START or hour >= SAFE_HOUR_END:
            return False, (
                f"Outside safe hours. Apply window: {SAFE_HOUR_START}am–{SAFE_HOUR_END}pm IST. "
                f"Current time: {now_ist.strftime('%H:%M')} IST"
            )

        # 2. Daily limit check
        limit = PORTAL_LIMITS.get(portal, 10)
        today_count = self._get_today_count(user_id, portal)
        if today_count >= limit:
            return False, (
                f"Daily limit reached for {portal}: {today_count}/{limit} applications today. "
                f"Resets at midnight IST."
            )

        return True, "ok"

    def safe_delay(self, portal: str) -> float:
        """Sleep for a human-like random delay and return the actual seconds slept."""
        min_d, max_d = PORTAL_DELAYS.get(portal, (30, 90))
        delay = random.uniform(min_d, max_d)
        logger.info(f"[SafeApply] Waiting {delay:.1f}s before next {portal} apply...")
        time.sleep(delay)
        return delay

    def log_application(
        self,
        user_id: str,
        job,
        result: dict,
        tailored_resume_url: str = ""
    ) -> None:
        """Write the application record to the database."""
        try:
            self.db.table("applications").insert({
                "user_id": user_id,
                "job_id": job.job_id if hasattr(job, "job_id") else str(job.get("id")),
                "portal": job.portal if hasattr(job, "portal") else job.get("portal"),
                "status": "applied" if result.get("success") else "failed",
                "tailored_resume_url": tailored_resume_url,
                "notes": result.get("reason", ""),
            }).execute()
        except Exception as e:
            logger.error(f"Failed to log application to DB: {e}")

    def update_job_match_status(self, user_id: str, job_id: str, status: str) -> None:
        """Update the job_matches table after an apply attempt."""
        try:
            self.db.table("job_matches").update(
                {"status": status}
            ).eq("user_id", user_id).eq("job_id", job_id).execute()
        except Exception as e:
            logger.error(f"Failed to update job_match status: {e}")

    def get_today_stats(self, user_id: str) -> dict:
        """Return today's apply counts per portal for display in UI."""
        today_start = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0)
        stats = {}
        for portal, limit in PORTAL_LIMITS.items():
            count = self._get_today_count(user_id, portal)
            stats[portal] = {"applied": count, "limit": limit, "remaining": limit - count}
        return stats

    def _get_today_count(self, user_id: str, portal: str) -> int:
        """Count applications for user+portal today (midnight-to-midnight IST)."""
        today_start = datetime.now(IST).replace(
            hour=0, minute=0, second=0, microsecond=0
        ).astimezone(timezone.utc).isoformat()

        try:
            result = self.db.table("applications").select(
                "id", count="exact"
            ).eq("user_id", user_id).eq("portal", portal).gte(
                "applied_at", today_start
            ).execute()
            return result.count or 0
        except Exception as e:
            logger.error(f"Failed to get today's count for {portal}: {e}")
            return 0  # fail open — allow the apply rather than blocking
```

---

### Step 2 — Usage Pattern in Any Apply Flow

Every apply call must run pre-apply checks and log the result. Only auto-apply must enforce the full time-window and random-delay behavior.

Manual Apply now pattern:

```python
async def run_manual_apply_for_user(user_id: str, job, resume_path: str, user_profile: dict):
    checks = pre_apply_checks(user_id=user_id, job=job, resume_path=resume_path)
    if not checks["ok"]:
        result = {
            "success": False,
            "blocked": True,
            "reason": checks["reason"],
            "apply_mode": "manual",
            "pre_apply_check": checks,
        }
        manager.log_application(user_id, job, result)
        return result

    result = await run_portal_apply(job, resume_path, user_profile)
    result["apply_mode"] = "manual"
    result["pre_apply_check"] = checks
    manager.log_application(user_id, job, result)
    manager.update_job_match_status(
        user_id,
        job.job_id,
        "applied" if result.get("success") else "failed",
    )
    return result
```

Auto-apply pattern:

```python
from portals.base import SafeApplyManager

manager = SafeApplyManager()

async def run_apply_for_user(user_id: str, job, resume_path: str, user_profile: dict):
    # 1. Check auto-apply throttling before doing anything
    ok, reason = manager.can_apply(user_id, job.portal)
    if not ok:
        logger.info(f"Apply blocked: {reason}")
        result = {"success": False, "reason": reason, "blocked": True, "apply_mode": "auto"}
        manager.log_application(user_id, job, result)
        return result

    # 2. Run the actual apply (portal-specific)
    if job.portal == "naukri":
        result = naukri_client.apply_job(job)
    elif job.portal == "linkedin":
        result = await linkedin_easy_apply(job, user_profile)
    elif job.portal == "workday":
        result = await workday_apply(job, resume_path, user_profile)
    # ... etc

    # 3. Log the result (success or failure)
    manager.log_application(user_id, job, result)

    # 4. Update job match status
    status = "applied" if result.get("success") else "failed"
    manager.update_job_match_status(user_id, job.job_id, status)

    # 5. Human-like delay before next auto-apply
    if result.get("success"):
        manager.safe_delay(job.portal)

    return result
```

---

### Step 3 — Test Script

```python
# backend/test_safe_apply_manager.py
import asyncio
from unittest.mock import MagicMock, patch
from portals.base import SafeApplyManager, PORTAL_LIMITS, PORTAL_DELAYS, SAFE_HOUR_START, SAFE_HOUR_END
from portals.naukri.jobs import Job
from datetime import datetime
from zoneinfo import ZoneInfo
from dotenv import load_dotenv

load_dotenv()

IST = ZoneInfo("Asia/Kolkata")

def test_portal_limits_defined():
    for portal in ["naukri", "foundit", "linkedin", "workday", "internshala"]:
        assert portal in PORTAL_LIMITS, f"Missing limit for {portal}"
        assert portal in PORTAL_DELAYS, f"Missing delay for {portal}"
        assert PORTAL_LIMITS[portal] > 0
        min_d, max_d = PORTAL_DELAYS[portal]
        assert max_d > min_d > 0
    print("[PASS] All portal limits and delays defined")

def test_time_window():
    assert SAFE_HOUR_START < SAFE_HOUR_END
    assert 0 <= SAFE_HOUR_START <= 23
    assert 0 <= SAFE_HOUR_END <= 23
    print(f"[PASS] Safe hours: {SAFE_HOUR_START}am to {SAFE_HOUR_END}pm IST")

def test_can_apply_outside_hours():
    manager = SafeApplyManager()
    # Mock to simulate 2am IST
    with patch("portals.base.datetime") as mock_dt:
        mock_now = datetime(2025, 1, 1, 2, 0, 0, tzinfo=IST)  # 2am
        mock_dt.now.return_value = mock_now
        ok, reason = manager.can_apply("test_user_id", "naukri")
        assert not ok, "Should block at 2am"
        assert "safe hours" in reason.lower()
    print("[PASS] Blocked outside safe hours")

def test_delay_is_in_range():
    manager = SafeApplyManager()
    for portal in ["naukri", "linkedin", "workday"]:
        min_d, max_d = PORTAL_DELAYS[portal]
        # Sleep mocked to avoid actual waiting
        with patch("time.sleep"):
            delay = manager.safe_delay(portal)
        assert min_d <= delay <= max_d, f"Delay {delay} outside [{min_d}, {max_d}] for {portal}"
    print("[PASS] Delays are within expected ranges")

def test_today_stats_structure():
    manager = SafeApplyManager()
    stats = manager.get_today_stats("test_user_id")
    for portal in ["naukri", "linkedin"]:
        assert portal in stats
        assert "applied" in stats[portal]
        assert "limit" in stats[portal]
        assert "remaining" in stats[portal]
        assert stats[portal]["applied"] + stats[portal]["remaining"] == stats[portal]["limit"]
    print("[PASS] Today stats structure correct")

if __name__ == "__main__":
    test_portal_limits_defined()
    test_time_window()
    test_can_apply_outside_hours()
    test_delay_is_in_range()
    test_today_stats_structure()
    print("\n=== All SafeApplyManager tests PASSED ===")
```

---

## Expected Success Behaviour

- Auto-apply `can_apply()` returns `(False, ...)` when called outside the configured safe window
- Auto-apply `can_apply()` returns `(False, ...)` when today's count equals the portal limit
- Auto-apply `can_apply()` returns `(True, "ok")` inside safe hours with count below limit
- Manual Apply now runs pre-apply checks and submits immediately when blockers are clear
- `safe_delay("naukri")` sleeps between 30 and 90 seconds
- `log_application()` inserts a row into the `applications` table
- `get_today_stats()` returns a dict with `applied`, `limit`, `remaining` for each portal

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `_get_today_count` returns 0 always | DB query failing silently | Log the exception; check Supabase connection and RLS policies |
| Auto-apply `can_apply` always returns `True` outside safe hours | IST timezone or configured window not correctly applied | Verify `ZoneInfo("Asia/Kolkata")` import works; check user settings |
| `log_application` fails silently | DB insert error (missing required field) | Add explicit logging of the DB error; check that `job.job_id` maps to a valid UUID in `jobs` table |
| Test fails on `safe_delay` range | `random.uniform` returns edge values | The test range check is inclusive — edge values are valid; check your assertion |

## Challenges

- **Timezone correctness is critical**: The IST time window check (`9am–8pm`) must use the actual IST timezone, not the server's local timezone (which is likely UTC on EC2). Using `ZoneInfo("Asia/Kolkata")` is correct. Test this explicitly in the test suite.
- **`_get_today_count` must not block applies on failure**: If the DB query fails (network issue, etc.), the method returns `0` (fail open). This is intentional — a DB timeout should not prevent a user from applying. However, this means the limit could theoretically be exceeded in a failure scenario. Acceptable for MVP.
- **The `log_application` call must always happen**, even when apply returns failure. This gives a full audit trail of what was attempted vs. what succeeded, which is essential for debugging portal issues.
- **Daily limit resets at midnight IST**: The `today_start` calculation uses midnight IST. If the server is in UTC, make sure the conversion is correct — a midnight UTC cutoff would be 5:30am IST, causing daily stats to be wrong.
- **Apply delay timing**: The `safe_delay()` call is for auto-apply only and should happen AFTER logging, so if logging fails, we do not skip the delay. Manual Apply now should not wait for random delay unless a portal-specific hard safety rule requires it.
