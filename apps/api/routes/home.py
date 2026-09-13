"""Authenticated, access-filtered entry points for the repository homepage."""

from __future__ import annotations

import base64
import binascii
import re
from typing import Any
from urllib.parse import quote
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db_session
from ..models import InstallationRepository, ManagedReview
from ..oauth import GitHubOAuthClient, OAuthStateError
from .auth import AuthenticatedUser, get_oauth_client, require_authenticated_user


router = APIRouter(prefix="/api", tags=["homepage"])
MAX_REPOSITORIES_PER_PAGE = 20
REVIEWS_PER_REPOSITORY = 5


def _encode_cursor(repository_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(repository_id.bytes).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> uuid.UUID:
    if not re.fullmatch(r"[A-Za-z0-9_-]{22}", cursor):
        raise HTTPException(status_code=400, detail="Invalid repository cursor")
    try:
        result = uuid.UUID(bytes=base64.urlsafe_b64decode(cursor + "=="))
        if _encode_cursor(result) != cursor:
            raise ValueError("Non-canonical cursor")
        return result
    except (ValueError, binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="Invalid repository cursor") from exc


@router.get("/session")
def get_current_session(
    response: Response,
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
) -> dict[str, Any]:
    """Return identity only after validating the stored session and expiration."""
    response.headers["Cache-Control"] = "no-store"
    return {"user": {"id": current_user.github_user_id, "login": current_user.github_login}}


@router.get("/repositories")
def list_accessible_repositories(
    response: Response,
    cursor: str | None = Query(default=None, max_length=22),
    limit: int = Query(default=10, ge=1, le=MAX_REPOSITORIES_PER_PAGE),
    current_user: AuthenticatedUser = Depends(require_authenticated_user),
    db_session: Session = Depends(get_db_session),
    oauth_client: GitHubOAuthClient = Depends(get_oauth_client),
) -> dict[str, Any]:
    """Scan one bounded page, omitting denied repositories before serialization.

    The cursor encodes only a database UUID, never a private repository name.
    It advances over scanned candidates, not just allowed repositories, so an
    empty page can still have a continuation. Checks are fresh, not drawn from
    the repository-access cache used by other workspace routes.
    """
    response.headers["Cache-Control"] = "no-store"
    query = select(InstallationRepository).where(InstallationRepository.active.is_(True))
    if cursor is not None:
        query = query.where(InstallationRepository.id > _decode_cursor(cursor))
    candidates = db_session.scalars(query.order_by(InstallationRepository.id).limit(limit + 1)).all()
    scanned = candidates[:limit]
    items: list[dict[str, Any]] = []
    for repository in scanned:
        try:
            allowed = oauth_client.can_access_repository(
                current_user.access_token, owner=repository.owner, repo=repository.name,
            )
        except (requests.RequestException, OAuthStateError) as exc:
            # Do not reflect provider bodies, tokens, or denied repository names.
            raise HTTPException(status_code=502, detail="Unable to verify repository access. Please retry.") from exc
        if not allowed:
            continue
        reviews = db_session.scalars(
            select(ManagedReview)
            .where(ManagedReview.installation_repository_id == repository.id)
            .order_by(ManagedReview.updated_at.desc(), ManagedReview.id)
            .limit(REVIEWS_PER_REPOSITORY)
        ).all()
        items.append({
            "id": str(repository.id), "owner": repository.owner, "name": repository.name,
            "full_name": repository.full_name,
            "reviews": [{
                "id": str(review.id), "pull_number": review.pull_number, "status": review.status.value,
                "href": f"/reviews/{quote(repository.owner, safe='')}/{quote(repository.name, safe='')}/pulls/{review.pull_number}",
            } for review in reviews],
        })
    return {
        "repositories": items,
        "next_cursor": _encode_cursor(scanned[-1].id) if len(candidates) > limit else None,
    }
