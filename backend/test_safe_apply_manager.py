from datetime import datetime
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from portals.base import (
    PORTAL_DELAYS,
    PORTAL_LIMITS,
    SAFE_HOUR_END,
    SAFE_HOUR_START,
    SafeApplyManager,
    _format_safe_hour,
    run_safe_apply_for_user,
)
from portals.naukri.jobs import Job

IST = ZoneInfo("Asia/Kolkata")


def _manager() -> SafeApplyManager:
    with patch("portals.base.get_db", return_value=MagicMock()):
        return SafeApplyManager()


def _sample_job() -> Job:
    return Job(
        job_id="job-123",
        title="Backend Developer",
        company="Example Co",
        location="Bangalore",
        experience="1-3 years",
        salary="Not disclosed",
        posted_date="today",
        apply_link="https://example.com/jobs/job-123",
        description="Python backend role",
        portal="naukri",
    )


def test_portal_limits_defined():
    for portal in ["naukri", "foundit", "linkedin", "workday", "internshala"]:
        assert portal in PORTAL_LIMITS, f"Missing limit for {portal}"
        assert portal in PORTAL_DELAYS, f"Missing delay for {portal}"
        assert PORTAL_LIMITS[portal] > 0
        min_d, max_d = PORTAL_DELAYS[portal]
        assert max_d > min_d > 0
    print("[PASS] All portal limits and delays defined")


def test_time_window():
    assert SAFE_HOUR_START < SAFE_HOUR_END
    assert 0 <= SAFE_HOUR_START <= 23
    assert 1 <= SAFE_HOUR_END <= 24
    assert _format_safe_hour(SAFE_HOUR_START) == "9:00 AM"
    assert _format_safe_hour(SAFE_HOUR_END) == "8:00 PM"
    print(f"[PASS] Safe hours: {_format_safe_hour(SAFE_HOUR_START)} to {_format_safe_hour(SAFE_HOUR_END)} IST")


def test_can_apply_outside_hours():
    manager = _manager()
    with patch("portals.base.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2025, 1, 1, 2, 0, 0, tzinfo=IST)
        ok, reason = manager.can_apply("test_user_id", "naukri")
    assert not ok, "Should block at 2am"
    assert "safe hours" in reason.lower()
    print("[PASS] Blocked outside safe hours")


def test_can_apply_evening_before_window_end():
    manager = _manager()
    with patch("portals.base.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2025, 1, 1, 19, 39, 0, tzinfo=IST)
        with patch.object(manager, "_get_today_count", return_value=0):
            ok, reason = manager.can_apply("test_user_id", "naukri")
    assert ok
    assert reason == "ok"
    print("[PASS] Allowed evening apply before window end")


def test_can_apply_blocks_after_window_end():
    manager = _manager()
    with patch("portals.base.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2025, 1, 1, 21, 39, 0, tzinfo=IST)
        ok, reason = manager.can_apply("test_user_id", "naukri")
    assert not ok
    assert "9:00 AM-8:00 PM IST" in reason
    print("[PASS] Blocked after safe window end")


def test_can_apply_blocks_at_midnight():
    manager = _manager()
    with patch("portals.base.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2025, 1, 2, 0, 0, 0, tzinfo=IST)
        ok, reason = manager.can_apply("test_user_id", "naukri")
    assert not ok
    assert "9:00 AM-8:00 PM IST" in reason
    print("[PASS] Blocked at midnight")


def test_can_apply_daily_limit_reached():
    manager = _manager()
    with patch("portals.base.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2025, 1, 1, 10, 0, 0, tzinfo=IST)
        with patch.object(manager, "_get_today_count", return_value=PORTAL_LIMITS["naukri"]):
            ok, reason = manager.can_apply("test_user_id", "naukri")
    assert not ok, "Should block at portal daily limit"
    assert "daily limit" in reason.lower()
    print("[PASS] Blocked when daily limit reached")


def test_can_apply_inside_hours_below_limit():
    manager = _manager()
    with patch("portals.base.datetime") as mock_dt:
        mock_dt.now.return_value = datetime(2025, 1, 1, 10, 0, 0, tzinfo=IST)
        with patch.object(manager, "_get_today_count", return_value=0):
            ok, reason = manager.can_apply("test_user_id", "naukri")
    assert ok
    assert reason == "ok"
    print("[PASS] Allowed inside safe hours below daily limit")


def test_delay_is_in_range():
    manager = _manager()
    for portal in ["naukri", "linkedin", "workday"]:
        min_d, max_d = PORTAL_DELAYS[portal]
        with patch("time.sleep"):
            delay = manager.safe_delay(portal)
        assert min_d <= delay <= max_d, f"Delay {delay} outside [{min_d}, {max_d}] for {portal}"
    print("[PASS] Delays are within expected ranges")


def test_today_stats_structure():
    manager = _manager()
    with patch.object(manager, "_get_today_count", return_value=0):
        stats = manager.get_today_stats("test_user_id")
    for portal in ["naukri", "linkedin"]:
        assert portal in stats
        assert "applied" in stats[portal]
        assert "limit" in stats[portal]
        assert "remaining" in stats[portal]
        assert stats[portal]["applied"] + stats[portal]["remaining"] == stats[portal]["limit"]
    print("[PASS] Today stats structure correct")


def test_log_application_writes_expected_record():
    db = MagicMock()
    with patch("portals.base.get_db", return_value=db):
        manager = SafeApplyManager()

    with patch.object(manager, "_get_or_create_db_job_id", return_value="db-job-uuid"):
        manager.log_application("user-123", _sample_job(), {"success": True})

    inserted = db.table.return_value.insert.call_args.args[0]
    assert inserted["user_id"] == "user-123"
    assert inserted["job_id"] == "db-job-uuid"
    assert inserted["portal"] == "naukri"
    assert inserted["status"] == "applied"
    print("[PASS] Application log record structure correct")


def test_log_application_writes_external_pending_record():
    db = MagicMock()
    with patch("portals.base.get_db", return_value=db):
        manager = SafeApplyManager()

    result = {
        "success": False,
        "external_pending": True,
        "reason": "This job must be completed on the company website.",
        "external_apply_url": "https://company.example/apply",
    }
    with patch.object(manager, "_get_or_create_db_job_id", return_value="db-job-uuid"):
        manager.log_application("user-123", _sample_job(), result)

    inserted = db.table.return_value.insert.call_args.args[0]
    assert inserted["status"] == "external_pending"
    assert inserted["external_apply_url"] == "https://company.example/apply"
    assert inserted["failed_reason"] == ""
    print("[PASS] External pending application is logged without false failure/applied state")


def test_naukri_apply_response_is_success():
    manager = _manager()
    result = {
        "statusCode": 0,
        "jobs": [{
            "status": 200,
            "message": "You have successfully applied to this job.",
            "jobId": "020626919850",
        }],
    }
    assert manager._is_apply_success(result)
    assert "successfully applied" in manager._result_notes(result).lower()
    print("[PASS] Naukri apply response is treated as success")


async def test_run_safe_apply_blocks_before_callable():
    manager = _manager()
    with patch.object(manager, "can_apply", return_value=(False, "blocked for test")):
        apply_callable = MagicMock(return_value={"success": True})
        result = await run_safe_apply_for_user(
            "user-123",
            {"id": "job-123", "portal": "naukri"},
            apply_callable,
            manager=manager,
        )
    assert result["blocked"] is True
    apply_callable.assert_not_called()
    print("[PASS] Safe apply runner blocks before portal apply")


async def test_run_safe_apply_logs_updates_and_delays():
    manager = _manager()
    job = _sample_job()

    with patch.object(manager, "can_apply", return_value=(True, "ok")):
        with patch.object(manager, "log_application") as log_application:
            with patch.object(manager, "update_job_match_status") as update_status:
                with patch.object(manager, "safe_delay") as safe_delay:
                    with patch.object(manager, "_get_or_create_db_job_id", return_value="db-job-uuid"):
                        result = await run_safe_apply_for_user(
                            "user-123",
                            job,
                            lambda: {"success": True},
                            manager=manager,
                        )

    assert result["success"] is True
    log_application.assert_called_once()
    update_status.assert_called_once_with("user-123", "db-job-uuid", "applied")
    safe_delay.assert_called_once_with("naukri")
    print("[PASS] Safe apply runner logs, updates status, and delays on success")


async def test_run_safe_apply_marks_external_pending_without_delay():
    manager = _manager()
    job = _sample_job()

    with patch.object(manager, "can_apply", return_value=(True, "ok")):
        with patch.object(manager, "log_application") as log_application:
            with patch.object(manager, "update_job_match_status") as update_status:
                with patch.object(manager, "safe_delay") as safe_delay:
                    with patch.object(manager, "_get_or_create_db_job_id", return_value="db-job-uuid"):
                        result = await run_safe_apply_for_user(
                            "user-123",
                            job,
                            lambda: {"success": False, "external_pending": True},
                            manager=manager,
                        )

    assert result["external_pending"] is True
    log_application.assert_called_once()
    update_status.assert_called_once_with("user-123", "db-job-uuid", "external_pending")
    safe_delay.assert_not_called()
    print("[PASS] Safe apply runner marks external pending without success delay")


if __name__ == "__main__":
    import asyncio

    test_portal_limits_defined()
    test_time_window()
    test_can_apply_outside_hours()
    test_can_apply_evening_before_window_end()
    test_can_apply_blocks_after_window_end()
    test_can_apply_blocks_at_midnight()
    test_can_apply_daily_limit_reached()
    test_can_apply_inside_hours_below_limit()
    test_delay_is_in_range()
    test_today_stats_structure()
    test_log_application_writes_expected_record()
    test_log_application_writes_external_pending_record()
    test_naukri_apply_response_is_success()
    asyncio.run(test_run_safe_apply_blocks_before_callable())
    asyncio.run(test_run_safe_apply_logs_updates_and_delays())
    asyncio.run(test_run_safe_apply_marks_external_pending_without_delay())
    print("\n=== All SafeApplyManager tests PASSED ===")
