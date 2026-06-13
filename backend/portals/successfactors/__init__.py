"""SAP SuccessFactors career-portal integration (auto-detect applied status).

Many large Indian employers run their candidate careers site on SAP
SuccessFactors (e.g. Wipro on ``career55.sapsf.eu``). Unlike Naukri/Foundit there
is no clean JSON API, but the login is plain email+password (no CAPTCHA/OTP) and
the candidate's submitted applications are returned by the
``rcmV12CandidateProfileController.getCandidateProfileVO`` DWR call that fires on
login. We log in headless, capture that response, and read the applied jobs.

One handler covers every SuccessFactors tenant — only the per-company config
(career site URL + company id) differs. See ``config.py``.
"""
