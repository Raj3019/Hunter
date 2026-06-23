"""Outbound reachability check: can THIS server reach the job portals?

Run this ON the server (the fresh EC2 box) to confirm network egress to each
portal works, before worrying about credentials or scraping logic.

    cd backend
    python test_portal_reachability.py

What the result means:
  * Any HTTP status back (200 / 301 / 403 / 503 ...) => the server REACHED the
    portal. The network path is fine. A 403/503 just means the portal's edge
    (Cloudflare/Akamai) answered — that's a credentials/anti-bot concern, not a
    connectivity one.
  * DNS / Connection / Timeout error => the server could NOT reach the portal.
    That's a real egress problem: security group, NACL, no NAT/route, or DNS.

No login credentials are needed — these are plain GETs to public URLs.
"""

import socket
import time
from urllib.parse import urlparse

import requests

# (label, url) — base host plus one representative endpoint per portal.
TARGETS = [
    ("Naukri (home)", "https://www.naukri.com/"),
    ("Naukri (job search API)", "https://www.naukri.com/jobapi/v3/search"),
    ("Foundit (home)", "https://www.foundit.in/"),
    ("Internshala (home)", "https://internshala.com/"),
    ("Internshala (login page)", "https://internshala.com/login/user"),
]

# A realistic UA so the portal edge behaves like it would for the real clients.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/json,*/*",
}

TIMEOUT = 15  # seconds


def check_dns(host: str) -> str:
    """Resolve a hostname so DNS failures are reported separately from connect failures."""
    try:
        ip = socket.gethostbyname(host)
        return f"DNS ok -> {ip}"
    except socket.gaierror as exc:
        return f"DNS FAILED ({exc})"


def main() -> None:
    print("=== Portal reachability check (server -> portals) ===\n")

    reached = 0
    seen_hosts = set()

    for label, url in TARGETS:
        host = urlparse(url).hostname or ""
        if host not in seen_hosts:
            print(f"[dns] {host}: {check_dns(host)}")
            seen_hosts.add(host)

        start = time.monotonic()
        try:
            resp = requests.get(
                url,
                headers=HEADERS,
                timeout=TIMEOUT,
                allow_redirects=True,
            )
            elapsed_ms = (time.monotonic() - start) * 1000
            reached += 1
            print(
                f"[REACHED] {label:<28} HTTP {resp.status_code} "
                f"in {elapsed_ms:6.0f} ms  ({url})"
            )
        except requests.exceptions.Timeout:
            print(f"[TIMEOUT] {label:<28} no response in {TIMEOUT}s  ({url})")
        except requests.exceptions.ConnectionError as exc:
            print(f"[NO REACH] {label:<28} connection error: {exc}  ({url})")
        except requests.exceptions.RequestException as exc:
            print(f"[ERROR]   {label:<28} {exc}  ({url})")

    print(f"\n{reached}/{len(TARGETS)} endpoints reached the portal edge.")
    if reached == len(TARGETS):
        print("Network egress to all portals looks good.")
    elif reached == 0:
        print("Server could NOT reach any portal — check egress (security group / NAT / DNS).")
    else:
        print("Partial reach — inspect the failing lines above.")


if __name__ == "__main__":
    main()
