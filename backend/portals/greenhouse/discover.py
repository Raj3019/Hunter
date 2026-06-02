import asyncio
import sys

from portals.greenhouse.jobs import discover_company_slug


async def main():
    if len(sys.argv) < 2:
        print("Usage: python -m portals.greenhouse.discover <careers_page_url>")
        return

    url = sys.argv[1]
    slug = await discover_company_slug(url)
    if slug:
        print(f"Found Greenhouse slug: {slug}")
        print(f'Add to companies.py: "{slug}": {{"name": "Company", "slug": "{slug}"}}')
    else:
        print("No Greenhouse slug found - company may not use Greenhouse")


asyncio.run(main())
