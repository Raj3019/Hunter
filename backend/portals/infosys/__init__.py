"""Infosys careers integration (auto-detect applied status).

career.infosys.com is a custom SPA whose login is **Keycloak OIDC** (plain
email+password — no OTP, no reCAPTCHA, verified live). After login the candidate's
submitted applications come from a clean JSON REST endpoint
(`getCandidateApplications` -> `candidateApplicationsList`). We log in headless,
capture that response, and read the applied jobs. Read-only — never applies.

Different platform from SuccessFactors (Keycloak + REST vs DWR), but it plugs into
the shared `portals/career_portals.py` registry so storage/reconcile/routes/UI are
common.
"""
