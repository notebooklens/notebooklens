"""Import an App signing key into the private acceptance env without logging it."""

import argparse
import os
from pathlib import Path
import stat
import tempfile

from cryptography.hazmat.primitives.serialization import (
    Encoding, NoEncryption, PrivateFormat, load_pem_private_key,
)
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPrivateKey
from dotenv.parser import parse_stream


def _open_regular(path: Path) -> int:
    # Reject symlinks in parent components too; do not silently follow a key
    # outside the path the operator selected. O_NOFOLLOW closes the leaf race.
    if any(part.is_symlink() for part in (path, *path.parents)):
        raise ValueError("Expected a regular file, not a symlink")
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        raise ValueError("Expected an existing readable regular file") from None
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_size > 1024 * 1024:
        os.close(fd)
        raise ValueError("Expected a regular file no larger than 1 MiB")
    return fd


def configure_app_key(private_key_path: Path, target_env: Path) -> None:
    """Validate and atomically import an RSA PEM; never return or log secrets."""
    key_fd = _open_regular(private_key_path)
    try:
        target_fd = _open_regular(target_env)
        try:
            original_info = os.fstat(target_fd)
            if (os.fstat(key_fd).st_dev, os.fstat(key_fd).st_ino) == (
                original_info.st_dev, original_info.st_ino
            ):
                raise ValueError("Signing key and environment must be different files")
            with os.fdopen(os.dup(key_fd), "r") as source:
                pem = source.read().strip()
            try:
                key = load_pem_private_key(pem.encode(), password=None)
            except (ValueError, TypeError):
                raise ValueError("File is not a valid unencrypted PEM private key") from None
            if not isinstance(key, RSAPrivateKey):
                raise ValueError("GitHub App signing requires an RSA private key")
            # Re-serialize only the parsed RSA key: discard any non-key trailing
            # data, normalize line endings, and avoid dotenv quoting injection.
            pem = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode().strip()
            with os.fdopen(os.dup(target_fd), "r") as source:
                bindings = list(parse_stream(source))
            if any(binding.error for binding in bindings):
                raise ValueError("Environment file contains invalid dotenv syntax")
            replacement = f"GITHUB_APP_PRIVATE_KEY='{pem}'\n"
            replaced = False
            parts = []
            for binding in bindings:
                if binding.key == "GITHUB_APP_PRIVATE_KEY":
                    if not replaced:
                        parts.append(replacement)
                        replaced = True
                else:
                    parts.append(binding.original.string)
            contents = "".join(parts)
            if not replaced:
                contents += ("\n" if contents and not contents.endswith("\n") else "") + replacement
            os.fchmod(key_fd, 0o600)
            # A crash may leave this file behind: keep its name covered by the
            # same Git/Docker exclusions as deploy/.env.acceptance.
            temp_fd, temp_name = tempfile.mkstemp(prefix=".env.key-", dir=target_env.parent)
            try:
                with os.fdopen(temp_fd, "w") as destination:
                    destination.write(contents)
                    destination.flush()
                    os.fsync(destination.fileno())
                current = target_env.lstat()
                if (current.st_dev, current.st_ino, current.st_mtime_ns, current.st_size) != (
                    original_info.st_dev, original_info.st_ino,
                    original_info.st_mtime_ns, original_info.st_size,
                ):
                    raise ValueError("Environment changed during import; retry after reviewing it")
                os.replace(temp_name, target_env)
            finally:
                if os.path.exists(temp_name):
                    os.unlink(temp_name)
        finally:
            os.close(target_fd)
    finally:
        os.close(key_fd)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private_key", type=Path)
    args = parser.parse_args()
    target = Path(__file__).resolve().parent / ".env.acceptance"
    try:
        configure_app_key(args.private_key, target)
    except (ValueError, UnicodeError):
        parser.error("Key import rejected: verify regular files, valid RSA PEM, and dotenv syntax")
    except OSError:
        parser.error("Key import failed: check file access and retry without concurrent edits")
    print("RSA signing key configured; key and env permissions are 0600.")
    print("Secret rotation must be confirmed separately; no credential values displayed.")


if __name__ == "__main__":
    main()
