import logging
import random
import time
from datetime import datetime, timezone
from inspect import isawaitable
from zoneinfo import ZoneInfo

from core.database import get_db

logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")

PORTAL_LIMITS = {
    "naukri": 20,
    "foundit": 20,
    "internshala": 30,
    "linkedin": 30,
    "workday": 50,
    "taleo": 50,
    "tcs": 10,
    "infosys": 10,
    "cognizant": 10,
    "wipro": 10,
    "hcl": 10,
}

PORTAL_DELAYS = {
    "naukri": (30, 90),
    "foundit": (30, 90),
    "internshala": (20, 60),
    "linkedin": (45, 120),
    "workday": (60, 150),
    "taleo": (60, 150),
    "tcs": (60, 180),
    "infosys": (60, 180),
    "cognizant": (60, 180),
    "wipro": (60, 180),
    "hcl": (60, 180),
}

SAFE_HOUR_START = 9
SAFE_HOUR_END = 20


def _format_safe_hour(hour: int) -> str:
    if hour == 0 or hour == 24:
        return "12:00 AM"
    if hour == 12:
        return "12:00 PM"
    if hour < 12:
        return f"{hour}:00 AM"
    return f"{hour - 12}:00 PM"


class SafeApplyManager:
    def __init__(self):
        self.db = get_db()

    def can_apply(self, user_id: str, portal: str) -> tuple[bool, str]:
        now_ist = datetime.now(IST)
        hour = now_ist.hour
        if hour < SAFE_HOUR_START or hour >= SAFE_HOUR_END:
            return False, (
                "Outside safe hours. Apply window: "
                f"{_format_safe_hour(SAFE_HOUR_START)}-{_format_safe_hour(SAFE_HOUR_END)} IST. "
                f"Current time: {now_ist.strftime('%H:%M')} IST"
            )

        limit = PORTAL_LIMITS.get(portal, 10)
        today_count = self._get_today_count(user_id, portal)
        if today_count >= limit:
            return False, (
                f"Daily limit reached for {portal}: {today_count}/{limit} applications today. "
                "Resets at midnight IST."
            )

        return True, "ok"

    def safe_delay(self, portal: str) -> float:
        min_d, max_d = PORTAL_DELAYS.get(portal, (30, 90))
        delay = random.uniform(min_d, max_d)
        logger.info("[SafeApply] Waiting %.1fs before next %s apply...", delay, portal)
        time.sleep(delay)
        return delay

    def log_application(
        self,
        user_id: str,
        job,
        result: dict,
        tailored_resume_url: str = "",
        resume_version: str = "",
    ) -> None:
        try:
            db_job_id = self._get_or_create_db_job_id(job)
            if not db_job_id:
                logger.error("Failed to resolve DB job id for application log")
                return

            success = self._is_apply_success(result)
            blocked = bool(result.get("blocked"))
            status = "applied" if success else "blocked" if blocked else "failed"
            reason = self._result_notes(result)

            self.db.table("applications").insert({
                "user_id": user_id,
                "job_id": db_job_id,
                "portal": job.portal if hasattr(job, "portal") else job.get("portal"),
                "status": status,
                "apply_mode": result.get("apply_mode", "manual"),
                "pre_apply_check": result.get("pre_apply_check") or {},
                "portal_response": result.get("portal_response") or result,
                "tailored_resume_url": tailored_resume_url,
                "resume_version": result.get("resume_version") or resume_version,
                "blocked_reason": reason if blocked else "",
                "failed_reason": reason if not success and not blocked else "",
                "notes": reason,
            }).execute()
        except Exception as exc:
            logger.error("Failed to log application to DB: %s", exc)

    def update_job_match_status(self, user_id: str, job_id: str, status: str) -> None:
        try:
            self.db.table("job_matches").update(
                {"status": status}
            ).eq("user_id", user_id).eq("job_id", job_id).execute()
        except Exception as exc:
            logger.error("Failed to update job_match status: %s", exc)

    def get_today_stats(self, user_id: str) -> dict:
        stats = {}
        for portal, limit in PORTAL_LIMITS.items():
            count = self._get_today_count(user_id, portal)
            stats[portal] = {
                "applied": count,
                "limit": limit,
                "remaining": max(0, limit - count),
            }
        return stats

    def _get_today_count(self, user_id: str, portal: str) -> int:
        today_start = datetime.now(IST).replace(
            hour=0,
            minute=0,
            second=0,
            microsecond=0,
        ).astimezone(timezone.utc).isoformat()

        try:
            result = self.db.table("applications").select(
                "id",
                count="exact",
            ).eq("user_id", user_id).eq("portal", portal).gte(
                "applied_at",
                today_start,
            ).execute()
            return result.count or 0
        except Exception as exc:
            logger.error("Failed to get today's count for %s: %s", portal, exc)
            return 0

    def _get_or_create_db_job_id(self, job) -> str:
        portal = job.portal if hasattr(job, "portal") else job.get("portal")
        portal_job_id = job.job_id if hasattr(job, "job_id") else str(job.get("id"))

        existing = self.db.table("jobs").select("id").eq(
            "portal",
            portal,
        ).eq("job_id", portal_job_id).limit(1).execute()
        if existing.data:
            return existing.data[0]["id"]

        record = {
            "portal": portal,
            "job_id": portal_job_id,
            "title": job.title if hasattr(job, "title") else job.get("title", ""),
            "company": job.company if hasattr(job, "company") else job.get("company", ""),
            "location": job.location if hasattr(job, "location") else job.get("location", ""),
            "description": job.description if hasattr(job, "description") else job.get("description", ""),
            "salary": job.salary if hasattr(job, "salary") else job.get("salary", ""),
            "experience": job.experience if hasattr(job, "experience") else job.get("experience", ""),
            "tags": job.tags if hasattr(job, "tags") else job.get("tags", []),
            "apply_link": job.apply_link if hasattr(job, "apply_link") else job.get("apply_link", ""),
            "posted_date": job.posted_date if hasattr(job, "posted_date") else job.get("posted_date", ""),
            "is_workday": job.is_workday if hasattr(job, "is_workday") else job.get("is_workday", False),
            "is_taleo": job.is_taleo if hasattr(job, "is_taleo") else job.get("is_taleo", False),
            "has_questionnaire": (
                job.has_questionnaire if hasattr(job, "has_questionnaire")
                else job.get("has_questionnaire", False)
            ),
        }

        created = self.db.table("jobs").upsert(
            record,
            on_conflict="portal,job_id",
        ).execute()
        if created.data:
            return created.data[0]["id"]

        refetched = self.db.table("jobs").select("id").eq(
            "portal",
            portal,
        ).eq("job_id", portal_job_id).limit(1).execute()
        if refetched.data:
            return refetched.data[0]["id"]
        return ""

    def _is_apply_success(self, result: dict) -> bool:
        if result.get("success") is True:
            return True
        if result.get("statusCode") == 0:
            jobs = result.get("jobs") or []
            if any(job.get("status") == 200 for job in jobs if isinstance(job, dict)):
                return True
            apply_status = result.get("applyStatus") or {}
            if any(status == 200 for status in apply_status.values()):
                return True
        return False

    def _result_notes(self, result: dict) -> str:
        if result.get("reason"):
            return str(result["reason"])
        jobs = result.get("jobs") or []
        messages = [
            str(job.get("message"))
            for job in jobs
            if isinstance(job, dict) and job.get("message")
        ]
        chatbot = result.get("chatbotResponse") or {}
        speech = chatbot.get("speechResponse") or []
        messages.extend(
            str(item.get("response"))
            for item in speech
            if isinstance(item, dict) and item.get("response")
        )
        return " | ".join(messages)[:1000]


async def run_safe_apply_for_user(
    user_id: str,
    job,
    apply_callable,
    tailored_resume_url: str = "",
    manager: SafeApplyManager | None = None,
) -> dict:
    manager = manager or SafeApplyManager()
    portal = job.portal if hasattr(job, "portal") else job.get("portal")

    ok, reason = manager.can_apply(user_id, portal)
    if not ok:
        logger.info("Apply blocked: %s", reason)
        result = {"success": False, "reason": reason, "blocked": True, "apply_mode": "auto"}
        manager.log_application(user_id, job, result, tailored_resume_url=tailored_resume_url)
        return result

    result = apply_callable()
    if isawaitable(result):
        result = await result
    result.setdefault("apply_mode", "auto")

    manager.log_application(user_id, job, result, tailored_resume_url=tailored_resume_url)

    db_job_id = manager._get_or_create_db_job_id(job)
    status = "applied" if manager._is_apply_success(result) else "failed"
    if db_job_id:
        manager.update_job_match_status(user_id, db_job_id, status)

    if manager._is_apply_success(result):
        manager.safe_delay(portal)

    return result
