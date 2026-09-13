from __future__ import annotations

from apps.api.notification_delivery import NotificationDeliveryError, NotificationDeliveryResult
from apps.api.orchestration import SnapshotBuildResult
from apps.api.worker import GitHubMirrorResult
from apps.api.worker_loop import WorkerIterationResult, run_worker_iteration


def idle_snapshot_result() -> SnapshotBuildResult:
    return SnapshotBuildResult(
        status="idle",
        job_id=None,
        managed_review_id=None,
        snapshot_id=None,
        snapshot_index=None,
        check_run_id=None,
    )


def busy_snapshot_result() -> SnapshotBuildResult:
    return SnapshotBuildResult(
        status="built",
        job_id="snapshot-job",
        managed_review_id="review-1",
        snapshot_id="snapshot-1",
        snapshot_index=1,
        check_run_id=99,
    )


def idle_mirror_result() -> GitHubMirrorResult:
    return GitHubMirrorResult(
        status="idle",
        job_id=None,
        managed_review_id=None,
        thread_id=None,
        action=None,
    )


def sent_mirror_result() -> GitHubMirrorResult:
    return GitHubMirrorResult(
        status="sent",
        job_id="mirror-job",
        managed_review_id="review-1",
        thread_id="thread-1",
        action="create_thread",
    )


class RecordingWorker:
    """Callable stub that records the keyword arguments it was invoked with."""

    def __init__(self, result=None, *, raises: Exception | None = None):
        self.result = result
        self.raises = raises
        self.calls: list[dict] = []

    def __call__(self, **kwargs):
        self.calls.append(kwargs)
        if self.raises is not None:
            raise self.raises
        return self.result


def test_run_worker_iteration_processes_all_three_queues_in_one_pass() -> None:
    snapshot_worker = RecordingWorker(busy_snapshot_result())
    mirror_worker = RecordingWorker(sent_mirror_result())
    notification_worker = RecordingWorker(
        NotificationDeliveryResult(processed=2, sent=2, failed=0)
    )

    result = run_worker_iteration(
        settings="fake-settings",
        github_client="fake-github-client",
        notification_limit=10,
        snapshot_worker=snapshot_worker,
        mirror_worker=mirror_worker,
        notification_worker=notification_worker,
    )

    assert result == WorkerIterationResult(
        snapshot_result=busy_snapshot_result(),
        mirror_result=sent_mirror_result(),
        notification_result=NotificationDeliveryResult(processed=2, sent=2, failed=0),
        notification_error=None,
    )
    assert result.is_idle is False

    # Each worker is invoked with the shared settings/github_client so no
    # queue-specific configuration is silently dropped.
    assert snapshot_worker.calls == [
        {"settings": "fake-settings", "github_client": "fake-github-client", "litellm_client": None}
    ]
    assert mirror_worker.calls == [
        {"settings": "fake-settings", "github_client": "fake-github-client"}
    ]
    assert notification_worker.calls == [
        {"settings": "fake-settings", "email_client": None, "limit": 10}
    ]


def test_run_worker_iteration_is_idle_when_all_three_queues_report_no_work() -> None:
    result = run_worker_iteration(
        snapshot_worker=RecordingWorker(idle_snapshot_result()),
        mirror_worker=RecordingWorker(idle_mirror_result()),
        notification_worker=RecordingWorker(
            NotificationDeliveryResult(processed=0, sent=0, failed=0)
        ),
    )

    assert result.is_idle is True


def test_notification_failure_does_not_prevent_mirror_processing() -> None:
    """A raised notification error must not starve the mirror queue.

    The mirror worker is called and returns its own result within the same
    iteration regardless of whether notification delivery later fails.
    """
    mirror_worker = RecordingWorker(sent_mirror_result())
    notification_worker = RecordingWorker(
        raises=NotificationDeliveryError("Resend email send failed with status 500")
    )

    result = run_worker_iteration(
        snapshot_worker=RecordingWorker(idle_snapshot_result()),
        mirror_worker=mirror_worker,
        notification_worker=notification_worker,
    )

    assert mirror_worker.calls  # mirror queue still ran this iteration
    assert result.mirror_result == sent_mirror_result()
    assert result.notification_result is None
    assert result.notification_error == "NotificationDeliveryError"
    # A failed-but-handled notification pass still counts as having done
    # something, so the loop should not report this iteration as idle.
    assert result.is_idle is False


def test_notification_failure_is_reported_as_idle_when_other_queues_are_empty() -> None:
    result = run_worker_iteration(
        snapshot_worker=RecordingWorker(idle_snapshot_result()),
        mirror_worker=RecordingWorker(idle_mirror_result()),
        notification_worker=RecordingWorker(raises=RuntimeError("boom")),
    )

    assert result.notification_result is None
    assert result.notification_error == "RuntimeError"
    assert result.is_idle is True


def test_notification_failure_does_not_log_private_exception_details(caplog) -> None:
    private_marker = "synthetic-private-payload-never-log"
    result = run_worker_iteration(
        snapshot_worker=RecordingWorker(idle_snapshot_result()),
        mirror_worker=RecordingWorker(idle_mirror_result()),
        notification_worker=RecordingWorker(raises=RuntimeError(private_marker)),
    )
    assert result.notification_error == "RuntimeError"
    assert "RuntimeError" in caplog.text
    assert private_marker not in caplog.text


def test_run_worker_iteration_propagates_unhandled_mirror_worker_errors() -> None:
    """Snapshot/mirror workers already report their own failures as results,
    so an unexpected exception from them is not swallowed silently."""
    try:
        run_worker_iteration(
            snapshot_worker=RecordingWorker(idle_snapshot_result()),
            mirror_worker=RecordingWorker(raises=RuntimeError("mirror exploded")),
            notification_worker=RecordingWorker(
                NotificationDeliveryResult(processed=0, sent=0, failed=0)
            ),
        )
    except RuntimeError as exc:
        assert str(exc) == "mirror exploded"
    else:
        raise AssertionError("expected RuntimeError to propagate from the mirror worker")
