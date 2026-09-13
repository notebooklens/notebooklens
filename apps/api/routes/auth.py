"""OAuth routes for the managed API skeleton."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from html import escape
from typing import Annotated
from urllib.parse import quote, urlencode

from fastapi import APIRouter, Cookie, Depends, HTTPException, Query, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session

from ..config import ApiSettings, get_settings
from ..database import get_db_session
from ..models import GitHubInstallation, InstallationAccountType
from ..oauth import (
    GitHubOAuthClient,
    OAuthSessionStore,
    OAuthStateError,
    OAuthStateSigner,
    SESSION_COOKIE_NAME,
    STATE_COOKIE_NAME,
    SessionTokenCipher,
)


router = APIRouter(prefix="/api/auth", tags=["auth"])


@dataclass(frozen=True)
class AuthenticatedUser:
    """Authenticated GitHub user session details for managed review routes."""

    session_id: str
    github_user_id: int
    github_login: str
    access_token: str


def get_oauth_client() -> GitHubOAuthClient:
    return GitHubOAuthClient()


def get_state_signer(settings: ApiSettings = Depends(get_settings)) -> OAuthStateSigner:
    return OAuthStateSigner(settings.session_secret)


def get_session_store(settings: ApiSettings = Depends(get_settings)) -> OAuthSessionStore:
    return OAuthSessionStore(SessionTokenCipher(settings.session_secret))


def _build_app_url(settings: ApiSettings, path: str, *, params: dict[str, str] | None = None) -> str:
    query = f"?{urlencode(params)}" if params else ""
    return f"{settings.app_base_url}{path}{query}"


def _redirect_to_auth_error(
    *,
    settings: ApiSettings,
    message: str,
    next_path: str = "/",
) -> RedirectResponse:
    return RedirectResponse(
        _build_app_url(
            settings,
            "/api/auth/github/error",
            params={"message": message, "next_path": next_path},
        ),
        status_code=302,
    )


@router.get("/github/login")
def github_login(
    next_path: str = Query(default="/"),
    settings: ApiSettings = Depends(get_settings),
    oauth_client: GitHubOAuthClient = Depends(get_oauth_client),
    signer: OAuthStateSigner = Depends(get_state_signer),
) -> RedirectResponse:
    """Start the GitHub OAuth login flow."""
    state = signer.issue_state(next_path=next_path)
    redirect_url = oauth_client.build_authorize_url(
        client_id=settings.github_oauth_client_id,
        redirect_uri=settings.github_oauth_callback_url,
        state=state,
    )
    response = RedirectResponse(redirect_url, status_code=302)
    response.set_cookie(
        STATE_COOKIE_NAME,
        state,
        max_age=600,
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )
    return response


@router.get("/github/callback")
def github_callback(
    code: Annotated[str | None, Query()] = None,
    state: Annotated[str | None, Query()] = None,
    installation_id: Annotated[int | None, Query()] = None,
    setup_action: Annotated[str | None, Query()] = None,
    settings: ApiSettings = Depends(get_settings),
    db_session: Session = Depends(get_db_session),
    oauth_client: GitHubOAuthClient = Depends(get_oauth_client),
    signer: OAuthStateSigner = Depends(get_state_signer),
    session_store: OAuthSessionStore = Depends(get_session_store),
    state_cookie: str | None = Cookie(default=None, alias=STATE_COOKIE_NAME),
) -> RedirectResponse:
    """Complete the GitHub OAuth flow and persist a user session."""
    if state is None:
        if installation_id is not None or setup_action is not None:
            redirect_params = {
                key: value
                for key, value in {
                    "code": code,
                    "installation_id": str(installation_id) if installation_id is not None else None,
                    "setup_action": setup_action,
                }.items()
                if value is not None
            }
            return RedirectResponse(
                _build_app_url(settings, "/api/github/install/callback", params=redirect_params),
                status_code=302,
            )
        return _redirect_to_auth_error(
            settings=settings,
            message="GitHub sign-in could not continue because the callback was missing its state.",
        )
    if code is None:
        return _redirect_to_auth_error(
            settings=settings,
            message="GitHub sign-in could not continue because the callback was missing its code.",
        )
    if state_cookie is None or state_cookie != state:
        return _redirect_to_auth_error(
            settings=settings,
            message="GitHub sign-in could not continue because the NotebookLens state cookie did not match.",
        )
    try:
        payload = signer.verify_state(state)
    except OAuthStateError as exc:
        return _redirect_to_auth_error(
            settings=settings,
            message=str(exc),
        )
    try:
        token = oauth_client.exchange_code(
            client_id=settings.github_oauth_client_id,
            client_secret=settings.github_oauth_client_secret,
            code=code,
            redirect_uri=settings.github_oauth_callback_url,
        )
        user = oauth_client.fetch_user(token.access_token)
    except OAuthStateError as exc:
        return _redirect_to_auth_error(
            settings=settings,
            message=str(exc),
            next_path=str(payload["next_path"]),
        )
    session_record = session_store.create_session(
        db_session,
        github_user=user,
        access_token=token.access_token,
        expires_at=token.expires_at,
    )
    db_session.commit()
    redirect_response = RedirectResponse(
        f"{settings.app_base_url}{payload['next_path']}",
        status_code=302,
    )
    redirect_response.delete_cookie(STATE_COOKIE_NAME, path="/")
    redirect_response.set_cookie(
        SESSION_COOKIE_NAME,
        str(session_record.id),
        max_age=max(0, int((token.expires_at - datetime.now(timezone.utc)).total_seconds())),
        httponly=True,
        samesite="lax",
        secure=True,
        path="/",
    )
    return redirect_response


@router.get("/github/error", response_class=HTMLResponse)
def github_auth_error_page(
    message: Annotated[str, Query()] = "NotebookLens could not complete GitHub sign-in.",
    next_path: Annotated[str, Query()] = "/",
    settings: ApiSettings = Depends(get_settings),
) -> HTMLResponse:
    """Render a simple, user-facing OAuth error page instead of a raw 500."""
    login_url = _build_app_url(
        settings,
        "/api/auth/github/login",
        params={"next_path": next_path},
    )
    body = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>NotebookLens GitHub Sign-In Error</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="font-family: sans-serif; margin: 2rem; line-height: 1.5;">
    <main style="max-width: 42rem; margin: 0 auto;">
      <p style="text-transform: uppercase; letter-spacing: 0.08em; color: #4b5563;">GitHub Sign-In Error</p>
      <h1 style="margin-top: 0.25rem;">NotebookLens could not complete GitHub sign-in</h1>
      <p>{escape(message)}</p>
      <p>
        <a href="{escape(login_url, quote=True)}">Try GitHub sign-in again</a>
        &nbsp;or&nbsp;
        <a href="{escape(settings.app_base_url, quote=True)}">return to NotebookLens</a>.
      </p>
    </main>
  </body>
</html>"""
    return HTMLResponse(content=body, status_code=400)


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    db_session: Session = Depends(get_db_session),
    session_store: OAuthSessionStore = Depends(get_session_store),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> Response:
    """Delete the current NotebookLens user session cookie and DB record."""
    if session_cookie:
        session_store.delete_session(db_session, session_cookie)
        db_session.commit()
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    response.status_code = 204
    return response


def require_authenticated_user(
    db_session: Session = Depends(get_db_session),
    session_store: OAuthSessionStore = Depends(get_session_store),
    session_cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> AuthenticatedUser:
    """Resolve and validate the signed-in user from the managed session cookie."""
    if session_cookie is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    session_record = session_store.get_session(db_session, session_cookie)
    if session_record is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    expires_at = session_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        session_store.delete_session(db_session, session_record.id)
        db_session.commit()
        raise HTTPException(status_code=401, detail="Session expired")
    return AuthenticatedUser(
        session_id=str(session_record.id),
        github_user_id=session_record.github_user_id,
        github_login=session_record.github_login,
        access_token=session_store.cipher.decrypt(session_record.access_token_encrypted),
    )


def ensure_installation_admin(
    *,
    current_user: AuthenticatedUser,
    installation: GitHubInstallation,
    oauth_client: GitHubOAuthClient,
) -> None:
    """Require the caller to be an installation admin for settings changes."""
    if installation.account_type == InstallationAccountType.USER:
        if current_user.github_login.casefold() == installation.account_login.casefold():
            return
        raise HTTPException(status_code=403, detail="Installation admin access required")

    owner_checker = getattr(oauth_client, "is_org_owner", None)
    if callable(owner_checker):
        if owner_checker(current_user.access_token, org=installation.account_login):
            return
        raise HTTPException(status_code=403, detail="Installation admin access required")

    response = oauth_client.session.get(
        f"{oauth_client.api_base_url}/user/memberships/orgs/{quote(installation.account_login, safe='')}",
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {current_user.access_token}",
        },
        timeout=30,
    )
    if response.status_code == 200:
        payload = response.json()
        if payload.get("state") == "active" and payload.get("role") == "admin":
            return
    elif response.status_code not in {401, 403, 404}:
        raise HTTPException(
            status_code=502,
            detail=(
                "Unable to verify installation admin status: "
                f"GitHub returned status {response.status_code}"
            ),
        )
    raise HTTPException(status_code=403, detail="Installation admin access required")
