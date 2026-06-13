"""Per-tenant SuccessFactors career-site config.

Each entry maps a Hunter portal key to the company's SuccessFactors career site.
Adding another SuccessFactors employer (e.g. HCLTech) is just another row here —
the login + applied-status logic in ``client.py`` is tenant-agnostic.
"""

from __future__ import annotations

# portal_key -> tenant config
SF_TENANTS: dict[str, dict] = {
    "wipro": {
        "label": "Wipro",
        "host": "career55.sapsf.eu",
        "company_id": "wiprolimitP2",
        "careers_url": "https://career55.sapsf.eu/careers?company=wiprolimitP2",
    },
    "hcltech": {
        "label": "HCLTech",
        # careers.hcltech.com (Career Site Builder) is backed by the shared EU DC;
        # hcm55.sapsf.eu redirects to career55.sapsf.eu, so use the canonical host.
        "host": "career55.sapsf.eu",
        "company_id": "HCLPRD",
        "careers_url": "https://career55.sapsf.eu/careers?company=HCLPRD",
    },
    "capgemini": {
        "label": "Capgemini",
        "host": "career5.successfactors.eu",
        "company_id": "capgemitecP3",
        "careers_url": "https://career5.successfactors.eu/careers?company=capgemitecP3",
    },
}


def get_tenant(portal_key: str) -> dict | None:
    return SF_TENANTS.get(portal_key)


def is_sf_portal(portal_key: str) -> bool:
    return portal_key in SF_TENANTS
