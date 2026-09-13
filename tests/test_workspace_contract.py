"""Shared serializer fixture and bounded, optional version-label enrichment."""
from datetime import datetime, timezone
import json
from pathlib import Path
from types import SimpleNamespace
import uuid
from unittest.mock import Mock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from apps.api.managed_github import ManagedGitHubClient, ManagedGitHubClientError
from apps.api.models import (
    Base, GitHubInstallation, GitHubMirrorState, InstallationAccountType,
    InstallationRepository, ManagedReview, ReviewSnapshot, ReviewSnapshotStatus,
    ReviewThread, ReviewThreadStatus,
)
from apps.api.orchestration import _head_commit_metadata
from apps.api.review_workspace import get_workspace_payload, serialize_thread, _snapshot_commit_subject


def test_shared_frontend_fixture_is_actual_serialized_thread():
    fixture = json.loads((Path(__file__).parent / "fixtures/serialized_thread.json").read_text())
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    thread = ReviewThread(
        id=uuid.UUID(fixture["id"]), managed_review_id=uuid.UUID(fixture["managed_review_id"]),
        origin_snapshot_id=uuid.UUID(fixture["origin_snapshot_id"]),
        current_snapshot_id=uuid.UUID(fixture["current_snapshot_id"]),
        anchor_json=fixture["anchor"], origin_anchor_json=fixture["anchor"],
        status=ReviewThreadStatus.RESOLVED, carried_forward=False,
        created_by_github_user_id=1, created_at=now, updated_at=now,
        resolved_at=now, resolved_by_github_user_id=1,
        github_mirror_state=GitHubMirrorState.MIRRORED,
        github_root_comment_id=123,
        github_root_comment_url=fixture["github_mirror"]["root_comment_url"],
        github_last_mirrored_at=now,
        github_mirror_metadata_json={"mode": "app", "target": "review_comment", "last_action": "resolved"},
        messages=[], snapshot_anchors=[],
    )
    assert serialize_thread(thread) == fixture


@pytest.fixture
def workspace():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        installation = GitHubInstallation(github_installation_id=12, account_login="example",
                                          account_type=InstallationAccountType.ORGANIZATION)
        repository = InstallationRepository(installation=installation, owner="example",
                                            name="notebooks", full_name="example/notebooks")
        review = ManagedReview(installation_repository=repository, owner="example", repo="notebooks",
                               pull_number=1, base_branch="main", latest_base_sha="base", latest_head_sha="head")
        session.add(review)
        session.flush()
        yield session, review
    engine.dispose()


def save_snapshot(session, review, metadata=None, sha="head", index=1):
    snapshot = ReviewSnapshot(managed_review_id=review.id, base_sha="base", head_sha=sha,
                              snapshot_index=index, schema_version=1, status=ReviewSnapshotStatus.READY,
                              snapshot_payload_json={"review": {"notebooks": [], "notices": []},
                                                     **({"head_commit": metadata} if metadata is not None else {})})
    session.add(snapshot)
    session.flush()
    return snapshot


def test_subject_cached_per_repository_and_sha_and_old_history_stays_null(workspace):
    session, review = workspace
    client = Mock()
    client.get_commit_subject.return_value = "Explain the changed output\n\nLong body"
    old = save_snapshot(session, review)
    args = dict(db_session=session, review=review, github_client=client, settings=Mock(), sha="head")
    metadata = _head_commit_metadata(**args)
    assert metadata == {"sha": "head", "subject": "Explain the changed output"}
    client.get_commit_subject.assert_called_once()
    save_snapshot(session, review, metadata, index=2)
    assert _head_commit_metadata(**args) == metadata
    assert client.get_commit_subject.call_count == 1
    history = get_workspace_payload(db_session=session, review=review)["review"]["snapshot_history"]
    assert history[0]["head_commit_subject"] is None
    assert history[1]["head_commit_subject"] == metadata["subject"]
    assert "head_commit" not in old.snapshot_payload_json  # no GET/backfill mutation
    _head_commit_metadata(**{**args, "sha": "different"})
    assert client.get_commit_subject.call_count == 2
    other_repository = InstallationRepository(installation=review.installation_repository.installation,
        owner="example", name="other", full_name="example/other")
    other = ManagedReview(installation_repository=other_repository, owner="example", repo="other",
        pull_number=1, base_branch="main", latest_base_sha="base", latest_head_sha="head")
    session.add(other)
    session.flush()
    _head_commit_metadata(**{**args, "review": other})
    assert client.get_commit_subject.call_count == 3


def test_subject_enrichment_failure_is_optional_and_cached(workspace):
    session, review = workspace
    client = Mock()
    client.get_commit_subject.side_effect = ManagedGitHubClientError("upstream failed", status_code=503)
    args = dict(db_session=session, review=review, github_client=client, settings=Mock(), sha="head")
    metadata = _head_commit_metadata(**args)
    assert metadata == {"sha": "head", "subject": None}
    save_snapshot(session, review, metadata)
    assert _head_commit_metadata(**args) == metadata
    assert client.get_commit_subject.call_count == 1


@pytest.mark.parametrize("payload", [None, [], {}, {"head_commit": []},
    {"head_commit": {"sha": "wrong", "subject": "Wrong commit"}},
    {"head_commit": {"sha": "head", "subject": 3}}])
def test_legacy_or_malformed_metadata_has_no_invented_subject(payload):
    assert _snapshot_commit_subject(SimpleNamespace(snapshot_payload_json=payload, head_sha="head")) is None


def test_cached_subject_is_bounded_and_plain_text(workspace):
    session, review = workspace
    save_snapshot(session, review, {"sha": "head", "subject": "<b>" + "x" * 600 + "\nbody"})
    client = Mock()
    result = _head_commit_metadata(db_session=session, review=review, github_client=client, settings=Mock(), sha="head")
    assert result["subject"] == "<b>" + "x" * 497
    client.get_commit_subject.assert_not_called()


@pytest.mark.parametrize("payload,expected", [
    ({"sha": "abc", "commit": {"message": "Actual subject\nbody"}}, "Actual subject"),
    ({"sha": "abc", "commit": {"message": "x" * 600}}, "x" * 500),
    ({"sha": "other", "commit": {"message": "Wrong commit"}}, None),
    ({"sha": "abc", "commit": {"message": []}}, None),
])
def test_commit_lookup_exact_sha_authenticated_single_request(payload, expected):
    session = Mock()
    session.request.return_value = SimpleNamespace(status_code=200, json=lambda: payload)
    app_client = Mock()
    app_client.create_installation_access_token.return_value = SimpleNamespace(token="synthetic-token")
    client = ManagedGitHubClient(app_client=app_client, session=session)
    assert client.get_commit_subject(settings=Mock(), installation_id=12, repository="example/notebooks", sha="abc") == expected
    session.request.assert_called_once()
    request = session.request.call_args.kwargs
    assert request["method"] == "GET"
    assert request["url"].endswith("/repos/example/notebooks/commits/abc")
    assert request["headers"]["Authorization"] == "Bearer synthetic-token"
    assert request["timeout"] == 30
