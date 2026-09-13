"""Create a private local-only bootstrap env; never overwrite or print secrets."""

from pathlib import Path
import argparse
import os
import secrets
from urllib.parse import urlparse


def public_origin(value: str) -> str:
    parsed = urlparse(value)
    if (
        parsed.scheme != "https" or not parsed.hostname
        or parsed.username is not None or parsed.password is not None
        or parsed.path not in {"", "/"} or parsed.params or parsed.query or parsed.fragment
        or any(character.isspace() for character in value)
        or "$" in value or "#" in value
    ):
        raise ValueError("Public origin must be an HTTPS origin without credentials, path, query or fragment")
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("Public origin has an invalid port") from exc
    return value.rstrip("/")


def prepare(target: Path, template: Path, origin: str | None = None) -> None:
    password = secrets.token_urlsafe(32)
    overrides = {
        "APP_BASE_URL": public_origin(origin) if origin else "http://localhost:18080",
        "POSTGRES_PASSWORD": password,
        "DATABASE_URL": f"postgresql+psycopg://notebooklens:{password}@postgres:5432/notebooklens",
        "SESSION_SECRET": secrets.token_urlsafe(48),
        "ENCRYPTION_KEY": secrets.token_urlsafe(48),
        "GITHUB_WEBHOOK_SECRET": secrets.token_urlsafe(48),
        "MANAGED_AI_UI_ENABLED": "false",
        "EMAIL_API_KEY": "local-acceptance-no-email",
        "EMAIL_FROM": "notebooklens@example.invalid",
    }
    lines = [
        "# LOCAL BOOTSTRAP ONLY: GitHub App/OAuth fields are placeholders.",
        "# Use only with docker-compose.acceptance.yml (email delivery disabled).",
    ]
    for line in template.read_text().splitlines():
        key = line.partition("=")[0]
        lines.append(f"{key}={overrides[key]}" if key in overrides else line)
    # Exclusive creation also rejects an existing symlink. os.open mode applies
    # before any secret bytes are written, regardless of the caller's umask.
    fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-origin", help="Approved HTTPS tunnel origin; default is health-only local HTTP")
    args = parser.parse_args()
    directory = Path(__file__).resolve().parent
    try:
        prepare(directory / ".env.acceptance", directory / ".env.example", args.public_origin)
    except FileExistsError:
        raise SystemExit("Refusing to overwrite deploy/.env.acceptance; edit it locally if needed.")
    except ValueError as exc:
        parser.error(str(exc))
    print("Created private deploy/.env.acceptance; App credentials remain placeholders.")
