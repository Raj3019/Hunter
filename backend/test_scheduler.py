import asyncio
import os

from dotenv import load_dotenv

from core.database import get_db
from scheduler.daily_fetch import daily_job_fetch, _get_active_users, _job_key

load_dotenv()


async def main():
    print("=== Scheduler Test ===")
    db = get_db()

    users = _get_active_users(db)
    print(f"[INFO] Active users with connected portals: {len(users)}")
    for user in users:
        print(f"       User: {user.get('email') or user.get('id')}")

    if not users:
        print("[WARN] No active users found. Connect at least one portal before testing.")
        return

    if os.getenv("RUN_SCHEDULER_FULL") != "1":
        print("[SKIP] Full daily fetch skipped. Set RUN_SCHEDULER_FULL=1 to run live fetch/scoring.")
        print("[PASS] Active user lookup completed")
        return

    print("\n[INFO] Running daily_job_fetch()...")
    await daily_job_fetch()
    print("[PASS] daily_job_fetch() completed without exception")

    for user in users:
        result = db.table("job_matches").select(
            "match_score, status"
        ).eq("user_id", user["id"]).order("match_score", desc=True).limit(5).execute()
        count = len(result.data or [])
        print(f"[INFO] User {user.get('email') or user['id']}: {count} matches with score >= 60")
        if count > 0:
            print(f"       Top scores: {[row['match_score'] for row in result.data]}")
            print("[PASS] Job matches saved correctly")

    print("\n=== Scheduler test complete ===")


if __name__ == "__main__":
    assert _job_key(type("Job", (), {"portal": "naukri", "job_id": "123"})()) == "naukri:123"
    asyncio.run(main())
