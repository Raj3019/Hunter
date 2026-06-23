import asyncio
import os

from dotenv import load_dotenv

from core.database import NULL_RESULT, get_db
from services.job_discovery import DiscoveryError, default_manual_portals, run_manual_search

load_dotenv()


async def main():
    print("=== Manual Search Test ===")
    db = get_db()
    user = _resolve_user(db)
    if not user:
        print("[FAIL] Set HUNTER_TEST_USER_ID or HUNTER_TEST_EMAIL for an existing profile.")
        return

    user_id = user["id"]
    print(f"[INFO] User: {user.get('email') or user_id}")
    _print_prereq(db, user_id, "resumes", "parsed_data")
    _print_preferences(db, user_id)
    _print_portal_status(db, user_id)

    if os.getenv("RUN_MANUAL_SEARCH_FULL") != "1":
        print("[SKIP] Full manual search skipped. Set RUN_MANUAL_SEARCH_FULL=1 to run live portal search/scoring.")
        print("[PASS] Manual search prerequisites inspected")
        return

    query = os.getenv("HUNTER_TEST_SEARCH_QUERY", "")
    location = os.getenv("HUNTER_TEST_SEARCH_LOCATION", "Bengaluru")
    portals = _env_list("HUNTER_TEST_PORTALS", default_manual_portals())
    page = int(os.getenv("HUNTER_TEST_SEARCH_PAGE", os.getenv("HUNTER_TEST_SEARCH_PAGES", "1")))
    print(f"\n[INFO] Running manual search: query={query!r} location={location!r} portals={portals!r} page={page}")

    try:
        result = await run_manual_search(
            db,
            user_id=user_id,
            query=query,
            locations=[location],
            portals=portals,
            page=page,
            results_per_page=int(os.getenv("HUNTER_TEST_RESULTS_PER_PAGE", "5")),
            min_score=int(os.getenv("HUNTER_TEST_MIN_SCORE", "60")),
            freshness_days=30,
        )
    except DiscoveryError as exc:
        print(f"[FAIL] Manual search blocked: HTTP {exc.status_code} {exc.detail}")
        return

    run = result["run"]
    print("[PASS] Manual search completed")
    print(f"       Fetched: {run['fetched_count']}")
    print(f"       New jobs: {run['new_jobs_count']}")
    print(f"       Scored matches returned: {run['saved_matches_count']}")
    print(f"       Recommended matches: {run.get('recommended_count', 0)}")
    print(f"       Portal counts: {run.get('portal_counts') or {}}")
    if result.get("warnings"):
        print(f"       Warnings: {result['warnings'][:3]}")

    print(f"[INFO] Returned scores: {[row['match_score'] for row in result.get('matches', [])[:5]]}")
    print("\n=== Manual search test complete ===")


def _resolve_user(db) -> dict | None:
    user_id = os.getenv("HUNTER_TEST_USER_ID", "").strip()
    if user_id:
        result = db.table("profiles").select("*").eq("id", user_id).maybe_single().execute() or NULL_RESULT
        return result.data

    email = os.getenv("HUNTER_TEST_EMAIL", "").strip()
    if email:
        result = db.table("profiles").select("*").eq("email", email).maybe_single().execute() or NULL_RESULT
        return result.data

    users = db.table("profiles").select("*").limit(1).execute()
    return (users.data or [None])[0]


def _env_list(name: str, fallback: list[str]) -> list[str]:
    value = os.getenv(name, "").strip()
    if not value:
        return fallback
    return [item.strip().lower() for item in value.split(",") if item.strip()]


def _print_prereq(db, user_id: str, table: str, required_field: str) -> None:
    result = db.table(table).select(required_field).eq("user_id", user_id).limit(1).execute()
    ok = bool(result.data and result.data[0].get(required_field))
    print(f"[INFO] {table}.{required_field}: {'present' if ok else 'missing'}")


def _print_preferences(db, user_id: str) -> None:
    result = db.table("preferences").select("*").eq("user_id", user_id).maybe_single().execute() or NULL_RESULT
    prefs = result.data or {}
    print(f"[INFO] preferences.job_titles: {prefs.get('job_titles') or 'missing'}")
    print(f"[INFO] preferences.skills: {prefs.get('skills') or 'missing'}")
    print(f"[INFO] preferences.locations: {prefs.get('locations') or 'missing'}")
    print(f"[INFO] preferences.work_type: {prefs.get('work_type') or 'missing'}")


def _print_portal_status(db, user_id: str) -> None:
    result = db.table("portal_tokens").select("portal, profile_id, created_at").eq(
        "user_id",
        user_id,
    ).execute()
    portals = [row["portal"] for row in (result.data or [])]
    print(f"[INFO] Connected portals: {portals or 'none'}")


if __name__ == "__main__":
    asyncio.run(main())
