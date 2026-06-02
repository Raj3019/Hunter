from playwright.async_api import async_playwright

PROFILE_DIR = "./chrome_profiles/internshala"


async def internshala_apply(
    job_url: str,
    cover_letter: str,
    availability: str = "Immediately",
    profile_dir: str = PROFILE_DIR,
) -> dict:
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=profile_dir,
            headless=False,
        )
        page = await browser.new_page()

        try:
            await page.goto(job_url)
            await page.wait_for_timeout(2000)

            already_applied = await page.query_selector("button:has-text('Applied'), .applied-badge")
            if already_applied:
                await browser.close()
                return {"success": False, "reason": "Already applied to this listing"}

            apply_btn = await page.query_selector(
                "button#apply_button, a.apply_now, button:has-text('Apply Now'), "
                "button:has-text('Apply')"
            )
            if not apply_btn:
                await browser.close()
                return {"success": False, "reason": "No apply button found"}

            await apply_btn.click()
            await page.wait_for_timeout(2000)

            cover_field = await page.query_selector(
                "textarea#cover_letter, textarea[name='cover_letter'], "
                "textarea[placeholder*='cover'], textarea[placeholder*='Cover']"
            )
            if cover_field:
                await cover_field.fill(cover_letter)
                await page.wait_for_timeout(500)

            avail_field = await page.query_selector(
                "input[name='availability'], input[placeholder*='availability']"
            )
            if avail_field:
                await avail_field.fill(availability)

            submit_btn = await page.query_selector(
                "button#submit, button[type='submit'], button:has-text('Submit Application')"
            )
            if not submit_btn:
                await browser.close()
                return {"success": False, "reason": "No submit button found"}

            await submit_btn.click()
            await page.wait_for_timeout(3000)

            success_indicator = await page.query_selector(
                ".success-message, .thank-you, h1:has-text('Thank'), "
                "p:has-text('successfully applied')"
            )

            await browser.close()

            if success_indicator:
                return {"success": True}
            return {"success": False, "reason": "Submit clicked but no success confirmation found"}

        except Exception as e:
            await browser.close()
            return {"success": False, "reason": str(e)}
