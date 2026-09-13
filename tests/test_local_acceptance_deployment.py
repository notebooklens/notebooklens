"""Local pilot safety contracts; config resolution never starts containers."""

import importlib.util
import json
from pathlib import Path
import shutil
import stat
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]


def _bootstrap():
    spec = importlib.util.spec_from_file_location(
        "prepare_local_acceptance", ROOT / "deploy/prepare-local-acceptance.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_bootstrap_is_private_random_and_refuses_overwrite(tmp_path):
    target = tmp_path / ".env.acceptance"
    prepare = _bootstrap().prepare
    prepare(target, ROOT / "deploy/.env.example")
    content = target.read_text()
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert "APP_BASE_URL=http://localhost:18080" in content
    assert "POSTGRES_PASSWORD=change-me" not in content
    assert "SESSION_SECRET=replace-" not in content
    assert "GITHUB_WEBHOOK_SECRET=replace-" not in content
    assert "GITHUB_OAUTH_CLIENT_SECRET=replace-me" in content
    with pytest.raises(FileExistsError):
        prepare(target, ROOT / "deploy/.env.example")
    assert target.read_text() == content


def test_bootstrap_refuses_existing_symlink(tmp_path):
    original = tmp_path / "original"
    original.write_text("untouched")
    target = tmp_path / ".env.acceptance"
    target.symlink_to(original)
    with pytest.raises(FileExistsError):
        _bootstrap().prepare(target, ROOT / "deploy/.env.example")
    assert original.read_text() == "untouched"


def test_bootstrap_accepts_https_origin(tmp_path):
    target = tmp_path / ".env.acceptance"
    _bootstrap().prepare(target, ROOT / "deploy/.env.example", "https://pilot.example.com/")
    assert "APP_BASE_URL=https://pilot.example.com\n" in target.read_text()


@pytest.mark.parametrize("origin", [
    "http://pilot.example.com", "https://user:password@pilot.example.com",
    "https://pilot.example.com/path", "https://pilot.example.com?q=1",
    "https://pilot.example.com#fragment", "https://pilot.example.com\nOTHER=bad",
    "https://pilot.example.com:bad", "https://$HOST",
])
def test_bootstrap_rejects_invalid_origin_without_creating_env(tmp_path, origin):
    target = tmp_path / ".env.acceptance"
    with pytest.raises(ValueError):
        _bootstrap().prepare(target, ROOT / "deploy/.env.example", origin)
    assert not target.exists()


def test_acceptance_compose_exposes_only_loopback_gateway():
    if not shutil.which("docker"):
        pytest.skip("Docker Compose unavailable; run deployment config check on operator host")
    version = subprocess.run(["docker", "compose", "version"], capture_output=True)
    if version.returncode:
        pytest.skip("Docker Compose plugin unavailable")
    # Deliberately use the checked-in placeholder example, never real secrets.
    result = subprocess.run(
        [
            "docker", "compose", "-p", "notebooklens-acceptance",
            "-f", "deploy/docker-compose.yml",
            "-f", "deploy/docker-compose.acceptance.yml",
            "--env-file", "deploy/.env.example", "config", "--format", "json",
        ],
        cwd=ROOT, check=True, capture_output=True, text=True,
    )
    config = json.loads(result.stdout)
    assert config["name"] == "notebooklens-acceptance"
    services = config["services"]
    ports = services["gateway"]["ports"]
    assert len(ports) == 1
    assert ports[0]["host_ip"] == "127.0.0.1"
    assert str(ports[0]["published"]) == "18080"
    assert ports[0]["target"] == 8080
    assert all(not service.get("ports") for name, service in services.items() if name != "gateway")
    caddy_mounts = [v for v in services["gateway"]["volumes"] if v["target"] == "/etc/caddy/Caddyfile"]
    assert len(caddy_mounts) == 1
    assert caddy_mounts[0]["source"].endswith("/deploy/Caddyfile.acceptance")
    assert services["worker"]["environment"]["WORKER_NOTIFICATION_BATCH_SIZE"] == "0"
    assert services["api"]["environment"]["MANAGED_AI_UI_ENABLED"] == "false"
