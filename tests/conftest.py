"""Shared fixtures for Invoice Reader tests."""

import os
import sys
import tempfile
import pytest

# Add project root to path so we can import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _close_log_handler():
    """Close any log handlers that hold files in temp dirs (prevents PermissionError on Windows)."""
    import persistence
    if persistence._log_handler:
        persistence.logger.removeHandler(persistence._log_handler)
        persistence._log_handler.close()
        persistence._log_handler = None


def _reset_extraction_cache():
    """Reset extraction_cache module-level state between tests."""
    import extraction_cache
    extraction_cache._extraction_cache = {}
    extraction_cache._extraction_cache_loaded = False
    extraction_cache._cache_loaded_for_root = None


@pytest.fixture
def tmp_dir():
    """Provide a temporary directory for test files, cleaned up after."""
    with tempfile.TemporaryDirectory() as d:
        yield d
        # Must close before TemporaryDirectory.__exit__ deletes the dir
        _close_log_handler()
        _reset_extraction_cache()


class _CSRFClient:
    """Wraps Flask test client to auto-inject X-Requested-With on mutating requests."""

    def __init__(self, inner):
        self._inner = inner

    def get(self, *args, **kwargs):
        return self._inner.get(*args, **kwargs)

    def post(self, *args, **kwargs):
        kwargs.setdefault("headers", {})
        kwargs["headers"]["X-Requested-With"] = "InvoiceReader"
        return self._inner.post(*args, **kwargs)

    def delete(self, *args, **kwargs):
        kwargs.setdefault("headers", {})
        kwargs["headers"]["X-Requested-With"] = "InvoiceReader"
        return self._inner.delete(*args, **kwargs)

    def put(self, *args, **kwargs):
        kwargs.setdefault("headers", {})
        kwargs["headers"]["X-Requested-With"] = "InvoiceReader"
        return self._inner.put(*args, **kwargs)

    @property
    def raw(self):
        """Access the unwrapped client (no CSRF header) for security tests."""
        return self._inner


def _mock_claims_root(monkeypatch, tmp_dir):
    """Patch get_claims_root in all modules that import it."""
    mock_root = lambda: tmp_dir
    monkeypatch.setattr("config.get_claims_root", mock_root)
    monkeypatch.setattr("routes.config_routes.get_claims_root", mock_root)
    monkeypatch.setattr("routes.invoice_routes.get_claims_root", mock_root)
    monkeypatch.setattr("routes.cc_routes.get_claims_root", mock_root)
    monkeypatch.setattr("routes.claim_routes.get_claims_root", mock_root)


@pytest.fixture
def client(monkeypatch, tmp_dir):
    """Create a Flask test client with mocked claims root and CSRF header."""
    _mock_claims_root(monkeypatch, tmp_dir)
    from main import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield _CSRFClient(c)


@pytest.fixture
def app_client(monkeypatch, tmp_dir):
    """Raw Flask test client (no auto CSRF header) for security tests."""
    _mock_claims_root(monkeypatch, tmp_dir)
    from main import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c
