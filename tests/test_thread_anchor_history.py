"""Durable placements retain discussions through every push, including drift."""

from copy import deepcopy
import importlib

from alembic.migration import MigrationContext
from alembic.operations import Operations
import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session

from apps.api.models import (
    Base, GitHubInstallation, InstallationAccountType, InstallationRepository,
    ManagedReview, ReviewSnapshot, ReviewSnapshotStatus, ReviewThread,
    ReviewThreadStatus, ThreadSnapshotAnchor,
)
from apps.api.review_workspace import (
    carry_forward_open_threads, get_workspace_payload,
    list_visible_threads_for_snapshot,
)


def anchor(index=1):
    return {"notebook_path": "review.ipynb", "block_kind": "source",
            "source_fingerprint": "unchanged-source", "cell_type": "code",
            "cell_locator": {"cell_id": "stable", "base_index": index,
                             "head_index": index, "display_index": index}}


@pytest.fixture
def workspace():
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    with Session(engine) as session:
        installation = GitHubInstallation(github_installation_id=12, account_login="personal",
                                           account_type=InstallationAccountType.ORGANIZATION)
        repository = InstallationRepository(installation=installation, owner="personal",
                                            name="test", full_name="personal/test")
        review = ManagedReview(installation_repository=repository, owner="personal", repo="test",
                               pull_number=1, base_branch="main", latest_base_sha="base",
                               latest_head_sha="head")
        session.add(review)
        session.flush()
        yield session, review
    engine.dispose()


def snapshot(session, review, index, anchors):
    result = ReviewSnapshot(managed_review_id=review.id, snapshot_index=index,
                            base_sha=f"base{index}", head_sha=f"head{index}", schema_version=1,
                            status=ReviewSnapshotStatus.READY,
                            snapshot_payload_json={"review": {"notebooks": [{"render_rows": [
                                {"thread_anchors": {"source": item}} for item in anchors
                            ]}]}})
    session.add(result)
    session.flush()
    review.latest_snapshot_id = result.id
    return result


def thread(session, review, origin, status=ReviewThreadStatus.OPEN):
    result = ReviewThread(managed_review_id=review.id, origin_snapshot_id=origin.id,
                          current_snapshot_id=origin.id, origin_anchor_json=anchor(),
                          anchor_json=anchor(), status=status, created_by_github_user_id=1)
    session.add(result)
    session.flush()
    return result


@pytest.mark.parametrize("status", list(ReviewThreadStatus))
def test_every_forward_push_retains_unmatched_threads_and_resolution(workspace, status):
    session, review = workspace
    first = snapshot(session, review, 1, [anchor()])
    discussion = thread(session, review, first, status)
    original = deepcopy(discussion.origin_anchor_json)
    for index in (2, 3, 4):
        current = snapshot(session, review, index, [])
        carry_forward_open_threads(db_session=session, review=review, snapshot=current)
        session.flush()
        assert discussion.current_snapshot_id == current.id
        assert discussion.status == (ReviewThreadStatus.RESOLVED if status == ReviewThreadStatus.RESOLVED
                                     else ReviewThreadStatus.OUTDATED)
    for index in (1, 2, 3, 4):
        payload = get_workspace_payload(db_session=session, review=review, snapshot_index=index)
        assert len(payload["threads"]) == 1
        assert payload["threads"][0]["anchor"] == original
        assert payload["threads"][0]["anchor_drifted"] is (index != 1)
    assert discussion.origin_anchor_json == original
    assert len(discussion.snapshot_anchors) == 4


def test_intermediate_placements_are_immutable_and_no_visibility_before_creation(workspace):
    session, review = workspace
    before = snapshot(session, review, 1, [anchor()])
    origin = snapshot(session, review, 2, [anchor()])
    discussion = thread(session, review, origin)
    for index in (3, 4):
        current = snapshot(session, review, index, [anchor(index)])
        carry_forward_open_threads(db_session=session, review=review, snapshot=current)
    carry_forward_open_threads(db_session=session, review=review, snapshot=before)
    session.flush()
    assert list_visible_threads_for_snapshot(db_session=session, snapshot_id=before.id) == []
    for index, expected in ((2, anchor()), (3, anchor(3)), (4, anchor(4))):
        payload = get_workspace_payload(db_session=session, review=review, snapshot_index=index)
        assert payload["threads"][0]["anchor"] == expected
        assert payload["threads"][0]["anchor_drifted"] is False
    assert discussion.current_snapshot_id == current.id
    assert discussion.origin_anchor_json == anchor()
    carry_forward_open_threads(db_session=session, review=review, snapshot=current)
    assert len(discussion.snapshot_anchors) == 3


def test_duplicate_matching_rows_are_explicitly_drifted(workspace):
    session, review = workspace
    first = snapshot(session, review, 1, [anchor()])
    discussion = thread(session, review, first)
    ambiguous = snapshot(session, review, 2, [anchor(2), anchor(3)])
    carry_forward_open_threads(db_session=session, review=review, snapshot=ambiguous)
    payload = get_workspace_payload(db_session=session, review=review)
    assert payload["threads"][0]["anchor_drifted"] is True
    assert discussion.anchor_json == anchor()
    assert discussion.status == ReviewThreadStatus.OUTDATED


def test_legacy_outdated_current_is_last_good_placement_not_failed_push(workspace):
    session, review = workspace
    first = snapshot(session, review, 1, [anchor()])
    last_good = snapshot(session, review, 2, [anchor(2)])
    failed = snapshot(session, review, 3, [])
    discussion = thread(session, review, first, ReviewThreadStatus.OUTDATED)
    discussion.current_snapshot_id = last_good.id
    discussion.anchor_json = anchor(2)
    carry_forward_open_threads(db_session=session, review=review, snapshot=failed)
    old = get_workspace_payload(db_session=session, review=review, snapshot_index=2)
    new = get_workspace_payload(db_session=session, review=review, snapshot_index=3)
    assert old["threads"][0]["anchor"] == anchor(2)
    assert old["threads"][0]["anchor_drifted"] is False
    assert new["threads"][0]["anchor_drifted"] is True


def test_migration_backfills_only_known_endpoints_and_cascades(workspace):
    session, review = workspace
    first = snapshot(session, review, 1, [anchor()])
    middle = snapshot(session, review, 2, [])
    last = snapshot(session, review, 3, [anchor(3)])
    discussion = thread(session, review, first, ReviewThreadStatus.OUTDATED)
    discussion.current_snapshot_id = last.id
    discussion.anchor_json = anchor(3)
    same_snapshot = thread(session, review, first)
    session.flush()
    connection = session.connection()
    ThreadSnapshotAnchor.__table__.drop(connection)
    migration = importlib.import_module(
        "apps.api.alembic.versions.20260913_0007_add_thread_snapshot_anchors")
    with Operations.context(MigrationContext.configure(connection)):
        migration.upgrade()
    rows = session.scalars(select(ThreadSnapshotAnchor)).all()
    assert len(rows) == 3
    assert not any(row.snapshot_id == middle.id for row in rows)
    by_snapshot = {row.snapshot_id: row for row in rows if row.thread_id == discussion.id}
    assert by_snapshot[first.id].anchor_json == anchor()
    assert by_snapshot[first.id].anchor_drifted is False
    assert by_snapshot[last.id].anchor_json == anchor(3)
    assert by_snapshot[last.id].anchor_drifted is False
    # Raw deletes prove database cascades, not just ORM cascades.
    session.execute(ReviewThread.__table__.delete().where(ReviewThread.id == same_snapshot.id))
    assert len(session.scalars(select(ThreadSnapshotAnchor)).all()) == 2
    session.execute(ReviewSnapshot.__table__.delete().where(ReviewSnapshot.id == last.id))
    assert session.scalars(select(ThreadSnapshotAnchor)).all() == []
    with Operations.context(MigrationContext.configure(connection)):
        migration.downgrade()
        migration.upgrade()
