# Feature Spec 15 — Notifications (WhatsApp + Email)

## What This Is

Two notification channels: WhatsApp via Twilio for urgent real-time alerts (token expiry, interview detected), and email via Resend for summaries and confirmations. Both are triggered by the scheduler and by portal apply results. Notifications are optional — the app works without them, but they dramatically improve user awareness.

## Prerequisites

- `12-scheduler.md` complete
- Twilio account with WhatsApp sandbox enabled (free) or production number
- Resend account with a verified sender domain
- `backend/notifications/` directory

## Environment Variables Needed

```
TWILIO_ACCOUNT_SID=ACxxx
TWILIO_AUTH_TOKEN=xxx
TWILIO_FROM_NUMBER=whatsapp:+14155238886   # Twilio sandbox number
USER_WHATSAPP=whatsapp:+91XXXXXXXXXX       # user's WhatsApp number

RESEND_API_KEY=re_xxx
EMAIL_FROM=noreply@yourdomain.com
```

---

## Implementation Steps

### Step 1 — `backend/notifications/whatsapp.py`

```python
from twilio.rest import Client
from core.config import (
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
    TWILIO_FROM_NUMBER
)
import logging
import os

logger = logging.getLogger(__name__)

def _get_client():
    return Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

def send_whatsapp(to_number: str, message: str) -> bool:
    """
    Send a WhatsApp message via Twilio.
    to_number format: 'whatsapp:+91XXXXXXXXXX'
    Returns True on success, False on failure.
    """
    try:
        client = _get_client()
        msg = client.messages.create(
            from_=TWILIO_FROM_NUMBER,
            to=to_number,
            body=message
        )
        logger.info(f"WhatsApp sent: SID={msg.sid} to={to_number}")
        return True
    except Exception as e:
        logger.error(f"WhatsApp send failed to {to_number}: {e}")
        return False


# ---- Notification templates ----

def notify_token_expired(to_number: str, portal: str) -> bool:
    return send_whatsapp(
        to_number,
        f"⚠️ Hunter Alert: Your {portal.capitalize()} token has expired.\n"
        f"Please reconnect {portal.capitalize()} in the Settings page to resume job fetching."
    )

def notify_daily_summary(to_number: str, match_count: int, portals_fetched: list) -> bool:
    portals_str = ", ".join(portals_fetched) if portals_fetched else "no portals"
    return send_whatsapp(
        to_number,
        f"🔍 Hunter Daily Summary\n"
        f"Found {match_count} new job matches today (score ≥ 60)\n"
        f"Portals: {portals_str}\n"
        f"Open the Dashboard to review and approve."
    )

def notify_apply_success(to_number: str, job_title: str, company: str, portal: str) -> bool:
    return send_whatsapp(
        to_number,
        f"✅ Applied!\n"
        f"Job: {job_title}\n"
        f"Company: {company}\n"
        f"Portal: {portal.capitalize()}"
    )

def notify_apply_failed(to_number: str, job_title: str, reason: str) -> bool:
    return send_whatsapp(
        to_number,
        f"❌ Apply Failed\n"
        f"Job: {job_title}\n"
        f"Reason: {reason}\n"
        f"Check the Tracker for details."
    )

def notify_interview_detected(to_number: str, company: str) -> bool:
    return send_whatsapp(
        to_number,
        f"🎉 Interview Detected!\n"
        f"It looks like {company} may have viewed or responded to your application.\n"
        f"Check your email and update the Tracker."
    )
```

---

### Step 2 — `backend/notifications/email.py`

```python
import resend
import logging
from core.config import RESEND_API_KEY, EMAIL_FROM

logger = logging.getLogger(__name__)
resend.api_key = RESEND_API_KEY


def send_email(to: str, subject: str, html: str) -> bool:
    try:
        response = resend.Emails.send({
            "from": EMAIL_FROM,
            "to": [to],
            "subject": subject,
            "html": html,
        })
        logger.info(f"Email sent: id={response.get('id')} to={to}")
        return True
    except Exception as e:
        logger.error(f"Email send failed to {to}: {e}")
        return False


def send_daily_digest(to: str, matches: list) -> bool:
    if not matches:
        return False

    rows = "".join([
        f"""<tr>
          <td style="padding:8px;border-bottom:1px solid #2a2a2a;">{m.get('match_score')}%</td>
          <td style="padding:8px;border-bottom:1px solid #2a2a2a;">{m.get('jobs', {}).get('title', '')}</td>
          <td style="padding:8px;border-bottom:1px solid #2a2a2a;">{m.get('jobs', {}).get('company', '')}</td>
          <td style="padding:8px;border-bottom:1px solid #2a2a2a;">{m.get('jobs', {}).get('portal', '')}</td>
        </tr>"""
        for m in matches[:10]
    ])

    html = f"""
    <div style="background:#0d0d0d;color:#f0f0f0;font-family:sans-serif;padding:24px;max-width:640px;">
      <h2 style="color:#6366f1;margin-bottom:16px;">🔍 Hunter — Daily Job Matches</h2>
      <p style="color:#6b7280;">Here are your top {len(matches)} matches from today's search:</p>
      <table style="width:100%;border-collapse:collapse;margin-top:16px;">
        <thead>
          <tr style="background:#161616;">
            <th style="padding:8px;text-align:left;color:#6b7280;font-size:12px;">SCORE</th>
            <th style="padding:8px;text-align:left;color:#6b7280;font-size:12px;">TITLE</th>
            <th style="padding:8px;text-align:left;color:#6b7280;font-size:12px;">COMPANY</th>
            <th style="padding:8px;text-align:left;color:#6b7280;font-size:12px;">PORTAL</th>
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
      <div style="margin-top:24px;">
        <a href="http://your-app-url/dashboard"
           style="background:#6366f1;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;">
          Open Dashboard
        </a>
      </div>
      <p style="color:#6b7280;font-size:12px;margin-top:24px;">
        Hunter — Job Automation by Apex36 Technologies
      </p>
    </div>
    """
    return send_email(to, f"Hunter: {len(matches)} new job matches today", html)


def send_application_confirmation(to: str, job_title: str, company: str) -> bool:
    html = f"""
    <div style="background:#0d0d0d;color:#f0f0f0;font-family:sans-serif;padding:24px;max-width:640px;">
      <h2 style="color:#22c55e;">✅ Application Submitted</h2>
      <p>Hunter successfully applied to:</p>
      <h3 style="color:#f0f0f0;">{job_title}</h3>
      <p style="color:#6b7280;">{company}</p>
      <p style="color:#6b7280;margin-top:16px;">
        Track this application in your <a href="http://your-app-url/tracker" style="color:#6366f1;">Tracker</a>.
      </p>
    </div>
    """
    return send_email(to, f"Applied: {job_title} at {company}", html)
```

---

### Step 3 — Wire Notifications Into Scheduler

In `backend/scheduler/daily_fetch.py`, after scoring is done for a user:

```python
from notifications.whatsapp import notify_daily_summary, notify_token_expired
from notifications.email import send_daily_digest

# After saving matches for a user:
if saved_count > 0:
    # Load user's WhatsApp number and email
    profile = db.table("profiles").select("email, phone").eq("id", user_id).maybe_single().execute()
    if profile.data:
        # WhatsApp summary
        if profile.data.get("phone"):
            notify_daily_summary(
                to_number=f"whatsapp:+91{profile.data['phone'].lstrip('0')}",
                match_count=saved_count,
                portals_fetched=list(tokens.keys())
            )
        # Email digest
        if profile.data.get("email"):
            matches_for_email = db.table("job_matches").select(
                "match_score, jobs(title, company, portal)"
            ).eq("user_id", user_id).order("match_score", desc=True).limit(10).execute()
            send_daily_digest(profile.data["email"], matches_for_email.data or [])
```

Wire apply result notifications in `api/routes/jobs.py` inside `_run_manual_apply()`:

```python
from notifications.whatsapp import notify_apply_success, notify_apply_failed

profile = db.table("profiles").select("email, phone").eq("id", user_id).maybe_single().execute()
user_phone = profile.data.get("phone") if profile.data else None
user_email = profile.data.get("email") if profile.data else None

if result.get("success"):
    if user_phone:
        notify_apply_success(
            f"whatsapp:+91{user_phone.lstrip('0')}",
            job.title, job.company, job.portal
        )
    if user_email:
        send_application_confirmation(user_email, job.title, job.company)
else:
    if user_phone:
        notify_apply_failed(
            f"whatsapp:+91{user_phone.lstrip('0')}",
            job.title, result.get("reason", "Unknown error")
        )
```

---

### Step 4 — Test Script

```python
# backend/test_notifications.py
from notifications.whatsapp import send_whatsapp, notify_daily_summary, notify_token_expired
from notifications.email import send_email, send_daily_digest
from dotenv import load_dotenv
import os

load_dotenv()

def main():
    print("=== Notification Tests ===")
    test_number = os.getenv("USER_WHATSAPP")
    test_email = os.getenv("TEST_EMAIL", "apex36office@gmail.com")

    # 1. Basic WhatsApp
    if test_number:
        result = send_whatsapp(test_number, "Hunter test message — ignore this.")
        print(f"[{'PASS' if result else 'FAIL'}] WhatsApp basic send")

        result2 = notify_daily_summary(test_number, match_count=7, portals_fetched=["naukri", "foundit"])
        print(f"[{'PASS' if result2 else 'FAIL'}] WhatsApp daily summary")

        result3 = notify_token_expired(test_number, "naukri")
        print(f"[{'PASS' if result3 else 'FAIL'}] WhatsApp token expired alert")
    else:
        print("[SKIP] WhatsApp — USER_WHATSAPP not set")

    # 2. Basic email
    sample_matches = [
        {"match_score": 87, "jobs": {"title": "React Developer", "company": "Razorpay", "portal": "naukri"}},
        {"match_score": 74, "jobs": {"title": "Frontend Engineer", "company": "Zepto", "portal": "foundit"}},
    ]
    result = send_daily_digest(test_email, sample_matches)
    print(f"[{'PASS' if result else 'FAIL'}] Email daily digest")

    result2 = send_email(
        test_email,
        "Hunter Test Email",
        "<p style='color:white;background:#0d0d0d;padding:16px;'>This is a test email from Hunter.</p>"
    )
    print(f"[{'PASS' if result2 else 'FAIL'}] Email basic send")

    print("\n=== Notification tests complete ===")

main()
```

---

## Expected Success Behaviour

- `send_whatsapp()` returns `True` and the WhatsApp message arrives within 30 seconds
- Daily summary WhatsApp message shows the correct match count and portal names
- `send_daily_digest()` returns `True` and email arrives with the correct job table
- After a successful apply, WhatsApp notification and email confirmation are sent
- Token expiry notification triggers when the scheduler detects a 401 from a portal

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| WhatsApp `AuthenticationError` | Wrong `TWILIO_ACCOUNT_SID` or `TWILIO_AUTH_TOKEN` | Verify in Twilio console → Account → API Keys |
| WhatsApp message not received | Number not joined Twilio sandbox | User must WhatsApp `join <sandbox-keyword>` to the sandbox number first |
| WhatsApp `invalid number` | Number format wrong | Format must be `whatsapp:+91XXXXXXXXXX` — no spaces, no dashes |
| Email `authentication_error` | Wrong `RESEND_API_KEY` | Check Resend dashboard → API Keys |
| Email lands in spam | `EMAIL_FROM` domain not verified with DKIM | Add Resend's DNS records to your domain in your domain registrar |
| Emails not sent in production | `REACT_APP_API_URL` pointing to wrong server | Verify env var; check notification calls are reaching production backend |

## Challenges

- **Twilio Sandbox vs Production**: The Twilio WhatsApp sandbox is free but requires the user to first send a join message to the sandbox number. For production, you need a Twilio WhatsApp Business API number (approval required, takes 1–2 weeks). Start with sandbox for development.
- **Phone number format**: Indian mobile numbers must be formatted as `whatsapp:+91XXXXXXXXXX`. Store the user's phone number without the country code in the DB (`profiles.phone`) and add `+91` at notification time. Handle numbers that already start with `+91` or `0` — strip the prefix before adding.
- **Notification fatigue**: If the user applies 20 jobs a day, they get 20 WhatsApp messages. Add a preference: "Notify me — Per apply / Daily summary only / Never." Default to daily summary only. Send per-apply only for failed applications.
- **Resend domain requirement**: Resend requires a verified domain for the `from:` email address. If you don't have a domain, use their Resend testing domain for development (`onboarding@resend.dev`) but this won't work in production.
- **Silent notification failures**: Notification failures should never crash the main flow. Always wrap notification calls in `try/except` and log — a failed WhatsApp message is not a critical error.
