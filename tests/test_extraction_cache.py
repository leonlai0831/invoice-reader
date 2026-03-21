"""Tests for extraction_cache.py — file hashing, cache get/put."""

import json
import os
import pytest


class TestCacheGetPut:
    def test_cache_miss_returns_none(self, tmp_dir):
        from extraction_cache import cache_get
        result = cache_get(tmp_dir, b"some file content")
        assert result is None

    def test_cache_hit_after_put(self, tmp_dir):
        from extraction_cache import cache_get, cache_put
        file_bytes = b"invoice pdf content"
        data = {"supplierName": "Test Corp", "amount": "42.00"}
        cache_put(tmp_dir, file_bytes, data)
        result = cache_get(tmp_dir, file_bytes)
        assert result is not None
        assert result["supplierName"] == "Test Corp"

    def test_different_content_no_hit(self, tmp_dir):
        from extraction_cache import cache_get, cache_put
        cache_put(tmp_dir, b"file A", {"name": "A"})
        result = cache_get(tmp_dir, b"file B")
        assert result is None

    def test_cache_persists_to_disk(self, tmp_dir):
        from extraction_cache import cache_put
        cache_put(tmp_dir, b"persist test", {"x": 1})
        cache_path = os.path.join(tmp_dir, "extraction_cache.json")
        assert os.path.exists(cache_path)
        with open(cache_path, "r", encoding="utf-8") as f:
            disk_cache = json.load(f)
        assert len(disk_cache) >= 1

    def test_cache_with_none_root(self):
        from extraction_cache import cache_get, cache_put
        # Should not crash with None root
        assert cache_get(None, b"data") is None
        cache_put(None, b"data", {"x": 1})  # should not raise


class TestFileHash:
    def test_consistent(self):
        from extraction_cache import _file_hash
        assert _file_hash(b"abc") == _file_hash(b"abc")

    def test_different_inputs(self):
        from extraction_cache import _file_hash
        assert _file_hash(b"x") != _file_hash(b"y")

    def test_empty_bytes(self):
        from extraction_cache import _file_hash
        h = _file_hash(b"")
        assert isinstance(h, str)
        assert len(h) == 64  # SHA-256 hex
