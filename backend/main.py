import asyncio
import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import applications, auth, company_accounts, jobs, portals, preferences, resume
from core.config import FRONTEND_URL
from scheduler.daily_fetch import daily_job_fetch

logger = logging.getLogger(__name__)

app = FastAPI(title="Hunter API", version="1.0.0")
scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
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
    scheduler.add_job(
        daily_job_fetch,
        trigger="cron",
        hour=8,
        minute=0,
        timezone="Asia/Kolkata",
        id="daily_job_fetch",
        replace_existing=True,
    )
    if not scheduler.running:
        scheduler.start()
    logger.info("Scheduler started - daily fetch at 8:00am IST")


@app.on_event("shutdown")
async def shutdown():
    if scheduler.running:
        scheduler.shutdown()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/api/admin/trigger-fetch")
async def trigger_fetch():
    asyncio.create_task(daily_job_fetch())
    return {"message": "Fetch triggered in background"}
