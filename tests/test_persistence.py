"""Tests for persistence.py — atomic writes, backup, ledger I/O."""

import json
import os
import pytest


class TestAtomicWriteJson:
    def test_unicode_preserved(self, tmp_dir):
        from persistence import atomic_write_json
        path = os.path.join(tmp_dir, "data.json")
        atomic_write_json(path, {"name": "供应商名称"})
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["name"] == "供应商名称"

    def test_overwrites_existing(self, tmp_dir):
        from persistence import atomic_write_json
        path = os.path.join(tmp_dir, "data.json")
        atomic_write_json(path, {"v": 1})
        atomic_write_json(path, {"v": 2})
        with open(path, "r", encoding="utf-8") as f:
            assert json.load(f)["v"] == 2

    def test_tmp_file_cleaned_up_on_success(self, tmp_dir):
        from persistence import atomic_write_json
        path = os.path.join(tmp_dir, "data.json")
        atomic_write_json(path, [1, 2, 3])
        assert not os.path.exists(path + ".tmp")


class TestReadJson:
    def test_returns_default_for_missing(self, tmp_dir):
        from persistence import read_json
        path = os.path.join(tmp_dir, "nope.json")
        assert read_json(path) == []
        assert read_json(path, default={}) == {}

    def test_returns_default_for_corrupt(self, tmp_dir):
        from persistence import read_json
        path = os.path.join(tmp_dir, "bad.json")
        with open(path, "w") as f:
            f.write("not json {{{")
        assert read_json(path) == []

    def test_reads_valid_json(self, tmp_dir):
        from persistence import atomic_write_json, read_json
        path = os.path.join(tmp_dir, "ok.json")
        atomic_write_json(path, {"key": "value"})
        assert read_json(path, default={}) == {"key": "value"}


class TestLedgerIO:
    def test_read_empty_ledger(self, tmp_dir):
        from persistence import read_ledger
        result = read_ledger(tmp_dir, "cc")
        assert result == []

    def test_write_then_read_ledger(self, tmp_dir):
        from persistence import write_ledger, read_ledger
        txns = [{"id": "t1", "amount": 100.0}, {"id": "t2", "amount": 200.0}]
        write_ledger(tmp_dir, "cc", txns)
        result = read_ledger(tmp_dir, "cc")
        assert len(result) == 2
        assert result[0]["id"] == "t1"

    def test_separate_cc_and_wx_ledgers(self, tmp_dir):
        from persistence import write_ledger, read_ledger
        write_ledger(tmp_dir, "cc", [{"id": "cc1"}])
        write_ledger(tmp_dir, "wx", [{"id": "wx1"}, {"id": "wx2"}])
        assert len(read_ledger(tmp_dir, "cc")) == 1
        assert len(read_ledger(tmp_dir, "wx")) == 2


class TestBackupJson:
    def test_backup_preserves_content(self, tmp_dir):
        from persistence import atomic_write_json, backup_json
        path = os.path.join(tmp_dir, "data.json")
        atomic_write_json(path, {"original": True})
        backup_json(path)
        # Overwrite original
        atomic_write_json(path, {"original": False})
        # Backup should still have old content
        with open(path + ".bak", "r", encoding="utf-8") as f:
            assert json.load(f)["original"] is True
