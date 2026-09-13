"""Explicit, bounded operator backfill; no review rebuild or GitHub mutation.

Run with ``python -m apps.api.backfill_commit_subjects --help``. Default mode
only inspects the named review; --apply requires an operator-approved backup.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from dataclasses import asdict, dataclass
import json
import os
import uuid

from sqlalchemy import select, update
from sqlalchemy.orm import Session, selectinload

from .config import ApiSettings, get_settings
from .database import session_factory_for_settings
from .github_app import DEFAULT_GITHUB_API_URL
from .managed_github import ManagedGitHubClient
from .models import InstallationRepository, ManagedReview, ReviewSnapshot, ReviewSnapshotStatus


@dataclass
class BackfillResult:
    scanned: int = 0
    eligible: int = 0
    unchanged: int = 0
    updated: int = 0
    unavailable: int = 0
    conflicted: int = 0
    malformed: int = 0
    github_requests: int = 0
    next_after_snapshot_index: int | None = None


def _has_subject(payload: dict, sha: str) -> bool:
    metadata = payload.get("head_commit")
    return (
        isinstance(metadata, dict) and metadata.get("sha") == sha
        and isinstance(metadata.get("subject"), str) and bool(metadata["subject"].strip())
    )


def backfill_commit_subjects(
    *, db_session: Session, settings: ApiSettings, github_client: ManagedGitHubClient,
    review_id: uuid.UUID, owner: str, repo: str, pull_number: int,
    limit: int = 20, after_snapshot_index: int = 0, apply: bool = False,
) -> BackfillResult:
    """Modify only head_commit metadata; caller owns commit/rollback.

    At most `limit` snapshots and unique SHA requests per call. Network calls hold
    no row locks. Compare-and-swap against the original JSON prevents overwriting
    concurrent payload/title updates. Null/missing subjects are retried explicitly;
    valid stored subjects are never replaced. No snapshot/anchor timestamps change.
    """
    if not 1 <= limit <= 50 or after_snapshot_index < 0 or pull_number < 1:
        raise ValueError("Invalid batch bounds or review selector")
    review = db_session.execute(
        select(ManagedReview)
        .options(selectinload(ManagedReview.installation_repository).selectinload(InstallationRepository.installation))
        .where(ManagedReview.id == review_id, ManagedReview.owner == owner,
               ManagedReview.repo == repo, ManagedReview.pull_number == pull_number)
    ).scalar_one_or_none()
    if review is None or not review.installation_repository.active:
        raise ValueError("Active review does not match the explicit selector")
    repository = review.installation_repository
    if repository.owner != owner or repository.name != repo or repository.full_name != f"{owner}/{repo}":
        raise ValueError("Installation repository does not match the explicit selector")
    snapshots = db_session.execute(
        select(ReviewSnapshot).where(
            ReviewSnapshot.managed_review_id == review.id,
            ReviewSnapshot.snapshot_index > after_snapshot_index,
            ReviewSnapshot.status == ReviewSnapshotStatus.READY,
        ).order_by(ReviewSnapshot.snapshot_index).limit(limit)
    ).scalars().all()
    result = BackfillResult(scanned=len(snapshots))
    # Only the selected review's rows seed this in-memory SHA cache. Valid cache
    # entries can enrich a duplicate SHA without making an additional request.
    subjects = {
        snapshot.head_sha: snapshot.snapshot_payload_json["head_commit"]["subject"]
        for snapshot in snapshots
        if isinstance(snapshot.snapshot_payload_json, dict)
        and _has_subject(snapshot.snapshot_payload_json, snapshot.head_sha)
    }
    candidates = []
    for snapshot in snapshots:
        result.next_after_snapshot_index = snapshot.snapshot_index
        payload = deepcopy(snapshot.snapshot_payload_json)
        if not isinstance(payload, dict):
            result.malformed += 1
            continue
        if _has_subject(payload, snapshot.head_sha):
            result.unchanged += 1
            continue
        result.eligible += 1
        candidates.append((snapshot, payload, snapshot.head_sha))
    if not apply:
        return result
    # Complete HTTP lookups before any UPDATE: even earlier rows in this batch
    # must not remain locked while a later upstream request is in flight.
    for _, _, sha in candidates:
        if sha not in subjects:
            result.github_requests += 1
            try:
                subjects[sha] = github_client.get_commit_subject(
                    settings=settings,
                    installation_id=repository.installation.github_installation_id,
                    repository=repository.full_name, sha=sha,
                )
            except Exception:
                # Optional metadata only. Never print upstream bodies/credentials.
                subjects[sha] = None
    for snapshot, payload, sha in candidates:
        subject = subjects[sha]
        if not isinstance(subject, str) or not subject.strip():
            result.unavailable += 1
            continue
        subject = subject.splitlines()[0].strip()[:500]
        if not subject:
            result.unavailable += 1
            continue
        previous_metadata = payload.get("head_commit")
        metadata = dict(previous_metadata) if isinstance(previous_metadata, dict) else {}
        metadata.update(sha=sha, subject=subject)
        updated_payload = {**payload, "head_commit": metadata}
        changed = db_session.execute(
            update(ReviewSnapshot).where(
                ReviewSnapshot.id == snapshot.id,
                ReviewSnapshot.managed_review_id == review.id,
                ReviewSnapshot.head_sha == sha,
                ReviewSnapshot.status == ReviewSnapshotStatus.READY,
                ReviewSnapshot.snapshot_payload_json == payload,
                select(InstallationRepository.id).where(
                    InstallationRepository.id == repository.id,
                    InstallationRepository.active.is_(True),
                ).exists(),
            ).values(snapshot_payload_json=updated_payload)
            .execution_options(synchronize_session=False)
        ).rowcount
        if changed == 1:
            result.updated += 1
            db_session.expire(snapshot, ["snapshot_payload_json"])
        else:
            result.conflicted += 1
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review-id", type=uuid.UUID, required=True)
    parser.add_argument("--owner", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--pull-number", type=int, required=True)
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--after-snapshot-index", type=int, default=0)
    parser.add_argument("--apply", action="store_true", help="Write metadata only after an approved, validated backup")
    args = parser.parse_args()
    try:
        settings = get_settings()
        client = ManagedGitHubClient(api_base_url=os.environ.get("GITHUB_API_BASE_URL", DEFAULT_GITHUB_API_URL))
        with session_factory_for_settings(settings)() as session:
            result = backfill_commit_subjects(db_session=session, settings=settings, github_client=client, **vars(args))
            if args.apply:
                session.commit()
            else:
                session.rollback()
        print(json.dumps({"applied": args.apply, **asdict(result)}, sort_keys=True))
        return 0
    except Exception:
        # Aggregate-only operator output; even connection errors can carry secrets.
        print(json.dumps({"error": "Backfill failed. Check scope, configuration, database availability, and current metadata before retrying."}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
