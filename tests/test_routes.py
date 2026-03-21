"""Tests for route blueprint registration and basic endpoint smoke tests."""

import json
import os
import pytest


class TestBlueprintRegistration:
    def test_all_api_routes_registered(self):
        from main import app
        rules = [r.rule for r in app.url_map.iter_rules() if r.rule.startswith("/api")]
        # Verify key routes from each blueprint
        assert "/api/config" in rules          # config_bp
        assert "/api/rates" in rules           # config_bp
        assert "/api/process" in rules         # invoice_bp
        assert "/api/data" in rules            # invoice_bp
        assert "/api/export" in rules          # invoice_bp
        assert "/api/cc/parse" in rules        # cc_bp
        assert "/api/cc/ledger" in rules       # cc_bp
        assert "/api/complete-claim" in rules  # claim_bp
        assert "/api/archive" in rules         # claim_bp
        assert "/api/memory" in rules          # claim_bp

    def test_index_returns_html(self, client):
        rv = client.get("/")
        assert rv.status_code == 200


class TestDataEndpoints:
    def test_get_data_empty(self, client):
        rv = client.get("/api/data")
        data = rv.get_json()
        assert data["ok"] is True
        assert data["rows"] == []

    def test_save_and_get_data(self, client):
        rows = [{"id": "r1", "supplierName": "Test", "amount": "100"}]
        rv = client.post("/api/data", json={"rows": rows})
        assert rv.get_json()["ok"] is True

        rv = client.get("/api/data")
        data = rv.get_json()
        assert data["ok"] is True
        assert len(data["rows"]) == 1
        assert data["rows"][0]["supplierName"] == "Test"


class TestConfigEndpoints:
    def test_get_config(self, client):
        rv = client.get("/api/config")
        data = rv.get_json()
        assert "has_key" in data

    def test_set_config_invalid_body(self, client):
        rv = client.post("/api/config", data="not json", content_type="text/plain")
        assert rv.status_code == 400

    def test_get_folder(self, client, tmp_dir):
        rv = client.get("/api/config/folder")
        data = rv.get_json()
        assert data["ok"] is True
        assert data["path"] == tmp_dir


class TestCCLedgerEndpoints:
    def test_get_empty_ledger(self, client):
        rv = client.get("/api/cc/ledger")
        data = rv.get_json()
        assert data["ok"] is True
        assert data["cc"] == []
        assert data["wx"] == []

    def test_merge_and_get_ledger(self, client):
        txns = [
            {"id": "t1", "date": "2026-01-01", "amount": 100, "description": "Test"},
        ]
        rv = client.post("/api/cc/ledger/merge", json={"transactions": txns, "source": "cc"})
        data = rv.get_json()
        assert data["ok"] is True
        assert data["added"] >= 1

        rv = client.get("/api/cc/ledger")
        data = rv.get_json()
        assert len(data["cc"]) >= 1

    def test_delete_transaction(self, client):
        txns = [{"id": "del_me", "date": "2026-01-01", "amount": 50, "description": "X"}]
        client.post("/api/cc/ledger/merge", json={"transactions": txns, "source": "cc"})

        # merge_transactions assigns a new stable id, so fetch the actual id
        rv = client.get("/api/cc/ledger")
        actual_id = rv.get_json()["cc"][0]["id"]

        rv = client.delete(f"/api/cc/ledger/transaction/{actual_id}")
        data = rv.get_json()
        assert data["ok"] is True

    def test_clear_ledger(self, client):
        txns = [{"id": "c1", "date": "2026-01-01", "amount": 10, "description": "Y"}]
        client.post("/api/cc/ledger/merge", json={"transactions": txns, "source": "cc"})

        rv = client.delete("/api/cc/ledger/cc")
        assert rv.get_json()["ok"] is True

        rv = client.get("/api/cc/ledger")
        assert rv.get_json()["cc"] == []

    def test_clear_invalid_source(self, client):
        rv = client.delete("/api/cc/ledger/invalid")
        data = rv.get_json()
        assert data["ok"] is False


class TestArchiveEndpoints:
    def test_get_empty_archive(self, client):
        rv = client.get("/api/archive")
        data = rv.get_json()
        assert data["ok"] is True
        assert data["claims"] == []


class TestMemoryEndpoints:
    def test_get_memory(self, client):
        rv = client.get("/api/memory")
        data = rv.get_json()
        assert data["ok"] is True
        assert "suppliers" in data
