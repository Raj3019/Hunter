# Feature Spec 16 — Deployment (AWS EC2 + Production Config)

## What This Is

Deploy the full stack — FastAPI backend, React frontend, and Playwright chromium — to a single AWS EC2 t2.micro instance with an Elastic IP. The Elastic IP is not optional: Naukri sessions are IP-bound and will invalidate if the server IP ever changes. This spec covers server setup, process management with systemd, nginx as a reverse proxy, and production environment hardening.

## Prerequisites

- All previous specs complete and tested locally
- AWS account with an EC2 t2.micro instance (Ubuntu 22.04 LTS)
- An Elastic IP allocated and associated with the instance
- A domain or subdomain pointed to the Elastic IP (optional but recommended for HTTPS)
- SSH access to the instance

---

## Implementation Steps

### Step 1 — Launch and Configure EC2

**In AWS Console:**

1. Launch EC2 → Ubuntu 22.04 LTS → t2.micro (free tier)
2. Security Group inbound rules:
   ```
   SSH     TCP  22     Your IP only (not 0.0.0.0/0)
   HTTP    TCP  80     0.0.0.0/0
   HTTPS   TCP  443    0.0.0.0/0
   Custom  TCP  8000   0.0.0.0/0  (temporary — remove after nginx setup)
   ```
3. Allocate an Elastic IP → Associate with instance
4. Note the Elastic IP — this is your permanent server IP

**Initial server setup:**

```bash
# SSH in
ssh -i your-key.pem ubuntu@<ELASTIC_IP>

# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y python3.11 python3.11-venv python3-pip nginx git curl

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install Playwright system dependencies
sudo apt install -y \
  libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
  libcups2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2

# Create application directory
sudo mkdir -p /opt/hunter
sudo chown ubuntu:ubuntu /opt/hunter
```

---

### Step 2 — Deploy Backend

```bash
# On server
cd /opt/hunter
git clone <your-repo-url> .  # or use scp/rsync

# Create venv
cd backend
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
playwright install chromium

# Create .env from template
cp .env.example .env
nano .env  # fill all required values
```

**Production `.env` values to set:**

```bash
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
ENCRYPTION_KEY=<generated once — same as dev key if restoring existing encrypted passwords>
ANTHROPIC_API_KEY=...
FRONTEND_URL=https://yourdomain.com   # or http://<ELASTIC_IP>:3000 for IP-only
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=whatsapp:+14155238886
RESEND_API_KEY=...
EMAIL_FROM=noreply@yourdomain.com
```

**Test backend starts:**

```bash
cd /opt/hunter/backend
source venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8000
# Should print: Application startup complete
# Ctrl+C to stop
```

---

### Step 3 — Deploy Frontend

```bash
cd /opt/hunter/frontend

# Set production API URL
echo "REACT_APP_API_URL=https://yourdomain.com" > .env.production
# or for IP-only: echo "REACT_APP_API_URL=http://<ELASTIC_IP>" > .env.production

npm install
npm run build
# Output: build/ directory with static files
```

---

### Step 4 — systemd Service for Backend

Create `/etc/systemd/system/hunter-backend.service`:

```ini
[Unit]
Description=Hunter Job Automation Backend
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/hunter/backend
Environment=PATH=/opt/hunter/backend/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=/opt/hunter/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable hunter-backend
sudo systemctl start hunter-backend
sudo systemctl status hunter-backend  # should show "active (running)"

# View logs
sudo journalctl -u hunter-backend -f
```

---

### Step 5 — nginx Reverse Proxy + Static Files

Install and configure nginx:

```bash
sudo nano /etc/nginx/sites-available/hunter
```

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;  # or _ for IP-only

    # Serve React build (static files)
    root /opt/hunter/frontend/build;
    index index.html;

    # SPA routing — all unknown paths serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API calls to FastAPI
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;  # long timeout for apply operations
        proxy_connect_timeout 60s;
        client_max_body_size 15M;  # for resume upload
    }

    # Proxy docs
    location /docs {
        proxy_pass http://127.0.0.1:8000;
    }
    location /openapi.json {
        proxy_pass http://127.0.0.1:8000;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/hunter /etc/nginx/sites-enabled/
sudo nginx -t  # test config
sudo systemctl enable nginx
sudo systemctl start nginx
```

---

### Step 6 — HTTPS with Let's Encrypt (if you have a domain)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
# Follow prompts — certbot auto-renews via cron
```

---

### Step 7 — Chrome Profiles on Production

The Chrome profiles must exist on the production server for Playwright to work. Options:

**Option A (recommended for personal use)**: Run the browser session setup scripts directly on the server via SSH with X11 forwarding:

```bash
# On your local machine
ssh -X ubuntu@<ELASTIC_IP>

# On server (inside X11-forwarded session)
cd /opt/hunter/backend
source venv/bin/activate
python portals/internshala/setup_browser_session.py
python portals/linkedin/setup_session.py
```

**Option B**: Log into the portals on your local machine, then `scp` the Chrome profile directories to the server:

```bash
scp -r ./chrome_profiles/linkedin ubuntu@<ELASTIC_IP>:/opt/hunter/backend/chrome_profiles/
```

---

### Step 8 — Deployment Update Script

Create `/opt/hunter/deploy.sh`:

```bash
#!/bin/bash
set -e

echo "=== Hunter Deploy ==="

# Pull latest code
cd /opt/hunter
git pull origin main

# Update backend
cd /opt/hunter/backend
source venv/bin/activate
pip install -r requirements.txt --quiet

# Update frontend
cd /opt/hunter/frontend
npm install --quiet
npm run build

# Restart backend
sudo systemctl restart hunter-backend
sudo systemctl status hunter-backend --no-pager

echo "=== Deploy complete ==="
```

```bash
chmod +x /opt/hunter/deploy.sh
```

---

### Step 9 — Monitoring and Maintenance

```bash
# Check backend is running
sudo systemctl status hunter-backend

# View recent logs
sudo journalctl -u hunter-backend -n 50

# Follow logs in real time
sudo journalctl -u hunter-backend -f

# Check disk space (Playwright chromium is ~300MB)
df -h

# Check memory usage (t2.micro has 1GB RAM)
free -h

# Check nginx error log
sudo tail -f /var/log/nginx/error.log
```

**Set up log rotation** to prevent disk fill:

```bash
sudo nano /etc/logrotate.d/hunter-backend
```

```
/var/log/hunter/*.log {
    daily
    rotate 7
    compress
    missingok
    notifempty
}
```

---

## Testing

### Smoke Tests After Deploy

```bash
# 1. Health check
curl http://yourdomain.com/health
# Expected: {"status":"ok"}

# 2. API accessible
curl http://yourdomain.com/api/portals/status
# Expected: {"detail":"Invalid auth header"} — 401, which is correct

# 3. Frontend loads
curl -I http://yourdomain.com
# Expected: HTTP 200 with Content-Type: text/html

# 4. Static files served
curl -I http://yourdomain.com/static/js/main.*.js
# Expected: HTTP 200

# 5. Scheduler check
sudo journalctl -u hunter-backend | grep "Scheduler started"
# Expected: Log line confirming scheduler started

# 6. Manual fetch trigger (requires auth)
TOKEN=$(curl -s -X POST http://yourdomain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@email.com","password":"yourpassword"}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -X POST http://yourdomain.com/api/admin/trigger-fetch \
  -H "Authorization: Bearer $TOKEN"
```

---

## Expected Success Behaviour

- `GET /health` returns `{"status": "ok"}`
- Frontend loads at `http://yourdomain.com` without any static file 404 errors
- Login works and returns a JWT
- Resume upload (multipart POST) succeeds — nginx `client_max_body_size 15M` allows it
- Scheduler fires at 8am IST and logs `"Daily fetch started"`
- `systemctl status hunter-backend` shows `active (running)` after a server reboot
- HTTPS redirect works if Let's Encrypt is configured

## Expected Failure Behaviour

| Failure | Cause | Fix |
|---|---|---|
| `502 Bad Gateway` from nginx | Backend not running | `sudo systemctl start hunter-backend`; check logs |
| `413 Request Entity Too Large` on resume upload | nginx `client_max_body_size` too small | Increase to `15M` in nginx config |
| CORS error in browser | `FRONTEND_URL` in `.env` doesn't match actual domain | Update `.env` and restart backend |
| Playwright fails on server | Missing system libraries | Re-run `playwright install chromium` in venv; install missing apt packages |
| Naukri session invalidates daily | IP changed (Elastic IP not set) | Confirm Elastic IP is associated; confirm backend binds to `0.0.0.0` |
| `502` on apply endpoints (timeout) | Apply takes >60s and nginx times out | Increase `proxy_read_timeout 300s` in nginx config |
| Disk full | Playwright chromium + Chrome profiles | Use a larger instance or add EBS volume; clean old Chrome profiles |

## Challenges

- **1GB RAM on t2.micro is tight**: FastAPI + Playwright chromium + Python = easily 600–800MB. Running multiple concurrent Playwright sessions may OOM the instance. Monitor RAM usage. If it becomes an issue, upgrade to t3.small (2GB RAM, still cheap).
- **Playwright on Linux without a display**: Playwright's headless mode works fine. For `headless=False` apply flows (required for LinkedIn), you need a virtual display. Install `Xvfb`: `sudo apt install xvfb`. Run Playwright with `DISPLAY=:99 xvfb-run python ...` or configure Xvfb as a systemd service. Alternatively, accept `headless=True` for production and only use `headless=False` during setup on your local machine.
- **Chrome profile setup on server**: The browser login sessions (`chrome_profiles/linkedin/`, etc.) must be set up on the production server, not just locally. Use X11 forwarding (`ssh -X`) or transfer profiles via `scp`. Once set up, they persist until the EC2 instance is terminated or the volume is wiped.
- **Deployment downtime**: `systemctl restart hunter-backend` causes ~5 seconds of downtime. For zero-downtime, use `--workers 2` with uvicorn + graceful reload. For MVP, brief restart is acceptable.
- **`.env` security**: The `.env` file on the server contains all secrets. Set file permissions: `chmod 600 /opt/hunter/backend/.env`. Never expose the server's `.env` in git or logs.
- **Backup the ENCRYPTION_KEY**: If the server dies and `ENCRYPTION_KEY` is lost, all encrypted company portal passwords become permanently unreadable. Store the key in AWS Secrets Manager or at minimum write it down in a secure offline location.
