"""Read-only pytest instrumentation: report registered route/status coverage.

Prints declared templates only, never concrete request URLs, headers or bodies.
"""
from collections import defaultdict
from urllib.parse import urlsplit

from starlette.testclient import TestClient
from starlette.routing import compile_path

OBSERVED = defaultdict(set)
ORIGINAL = TestClient.request
ROUTES = []


def pytest_configure(config):
    from apps.api.main import create_app
    for path, methods in create_app().openapi()["paths"].items():
        for method in methods:
            ROUTES.append((method.upper(), path, compile_path(path)[0]))
    def request(client, method, url, **kwargs):
        response = ORIGINAL(client, method, url, **kwargs)
        path = urlsplit(str(url)).path
        for route_method, template, pattern in ROUTES:
            if pattern.fullmatch(path) and method.upper() == route_method:
                OBSERVED[(route_method, template)].add(response.status_code)
        return response
    TestClient.request = request


def pytest_sessionfinish(session, exitstatus):
    TestClient.request = ORIGINAL
    print("\nREGISTERED API ROUTE RESPONSE COVERAGE (isolated TestClient, mocked upstreams)")
    for method, path, _ in ROUTES:
        print(method, path, sorted(OBSERVED[(method, path)]) or "NOT OBSERVED")
