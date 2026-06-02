from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import company_accounts
from core.config import FRONTEND_URL

app = FastAPI(title="Hunter API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers are mounted as later feature specs are implemented.
# from api.routes import auth, resume, preferences, jobs, applications, portals, company_accounts
# app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
# app.include_router(resume.router, prefix="/api/resume", tags=["resume"])
app.include_router(company_accounts.router, prefix="/api/company-accounts", tags=["company_accounts"])


@app.get("/health")
async def health():
    return {"status": "ok"}
