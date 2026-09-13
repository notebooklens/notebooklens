"""Key import tests use newly generated disposable RSA keys only."""

import importlib.util
import json
from pathlib import Path
import shutil
import stat
import subprocess
import fnmatch

import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.hazmat.primitives.serialization import Encoding, NoEncryption, PrivateFormat
from dotenv import dotenv_values


ROOT = Path(__file__).resolve().parents[1]


def importer():
    spec = importlib.util.spec_from_file_location("configure_app_key", ROOT / "deploy/configure-app-key.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.configure_app_key


@pytest.fixture
def synthetic_files(tmp_path):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()).decode().strip()
    key_path = tmp_path / "synthetic.pem"
    key_path.write_text(pem + "\n")
    target = tmp_path / ".env.acceptance"
    target.write_text("# preserve me\nOTHER='literal $VALUE'\nGITHUB_APP_PRIVATE_KEY=placeholder\nLAST=yes\n")
    return key_path, target, pem


def test_import_roundtrips_dotenv_preserves_fields_and_logs_nothing(synthetic_files, capsys):
    key_path, target, pem = synthetic_files
    importer()(key_path, target)
    values = dotenv_values(target, interpolate=False)
    assert values["GITHUB_APP_PRIVATE_KEY"] == pem
    assert values["OTHER"] == "literal $VALUE"
    assert values["LAST"] == "yes"
    assert target.read_text().startswith("# preserve me\nOTHER='literal $VALUE'\n")
    assert stat.S_IMODE(target.stat().st_mode) == 0o600
    assert stat.S_IMODE(key_path.stat().st_mode) == 0o600
    assert capsys.readouterr() == ("", "")
    importer()(key_path, target)
    assert target.read_text().count("GITHUB_APP_PRIVATE_KEY=") == 1


@pytest.mark.parametrize("which", ["key", "target"])
@pytest.mark.parametrize("kind", ["missing", "symlink", "directory"])
def test_rejects_nonregular_files(synthetic_files, tmp_path, which, kind):
    key_path, target, _ = synthetic_files
    bad = tmp_path / "bad"
    if kind == "symlink":
        bad.symlink_to(key_path if which == "key" else target)
    elif kind == "directory":
        bad.mkdir()
    original = target.read_bytes()
    with pytest.raises(ValueError):
        importer()(bad if which == "key" else key_path, bad if which == "target" else target)
    assert target.read_bytes() == original


@pytest.mark.parametrize("kind", ["invalid", "nonrsa"])
def test_rejects_invalid_key_without_changing_env(synthetic_files, kind):
    key_path, target, _ = synthetic_files
    if kind == "invalid":
        key_path.write_text("not a PEM")
    else:
        key_path.write_bytes(ec.generate_private_key(ec.SECP256R1()).private_bytes(
            Encoding.PEM, PrivateFormat.PKCS8, NoEncryption()
        ))
    original = target.read_bytes()
    with pytest.raises(ValueError):
        importer()(key_path, target)
    assert target.read_bytes() == original


def test_rejects_symlink_parent(synthetic_files, tmp_path):
    key_path, target, _ = synthetic_files
    link = tmp_path / "link"
    link.symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(ValueError):
        importer()(link / key_path.name, target)


def test_appends_missing_key_and_preserves_unterminated_last_field(synthetic_files):
    key_path, target, pem = synthetic_files
    target.write_text("KEEP='unchanged'")
    importer()(key_path, target)
    assert target.read_text().startswith("KEEP='unchanged'\n")
    assert dotenv_values(target)["GITHUB_APP_PRIVATE_KEY"] == pem


def test_invalid_env_is_not_rewritten(synthetic_files):
    key_path, target, _ = synthetic_files
    target.write_text("UNFINISHED='oops")
    with pytest.raises(ValueError):
        importer()(key_path, target)
    assert target.read_text() == "UNFINISHED='oops"


def test_interrupted_import_temp_name_is_excluded_from_git_and_docker(synthetic_files, monkeypatch):
    key_path, target, _ = synthetic_files
    configure = importer()
    original_mkstemp = configure.__globals__["tempfile"].mkstemp
    captured = []

    def capture_temp(*args, **kwargs):
        captured.append(kwargs["prefix"])
        return original_mkstemp(*args, **kwargs)

    monkeypatch.setattr(configure.__globals__["tempfile"], "mkstemp", capture_temp)
    configure(key_path, target)
    assert captured == [".env.key-"]
    candidate = "deploy/.env.key-interrupted-import"
    result = subprocess.run(
        ["git", "check-ignore", "--no-index", "-q", candidate], cwd=ROOT, capture_output=True
    )
    assert result.returncode == 0
    patterns = (ROOT / ".dockerignore").read_text().splitlines()
    matches = [pattern for pattern in patterns if pattern and not pattern.startswith(("#", "!"))
               and fnmatch.fnmatch(candidate, pattern)]
    assert matches
    assert not any(fnmatch.fnmatch(candidate, pattern[1:]) for pattern in patterns if pattern.startswith("!"))


def test_compose_and_dotenv_agree_on_synthetic_multiline_key(synthetic_files, tmp_path):
    if not shutil.which("docker"):
        pytest.skip("Docker Compose unavailable")
    if subprocess.run(["docker", "compose", "version"], capture_output=True).returncode:
        pytest.skip("Docker Compose plugin unavailable")
    key_path, target, pem = synthetic_files
    importer()(key_path, target)
    compose = tmp_path / "compose.yml"
    compose.write_text('services:\n  fixture:\n    image: busybox\n    environment:\n      SYNTHETIC_KEY: ${GITHUB_APP_PRIVATE_KEY}\n')
    result = subprocess.run([
        "docker", "compose", "-p", "key-import-test", "--env-file", str(target),
        "-f", str(compose), "config", "--format", "json",
    ], capture_output=True, text=True, check=True)
    actual = json.loads(result.stdout)["services"]["fixture"]["environment"]["SYNTHETIC_KEY"]
    assert actual == pem == dotenv_values(target)["GITHUB_APP_PRIVATE_KEY"]
