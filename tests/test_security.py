"""Tests for security hardening: CSRF, error masking, audit trail, keyring, cache TTL, path traversal."""

import json
import os
import sys
import tempfile
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))



# ── FINDING-007: Flask secret_key ─────────────────────────────────

class TestFlaskSecretKey:
    def test_secret_key_is_set(self):
        from main import app
        assert app.secret_key is not None
        assert len(app.secret_key) >= 16


# ── FINDING-008: CSRF protection ─────────────────────────────────

class TestCSRFProtection:
    def test_post_without_header_is_rejected(self, app_client):
        rv = app_client.post("/api/data", json={"rows": []})
        assert rv.status_code == 403

    def test_delete_without_header_is_rejected(self, app_client):
        rv = app_client.delete("/api/cc/ledger/cc")
        assert rv.status_code == 403

    def test_post_with_wrong_header_is_rejected(self, app_client):
        rv = app_client.post("/api/data", json={"rows": []},
                             headers={"X-Requested-With": "WrongValue"})
        assert rv.status_code == 403

    def test_post_with_correct_header_is_accepted(self, app_client):
        rv = app_client.post("/api/data", json={"rows": []},
                             headers={"X-Requested-With": "InvoiceReader"})
        assert rv.status_code == 200

    def test_get_does_not_require_header(self, app_client):
        rv = app_client.get("/api/data")
        assert rv.status_code == 200


# ── FINDING-006: Error message sanitization ───────────────────────

class TestErrorSanitization:
    def test_save_data_error_is_generic(self, app_client, monkeypatch):
        """str(e) should NOT leak in error responses."""
        def boom(*a, **kw):
            raise RuntimeError("SECRET_PATH_/c/users/foo/.config")
        monkeypatch.setattr("routes.invoice_routes.atomic_write_json", boom)

        rv = app_client.post("/api/data", json={"rows": [{"id": "x"}]},
                             headers={"X-Requested-With": "InvoiceReader"})
        data = rv.get_json()
        assert "SECRET_PATH_" not in json.dumps(data)
        assert data["ok"] is False

    def test_export_error_is_generic(self, app_client, monkeypatch):
        def boom(*a, **kw):
            raise RuntimeError("INTERNAL_SECRET")
        monkeypatch.setattr("routes.invoice_routes.build_workbook", boom)

        rv = app_client.post("/api/export", json={"rows": []},
                             headers={"X-Requested-With": "InvoiceReader"})
        data = rv.get_json()
        assert "INTERNAL_SECRET" not in json.dumps(data)


# ── FINDING-003: Privacy disclosure endpoint ──────────────────────

class TestPrivacyDisclosure:
    def test_disclosure_endpoint(self, app_client):
        rv = app_client.get("/api/privacy-disclosure")
        data = rv.get_json()
        assert data["ok"] is True
        assert "Anthropic" in data["disclosure"]
        assert "HTTPS" in data["disclosure"]


# ── FINDING-005: Audit trail ──────────────────────────────────────

class TestAuditTrail:
    def test_save_data_creates_audit_entry(self, app_client, tmp_dir):
        rv = app_client.post("/api/data", json={"rows": [{"id": "a1"}]},
                             headers={"X-Requested-With": "InvoiceReader"})
        assert rv.get_json()["ok"] is True

        log_path = os.path.join(tmp_dir, "changelog.jsonl")
        assert os.path.exists(log_path)
        with open(log_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        assert len(lines) >= 1
        entry = json.loads(lines[-1])
        assert entry["action"] == "save_data"
        assert "1 rows" in entry["detail"]

    def test_ledger_merge_creates_audit_entry(self, app_client, tmp_dir):
        txns = [{"id": "t1", "date": "2026-01-01", "amount": 100, "description": "Test"}]
        rv = app_client.post("/api/cc/ledger/merge",
                             json={"transactions": txns, "source": "cc"},
                             headers={"X-Requested-With": "InvoiceReader"})
        assert rv.get_json()["ok"] is True

        log_path = os.path.join(tmp_dir, "changelog.jsonl")
        with open(log_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        found = any("ledger_merge" in line for line in lines)
        assert found

    def test_ledger_clear_creates_audit_entry(self, app_client, tmp_dir):
        rv = app_client.delete("/api/cc/ledger/cc",
                               headers={"X-Requested-With": "InvoiceReader"})
        assert rv.get_json()["ok"] is True

        log_path = os.path.join(tmp_dir, "changelog.jsonl")
        with open(log_path, "r", encoding="utf-8") as f:
            content = f.read()
        assert "ledger_clear" in content


# ── FINDING-009: Cache TTL ────────────────────────────────────────

class TestCacheTTL:
    def test_expired_entries_are_evicted(self, tmp_dir):
        from extraction_cache import (
            _load_extract_cache, cache_put, cache_get, cache_clear,
            CACHE_TTL_DAYS,
        )
        # Write a stale entry directly
        cache_path = os.path.join(tmp_dir, "extraction_cache.json")
        old_date = (datetime.now() - timedelta(days=CACHE_TTL_DAYS + 1)).isoformat()
        stale = {"hash1": {"data": {"foo": 1}, "cachedAt": old_date}}
        with open(cache_path, "w") as f:
            json.dump(stale, f)

        loaded = _load_extract_cache(tmp_dir)
        assert "hash1" not in loaded

    def test_fresh_entries_are_kept(self, tmp_dir):
        from extraction_cache import _load_extract_cache
        cache_path = os.path.join(tmp_dir, "extraction_cache.json")
        fresh_date = datetime.now().isoformat()
        data = {"hash2": {"data": {"bar": 2}, "cachedAt": fresh_date}}
        with open(cache_path, "w") as f:
            json.dump(data, f)

        loaded = _load_extract_cache(tmp_dir)
        assert "hash2" in loaded

    def test_cache_clear_deletes_file(self, tmp_dir):
        from extraction_cache import cache_clear
        cache_path = os.path.join(tmp_dir, "extraction_cache.json")
        with open(cache_path, "w") as f:
            f.write("{}")
        assert os.path.exists(cache_path)

        cache_clear(tmp_dir)
        assert not os.path.exists(cache_path)

    def test_cache_stats_endpoint(self, app_client):
        rv = app_client.get("/api/cache/stats")
        data = rv.get_json()
        assert data["ok"] is True
        assert "count" in data

    def test_cache_clear_endpoint(self, app_client):
        rv = app_client.post("/api/cache/clear",
                             headers={"X-Requested-With": "InvoiceReader"})
        assert rv.get_json()["ok"] is True


# ── FINDING-015: API key masking ──────────────────────────────────

class TestAPIKeyMasking:
    def test_key_shows_only_prefix(self, app_client, monkeypatch):
        fake_key = "sk-ant-api03-AAAAAABBBBBBCCCCCCDDDDDDEEEEEE"
        monkeypatch.setattr("config.load_cfg", lambda: {"api_key": fake_key})
        monkeypatch.setattr("routes.config_routes.load_cfg", lambda: {"api_key": fake_key})

        rv = app_client.get("/api/config")
        data = rv.get_json()
        assert data["masked"] == "sk-ant-a..."
        # Must NOT contain the last 4 characters
        assert fake_key[-4:] not in data["masked"]


# ── FINDING-002: Keyring integration ──────────────────────────────

class TestKeyringIntegration:
    def test_load_cfg_reads_from_keyring(self, monkeypatch, tmp_dir):
        """When keyring has the key, load_cfg should return it (not from file)."""
        config_path = os.path.join(tmp_dir, ".invoice_reader.json")
        with open(config_path, "w") as f:
            json.dump({"claims_root": "/tmp/test"}, f)

        monkeypatch.setattr("config._resolve_config_path", lambda: config_path)
        monkeypatch.setattr("config._keyring_get", lambda: "sk-from-keyring")

        import config
        cfg = config.load_cfg()
        assert cfg["api_key"] == "sk-from-keyring"

    def test_save_cfg_stores_key_in_keyring(self, monkeypatch, tmp_dir):
        """save_cfg should call keyring_set for the api_key."""
        config_path = os.path.join(tmp_dir, ".invoice_reader.json")
        with open(config_path, "w") as f:
            json.dump({}, f)

        monkeypatch.setattr("config._resolve_config_path", lambda: config_path)
        monkeypatch.setattr("config._keyring_get", lambda: "")

        stored_keys = []
        monkeypatch.setattr("config._keyring_set", lambda k: (stored_keys.append(k), True)[1])

        import config
        config.save_cfg({"api_key": "sk-new-key", "claims_root": "/tmp"})

        assert stored_keys == ["sk-new-key"]
        # Key should NOT be in the JSON file
        with open(config_path, "r") as f:
            file_data = json.load(f)
        assert "api_key" not in file_data

    def test_migrate_key_from_file_to_keyring(self, monkeypatch, tmp_dir):
        """If api_key is in the file, it should be migrated to keyring."""
        config_path = os.path.join(tmp_dir, ".invoice_reader.json")
        with open(config_path, "w") as f:
            json.dump({"api_key": "sk-old-key", "claims_root": "/tmp"}, f)

        monkeypatch.setattr("config._resolve_config_path", lambda: config_path)

        stored_keys = []
        monkeypatch.setattr("config._keyring_set", lambda k: (stored_keys.append(k), True)[1])
        monkeypatch.setattr("config._keyring_get", lambda: "sk-old-key")

        import config
        cfg = config.load_cfg()
        assert cfg["api_key"] == "sk-old-key"
        assert stored_keys == ["sk-old-key"]

        # Key should be removed from file after migration
        with open(config_path, "r") as f:
            file_data = json.load(f)
        assert "api_key" not in file_data


# ── FINDING-011: Path traversal in complete_claim ─────────────────

class TestPathTraversal:
    def test_complete_claim_rejects_traversal(self, app_client, tmp_dir):
        """localFilePath with .. should not access files outside claims root."""
        # Create a file outside the claims root
        secret = os.path.join(tmp_dir, "..", "secret.txt")
        rows = [{
            "id": "r1",
            "supplierName": "Evil",
            "amount": "100",
            "localFilePath": "../secret.txt",
        }]
        rv = app_client.post("/api/complete-claim",
                             json={"rows": rows},
                             headers={"X-Requested-With": "InvoiceReader"})
        data = rv.get_json()
        # Should succeed but skip the file (not copy it)
        assert data["ok"] is True
        # fileCount includes +1 for the Excel file
        assert data.get("fileCount", 0) == 1  # only Excel, no traversal file

    def test_serve_file_rejects_traversal(self, app_client, tmp_dir):
        rv = app_client.get("/api/file/../../etc/passwd")
        assert rv.status_code == 403


# ── FINDING-001: .gitignore ──────────────────────────────────────

class TestGitignore:
    def test_gitignore_contains_config_file(self):
        gitignore_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            ".gitignore",
        )
        with open(gitignore_path, "r") as f:
            content = f.read()
        assert ".invoice_reader.json" in content
