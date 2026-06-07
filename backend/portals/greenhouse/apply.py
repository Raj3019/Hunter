import logging

from playwright.async_api import async_playwright

from portals.naukri.jobs import Job

try:
    from ai.qa_answerer import answer_question
except ImportError:
    async def answer_question(question: str, user_profile: dict) -> str:
        return str(user_profile.get(question) or user_profile.get("default_answer") or "")


PROFILE_DIR = "./chrome_profiles/greenhouse"
logger = logging.getLogger(__name__)


async def greenhouse_apply(
    job: Job,
    resume_path: str,
    user_profile: dict,
    cover_letter: str = "",
) -> dict:
    """
    Apply to a Greenhouse job using the standardized Greenhouse application form.
    """
    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=False,
            viewport={"width": 1280, "height": 900},
        )
        page = await browser.new_page()

        try:
            await page.goto(job.apply_link, wait_until="domcontentloaded")
            await page.wait_for_timeout(2000)

            apply_btn = await page.query_selector(
                "a:has-text('Apply for this job'), "
                "button:has-text('Apply for this job'), "
                "a:has-text('Apply Now'), "
                "#apply_button, "
                ".apply-button"
            )

            if apply_btn:
                await apply_btn.click()
                await page.wait_for_timeout(2000)

            name_parts = user_profile.get("name", "").split()
            await _fill_if_empty(page, "input#first_name", name_parts[0] if name_parts else "")

            last_name = " ".join(user_profile.get("name", "Unknown").split()[1:]) or "."
            await _fill_if_empty(page, "input#last_name", last_name)
            await _fill_if_empty(page, "input#email", user_profile.get("email", ""))
            await _fill_if_empty(page, "input#phone", user_profile.get("phone", ""))
            await _fill_if_empty(page, "input#job_application_location", user_profile.get("location", ""))

            await _fill_if_empty(
                page,
                "input[name*='linkedin'], input[placeholder*='LinkedIn']",
                user_profile.get("linkedin_url", ""),
            )
            await _fill_if_empty(
                page,
                "input[name*='github'], input[placeholder*='GitHub']",
                user_profile.get("github_url", ""),
            )
            await _fill_if_empty(
                page,
                "input[name*='website'], input[name*='portfolio']",
                user_profile.get("github_url", ""),
            )

            resume_input = await page.query_selector(
                "input[type='file'][name*='resume'], input[type='file']#resume"
            )
            if resume_input:
                await resume_input.set_input_files(resume_path)
                await page.wait_for_timeout(1500)
                logger.info("[Greenhouse] Resume uploaded for %s", job.title)

            cover_textarea = await page.query_selector(
                "textarea#cover_letter, textarea[name*='cover_letter']"
            )
            if cover_textarea and cover_letter:
                await cover_textarea.fill(cover_letter)

            await _handle_custom_questions(page, user_profile)

            submit_btn = await page.query_selector(
                "input[type='submit']#submit_app, "
                "button[type='submit']:has-text('Submit Application'), "
                "button[type='submit']:has-text('Submit')"
            )

            if not submit_btn:
                external_url = page.url
                await browser.close()
                return {
                    "success": False,
                    "external_pending": True,
                    "apply_method": "external",
                    "reason": "No supported Greenhouse submit button was found. Complete this job manually on the company site.",
                    "external_apply_url": external_url,
                }

            await submit_btn.click()
            await page.wait_for_timeout(4000)

            success_el = await page.query_selector(
                ".application-confirmation, "
                "h1:has-text('Application submitted'), "
                "h2:has-text('Thank you'), "
                "p:has-text('successfully submitted')"
            )
            final_url = page.url

            await browser.close()

            if success_el:
                return {"success": True}
            if "confirmation" in final_url or "thank" in final_url.lower():
                return {"success": True}
            return {
                "success": False,
                "external_pending": True,
                "apply_method": "external",
                "reason": "Submit clicked but no confirmation was detected. Confirm the application manually on the company site.",
                "external_apply_url": final_url,
            }

        except Exception as e:
            try:
                await browser.close()
            except Exception:
                pass
            logger.error("[Greenhouse] Apply error for %s: %s", job.title, e)
            return {"success": False, "reason": str(e)}


async def _fill_if_empty(page, selector: str, value: str):
    """Fill a field only if it is currently empty and value is non-empty."""
    if not value:
        return
    try:
        el = await page.query_selector(selector)
        if el:
            current = await el.input_value()
            if not current:
                await el.fill(value)
                await page.wait_for_timeout(200)
    except Exception:
        pass


async def _handle_custom_questions(page, user_profile: dict):
    """Handle company-specific questions in the standard Greenhouse DOM."""
    question_blocks = await page.query_selector_all(".field, .question")

    for block in question_blocks:
        try:
            label_el = await block.query_selector("label")
            label_text = (await label_el.inner_text()).strip() if label_el else ""

            if not label_text:
                continue

            text_inp = await block.query_selector("input[type='text'], input[type='number']")
            if text_inp:
                val = await text_inp.input_value()
                if not val:
                    answer = await answer_question(label_text, user_profile)
                    if answer:
                        await text_inp.fill(answer)
                        await page.wait_for_timeout(250)
                continue

            textarea = await block.query_selector("textarea")
            if textarea:
                val = await textarea.input_value()
                if not val:
                    answer = await answer_question(label_text, user_profile)
                    if answer:
                        await textarea.fill(answer)
                continue

            select = await block.query_selector("select")
            if select:
                val = await select.input_value()
                if not val:
                    options = await select.query_selector_all("option")
                    if len(options) > 1:
                        answer = await answer_question(label_text, user_profile)
                        matched = False
                        for opt in options[1:]:
                            opt_text = await opt.inner_text()
                            if answer.lower() in opt_text.lower():
                                await select.select_option(label=opt_text)
                                matched = True
                                break
                        if not matched:
                            await select.select_option(index=1)
                continue

            radios = await block.query_selector_all("input[type='radio']")
            if radios:
                answer = await answer_question(label_text, user_profile)
                for radio in radios:
                    radio_label = await radio.get_attribute("value") or ""
                    if answer.lower() in radio_label.lower() or radio_label.lower() in answer.lower():
                        await radio.click()
                        break

        except Exception:
            continue
