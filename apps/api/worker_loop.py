"""Importable managed-service worker loop.

This module wires together the three existing worker entrypoints
(snapshot builds, GitHub mirror sync, notification delivery) into a single
loop that the deployed container shell entrypoint can invoke directly. A
notification delivery failure (misconfiguration, transient outage) must
never prevent snapshot processing or GitHub mirror sync from making
progress, so notification delivery is isolated behind its own exception
handling within each iteration.
"""

from __future__ import annotations

from dataclasses import dataclass
import logging
import os
import time
from typing import Callable

from .config import ApiSettings
from .managed_github import ManagedGitHubClient
from .notification_delivery import NotificationDeliveryResult, ResendEmailClient
from .orchestration import LiteLLMGatewayClient, SnapshotBuildResult
from .worker import (
    GitHubMirrorResult,
    process_github_mirror_job_once,
    process_notification_delivery_once,
    process_snapshot_build_job_once,
)


logger = logging.getLogger(__name__)

DEFAULT_WORKER_POLL_INTERVAL_SECONDS = 5.0
DEFAULT_WORKER_NOTIFICATION_BATCH_SIZE = 25


@dataclass(frozen=True)
class WorkerIterationResult:
    """Combined outcome of processing one queue slice from each worker."""

    snapshot_result: SnapshotBuildResult
    mirror_result: GitHubMirrorResult
    notification_result: NotificationDeliveryResult | None
    notification_error: str | None

    @property
    def is_idle(self) -> bool:
        """True when none of the three queues produced any work this pass."""
        notification_idle = (
            self.notification_result is None or self.notification_result.processed == 0
        )
        return (
            self.snapshot_result.status == "idle"
            and self.mirror_result.status == "idle"
            and notification_idle
        )


def run_worker_iteration(
    *,
    settings: ApiSettings | None = None,
    github_client: ManagedGitHubClient | None = None,
    litellm_client: LiteLLMGatewayClient | None = None,
    email_client: ResendEmailClient | None = None,
    notification_limit: int = DEFAULT_WORKER_NOTIFICATION_BATCH_SIZE,
    snapshot_worker: Callable[..., SnapshotBuildResult] = process_snapshot_build_job_once,
    mirror_worker: Callable[..., GitHubMirrorResult] = process_github_mirror_job_once,
    notification_worker: Callable[..., NotificationDeliveryResult] = process_notification_delivery_once,
) -> WorkerIterationResult:
    """Process one slice of the snapshot, mirror and notification queues.

    Each worker call claims at most one pending job. ``snapshot_worker`` and
    ``mirror_worker`` entrypoints already report failures as part of their
    result objects, so exceptions from those two are allowed to propagate.
    ``notification_worker`` is wrapped separately: any exception it raises
    (configuration errors, transport outages) is captured and reported
    without ever preventing the mirror queue above it from having already
    run in this same iteration.
    """
    snapshot_result = snapshot_worker(
        settings=settings,
        github_client=github_client,
        litellm_client=litellm_client,
    )
    mirror_result = mirror_worker(
        settings=settings,
        github_client=github_client,
    )

    notification_result: NotificationDeliveryResult | None
    notification_error: str | None
    try:
        notification_result = notification_worker(
            settings=settings,
            email_client=email_client,
            limit=notification_limit,
        )
        notification_error = None
    except Exception as exc:  # noqa: BLE001 - must not starve mirror/snapshot queues
        notification_result = None
        notification_error = _format_worker_exception(exc)
        logger.warning(
            "Notification delivery failed for this worker iteration: %s",
            notification_error,
        )

    return WorkerIterationResult(
        snapshot_result=snapshot_result,
        mirror_result=mirror_result,
        notification_result=notification_result,
        notification_error=notification_error,
    )


def _format_worker_exception(exc: BaseException) -> str:
    # Exception messages (especially SQL errors) can contain bound user data,
    # access tokens or provider response bodies. Log classification only.
    return exc.__class__.__name__


def main() -> None:
    """Run the managed-service worker loop until the process is terminated.

    Env configuration matches the previous deployed shell heredoc:
    ``WORKER_POLL_INTERVAL_SECONDS`` and ``WORKER_NOTIFICATION_BATCH_SIZE``.
    """
    poll_interval = float(
        os.environ.get("WORKER_POLL_INTERVAL_SECONDS", str(DEFAULT_WORKER_POLL_INTERVAL_SECONDS))
    )
    notification_batch_size = int(
        os.environ.get(
            "WORKER_NOTIFICATION_BATCH_SIZE", str(DEFAULT_WORKER_NOTIFICATION_BATCH_SIZE)
        )
    )
    github_client = ManagedGitHubClient()

    while True:
        result = run_worker_iteration(
            github_client=github_client,
            notification_limit=notification_batch_size,
        )
        if result.is_idle:
            time.sleep(poll_interval)


__all__ = [
    "DEFAULT_WORKER_NOTIFICATION_BATCH_SIZE",
    "DEFAULT_WORKER_POLL_INTERVAL_SECONDS",
    "WorkerIterationResult",
    "main",
    "run_worker_iteration",
]


if __name__ == "__main__":
    main()
