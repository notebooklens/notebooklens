"""Public error responses must not expose arbitrary upstream response bodies."""

from fastapi.testclient import TestClient

from apps.api.main import create_app
from apps.api.managed_github import ManagedGitHubClientError


def test_managed_github_error_response_does_not_reflect_provider_body():
    app = create_app()
    private_marker = "synthetic-private-provider-body-never-return"

    @app.get("/synthetic-error")
    def synthetic_error():
        raise ManagedGitHubClientError(private_marker, status_code=422)

    response = TestClient(app).get("/synthetic-error")
    assert response.status_code == 502
    assert response.json() == {"detail": "GitHub request failed. Please try again."}
    assert private_marker not in response.text
