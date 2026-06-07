import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from api.routes import applications, auth, company_accounts, jobs, portals, preferences, resume
from core.auth import get_current_user_id
from core.config import FRONTEND_ORIGINS
from core.database import get_db
from scheduler.daily_fetch import daily_job_fetch

logger = logging.getLogger(__name__)

app = FastAPI(title="Hunter API", version="1.0.0")
scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(resume.router, prefix="/api/resume", tags=["resume"])
app.include_router(preferences.router, prefix="/api/preferences", tags=["preferences"])
app.include_router(portals.router, prefix="/api/portals", tags=["portals"])
app.include_router(jobs.router, prefix="/api/jobs", tags=["jobs"])
app.include_router(applications.router, prefix="/api/applications", tags=["applications"])
app.include_router(company_accounts.router, prefix="/api/company-accounts", tags=["company_accounts"])


@app.on_event("startup")
async def startup():
    # Daily auto-fetch is disabled for now: jobs are fetched/scored on demand when
    # the user searches and are NOT stored (only acted-on jobs persist). Keep this
    # code for future use — re-enable to bring back the 8am IST background fetch.
    # scheduler.add_job(
    #     daily_job_fetch,
    #     trigger="cron",
    #     hour=8,
    #     minute=0,
    #     timezone="Asia/Kolkata",
    #     id="daily_job_fetch",
    #     replace_existing=True,
    # )
    # if not scheduler.running:
    #     scheduler.start()
    # logger.info("Scheduler started - daily fetch at 8:00am IST")
    logger.info("Daily auto-fetch is disabled (on-demand search only).")


@app.on_event("shutdown")
async def shutdown():
    if scheduler.running:
        scheduler.shutdown()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/admin/trigger-fetch")
async def trigger_fetch(user_id: str = Depends(get_current_user_id)):
    db = get_db()
    profile = db.table("profiles").select("is_admin").eq(
        "id",
        user_id,
    ).maybe_single().execute()
    if not profile.data or not profile.data.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    asyncio.create_task(daily_job_fetch())
    return {"message": "Fetch triggered in background"}
