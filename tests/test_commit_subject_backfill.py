"""Synthetic operator backfill coverage; no GitHub or provider calls."""
from copy import deepcopy
from unittest.mock import Mock
import uuid

import pytest
from sqlalchemy import select, update

from apps.api.backfill_commit_subjects import backfill_commit_subjects
from apps.api.models import ReviewSnapshot, ReviewThread, ReviewThreadStatus
from test_workspace_contract import workspace, save_snapshot  # shared isolated DB fixture


def run(session, review, client, **kwargs):
    return backfill_commit_subjects(db_session=session, settings=Mock(), github_client=client,
        review_id=review.id, owner=review.owner, repo=review.repo,
        pull_number=review.pull_number, **kwargs)


def test_dry_run_is_default_and_makes_no_requests_or_updates(workspace):
    session, review = workspace
    first = save_snapshot(session, review)
    original = deepcopy(first.snapshot_payload_json)
    client = Mock()
    result = run(session, review, client)
    assert (result.scanned, result.eligible, result.updated, result.github_requests) == (1, 1, 0, 0)
    assert first.snapshot_payload_json == original
    client.get_commit_subject.assert_not_called()


def test_backfill_preserves_all_other_snapshot_and_discussion_state_and_is_idempotent(workspace):
    session, review = workspace
    first = save_snapshot(session, review, {"sha": "head", "subject": None, "other": "preserve"})
    first.snapshot_payload_json = {**first.snapshot_payload_json, "extra": {"arbitrary": [1, 2]}}
    discussion = ReviewThread(managed_review_id=review.id, origin_snapshot_id=first.id,
        current_snapshot_id=first.id, origin_anchor_json={"cell_id": "synthetic"},
        anchor_json={"cell_id": "synthetic"}, status=ReviewThreadStatus.RESOLVED,
        created_by_github_user_id=1)
    session.add(discussion)
    session.flush()
    session.refresh(first)  # SQLite reload normalizes timezone representation.
    before = deepcopy(first.snapshot_payload_json)
    identity = (first.id, first.created_at, first.base_sha, first.head_sha, first.snapshot_index)
    client = Mock()
    client.get_commit_subject.return_value = "Actual upstream title\nCommit body"
    result = run(session, review, client, apply=True)
    session.commit()
    session.refresh(first)
    assert result.updated == 1
    assert first.snapshot_payload_json == {**before, "head_commit": {
        "sha": "head", "subject": "Actual upstream title", "other": "preserve"}}
    assert (first.id, first.created_at, first.base_sha, first.head_sha, first.snapshot_index) == identity
    session.refresh(discussion)
    assert discussion.status == ReviewThreadStatus.RESOLVED
    assert discussion.anchor_json == {"cell_id": "synthetic"}
    assert discussion.origin_snapshot_id == discussion.current_snapshot_id == first.id
    second = run(session, review, client, apply=True)
    assert second.updated == second.github_requests == 0
    assert second.unchanged == 1
    client.get_commit_subject.assert_called_once()


def test_valid_subjects_are_not_overwritten_and_duplicate_sha_uses_one_request(workspace):
    session, review = workspace
    saved = save_snapshot(session, review, {"sha": "saved", "subject": "Keep existing"}, sha="saved")
    save_snapshot(session, review, sha="missing", index=2)
    save_snapshot(session, review, sha="missing", index=3)
    client = Mock()
    client.get_commit_subject.return_value = "Fetched title"
    result = run(session, review, client, apply=True)
    assert (result.unchanged, result.updated, result.github_requests) == (1, 2, 1)
    assert saved.snapshot_payload_json["head_commit"]["subject"] == "Keep existing"
    assert client.get_commit_subject.call_args.kwargs["sha"] == "missing"
    assert client.get_commit_subject.call_args.kwargs["repository"] == "example/notebooks"
    assert client.get_commit_subject.call_args.kwargs["installation_id"] == 12


def test_failure_leaves_original_json_untouched_and_later_run_retries(workspace):
    session, review = workspace
    first = save_snapshot(session, review)
    original = deepcopy(first.snapshot_payload_json)
    client = Mock()
    client.get_commit_subject.side_effect = RuntimeError("SYNTHETIC_PRIVATE_UPSTREAM")
    failed = run(session, review, client, apply=True)
    assert failed.unavailable == 1 and failed.updated == 0
    assert first.snapshot_payload_json == original
    client.get_commit_subject.side_effect = None
    client.get_commit_subject.return_value = "Recovered title"
    assert run(session, review, client, apply=True).updated == 1
    assert client.get_commit_subject.call_count == 2


@pytest.mark.parametrize("field", ["owner", "repo", "pull_number", "review_id"])
def test_requires_exact_review_and_repository_scope(workspace, field):
    session, review = workspace
    save_snapshot(session, review)
    args = dict(review_id=review.id, owner=review.owner, repo=review.repo, pull_number=review.pull_number)
    args[field] = uuid.uuid4() if field == "review_id" else 99 if field == "pull_number" else "other"
    client = Mock()
    with pytest.raises(ValueError, match="explicit selector"):
        backfill_commit_subjects(db_session=session, settings=Mock(), github_client=client, apply=True, **args)
    client.get_commit_subject.assert_not_called()


def test_inactive_repository_refused_and_bounds_enforced(workspace):
    session, review = workspace
    for limit in (0, 51):
        with pytest.raises(ValueError, match="bounds"):
            run(session, review, Mock(), limit=limit, apply=True)
    review.installation_repository.active = False
    with pytest.raises(ValueError, match="Active review"):
        run(session, review, Mock(), apply=True)


def test_bounded_batch_and_cursor_do_not_touch_remaining_snapshots(workspace):
    session, review = workspace
    for index in range(1, 4):
        save_snapshot(session, review, sha=f"head{index}", index=index)
    client = Mock()
    client.get_commit_subject.return_value = "Real subject"
    first = run(session, review, client, limit=1, apply=True)
    assert first.updated == first.github_requests == 1
    assert first.next_after_snapshot_index == 1
    second = run(session, review, client, limit=1, after_snapshot_index=1, apply=True)
    assert second.next_after_snapshot_index == 2
    last = session.scalars(select(ReviewSnapshot).where(ReviewSnapshot.snapshot_index == 3)).one()
    assert "head_commit" not in last.snapshot_payload_json


def test_compare_and_swap_preserves_a_concurrent_winner(workspace):
    session, review = workspace
    first = save_snapshot(session, review)
    concurrent = {**first.snapshot_payload_json, "head_commit": {"sha": "head", "subject": "Concurrent title"}, "new": "preserve"}
    def lookup(**kwargs):
        # Interleave a separate writer's SQL between our read and CAS; no row
        # lock held during HTTP. Deterministic conflict test, not a load test.
        session.execute(update(ReviewSnapshot).where(ReviewSnapshot.id == first.id)
            .values(snapshot_payload_json=concurrent).execution_options(synchronize_session=False))
        return "Do not overwrite concurrent title"
    client = Mock()
    client.get_commit_subject.side_effect = lookup
    result = run(session, review, client, apply=True)
    session.refresh(first)
    assert result.updated == 0 and result.conflicted == 1
    assert first.snapshot_payload_json == concurrent


def test_deleted_or_changed_head_is_not_overwritten(workspace):
    session, review = workspace
    first = save_snapshot(session, review)
    def lookup(**kwargs):
        session.execute(update(ReviewSnapshot).where(ReviewSnapshot.id == first.id)
            .values(head_sha="new-head").execution_options(synchronize_session=False))
        return "Old head title"
    client = Mock()
    client.get_commit_subject.side_effect = lookup
    assert run(session, review, client, apply=True).conflicted == 1
    session.refresh(first)
    assert first.head_sha == "new-head" and "head_commit" not in first.snapshot_payload_json


def test_malformed_payload_is_not_replaced(workspace):
    session, review = workspace
    first = save_snapshot(session, review)
    first.snapshot_payload_json = ["legacy malformed"]
    session.flush()
    client = Mock()
    result = run(session, review, client, apply=True)
    assert result.malformed == 1 and result.updated == 0
    assert first.snapshot_payload_json == ["legacy malformed"]
    client.get_commit_subject.assert_not_called()


def test_all_remote_reads_finish_before_first_database_update(workspace):
    session, review = workspace
    save_snapshot(session, review, sha="one")
    save_snapshot(session, review, sha="two", index=2)
    def lookup(**kwargs):
        payloads = session.scalars(select(ReviewSnapshot.snapshot_payload_json)).all()
        assert all("head_commit" not in payload for payload in payloads)
        return "Actual subject"
    client = Mock()
    client.get_commit_subject.side_effect = lookup
    result = run(session, review, client, apply=True)
    assert result.updated == result.github_requests == 2


def test_repository_deactivated_during_lookup_cannot_be_updated(workspace):
    session, review = workspace
    first = save_snapshot(session, review)
    from apps.api.models import InstallationRepository
    def lookup(**kwargs):
        session.execute(update(InstallationRepository).where(InstallationRepository.id == review.installation_repository_id)
            .values(active=False).execution_options(synchronize_session=False))
        return "Actual subject"
    client = Mock()
    client.get_commit_subject.side_effect = lookup
    result = run(session, review, client, apply=True)
    assert result.conflicted == 1 and result.updated == 0
    session.refresh(first)
    assert "head_commit" not in first.snapshot_payload_json
