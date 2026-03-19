"""Tests for config.py — atomic write, load/save, claims root, portable mode."""

import os
import json
import pytest
from unittest.mock import patch

from config import (
    load_cfg, save_cfg, get_claims_root, _atomic_write_json,
    _get_exe_dir, _resolve_config_path, _HOME_CONFIG,
    is_portable, get_portable_info, enable_portable_mode, disable_portable_mode,
)


def _mock_config(tmp_dir):
    """Helper: return a context manager that routes config to tmp_dir."""
    cfg_path = os.path.join(tmp_dir, ".invoice_reader.json")
    return patch("config._resolve_config_path", return_value=cfg_path)


class TestAtomicWriteJson:
    def test_writes_valid_json(self, tmp_dir):
        path = os.path.join(tmp_dir, "test.json")
        data = {"key": "value", "number": 42}
        _atomic_write_json(path, data)

        with open(path, "r", encoding="utf-8") as f:
            loaded = json.load(f)
        assert loaded == data

    def test_no_tmp_file_left_behind(self, tmp_dir):
        path = os.path.join(tmp_dir, "test.json")
        _atomic_write_json(path, {"a": 1})

        files = os.listdir(tmp_dir)
        assert files == ["test.json"]

    def test_overwrites_existing_file(self, tmp_dir):
        path = os.path.join(tmp_dir, "test.json")
        _atomic_write_json(path, {"v": 1})
        _atomic_write_json(path, {"v": 2})

        with open(path, "r", encoding="utf-8") as f:
            assert json.load(f)["v"] == 2

    def test_handles_unicode(self, tmp_dir):
        path = os.path.join(tmp_dir, "test.json")
        _atomic_write_json(path, {"name": "发票读取器"})

        with open(path, "r", encoding="utf-8") as f:
            assert json.load(f)["name"] == "发票读取器"


class TestLoadSaveCfg:
    def test_load_returns_default_when_missing(self, tmp_dir):
        missing = os.path.join(tmp_dir, "nope", "missing.json")
        with patch("config._resolve_config_path", return_value=missing):
            cfg = load_cfg()
        assert cfg == {"api_key": ""}

    def test_save_then_load_roundtrip(self, tmp_dir):
        with _mock_config(tmp_dir):
            save_cfg({"api_key": "sk-test-123"})
            cfg = load_cfg()
        assert cfg["api_key"] == "sk-test-123"

    def test_save_merges_with_existing(self, tmp_dir):
        with _mock_config(tmp_dir):
            save_cfg({"api_key": "sk-1"})
            save_cfg({"claims_root": "/tmp/claims"})
            cfg = load_cfg()
        assert cfg["api_key"] == "sk-1"
        assert cfg["claims_root"] == "/tmp/claims"


class TestGetClaimsRoot:
    def test_returns_empty_when_not_set(self, tmp_dir):
        with _mock_config(tmp_dir):
            assert get_claims_root() == ""

    def test_creates_directory_if_missing(self, tmp_dir):
        claims_dir = os.path.join(tmp_dir, "my_claims")
        with _mock_config(tmp_dir):
            save_cfg({"claims_root": claims_dir})
            root = get_claims_root()
        assert root == claims_dir
        assert os.path.isdir(claims_dir)

    def test_relative_path_resolved_against_exe_dir(self, tmp_dir):
        """claims_root = './data' resolves to exe_dir/data."""
        with _mock_config(tmp_dir), \
             patch("config._get_exe_dir", return_value=tmp_dir):
            save_cfg({"claims_root": ".\\data"})
            root = get_claims_root()
        expected = os.path.normpath(os.path.join(tmp_dir, "data"))
        assert root == expected
        assert os.path.isdir(expected)

    def test_absolute_path_unchanged(self, tmp_dir):
        """Absolute claims_root is returned as-is."""
        abs_dir = os.path.join(tmp_dir, "absolute_claims")
        with _mock_config(tmp_dir):
            save_cfg({"claims_root": abs_dir})
            root = get_claims_root()
        assert root == abs_dir


# ── Portable Mode Tests ──────────────────────────────────────────

class TestResolveConfigPath:
    def test_returns_home_when_no_portable_file(self, tmp_dir):
        """No config next to exe → falls back to home config."""
        with patch("config._get_exe_dir", return_value=tmp_dir):
            path = _resolve_config_path()
        assert path == _HOME_CONFIG

    def test_returns_portable_when_file_exists(self, tmp_dir):
        """Config next to exe → returns portable path."""
        portable = os.path.join(tmp_dir, ".invoice_reader.json")
        _atomic_write_json(portable, {"api_key": "portable-key"})
        with patch("config._get_exe_dir", return_value=tmp_dir):
            path = _resolve_config_path()
        assert path == portable


class TestIsPortable:
    def test_not_portable_by_default(self, tmp_dir):
        """No config next to exe → not portable."""
        with patch("config._get_exe_dir", return_value=tmp_dir):
            assert is_portable() is False

    def test_portable_when_config_exists(self, tmp_dir):
        """Config file next to exe → portable."""
        portable = os.path.join(tmp_dir, ".invoice_reader.json")
        _atomic_write_json(portable, {"api_key": ""})
        with patch("config._get_exe_dir", return_value=tmp_dir):
            assert is_portable() is True


class TestEnablePortableMode:
    def test_creates_config_at_exe_dir(self, tmp_dir):
        """enable_portable_mode() creates config at exe dir."""
        home_cfg = os.path.join(tmp_dir, "home", ".invoice_reader.json")
        exe_dir = os.path.join(tmp_dir, "exe")
        os.makedirs(os.path.join(tmp_dir, "home"), exist_ok=True)
        os.makedirs(exe_dir, exist_ok=True)
        _atomic_write_json(home_cfg, {"api_key": "test-key", "claims_root": ""})

        with patch("config._get_exe_dir", return_value=exe_dir), \
             patch("config._HOME_CONFIG", home_cfg), \
             patch("config._resolve_config_path", return_value=home_cfg):
            enable_portable_mode()

        portable = os.path.join(exe_dir, ".invoice_reader.json")
        assert os.path.isfile(portable)
        with open(portable) as f:
            data = json.load(f)
        assert data["api_key"] == "test-key"

    def test_converts_absolute_to_relative(self, tmp_dir):
        """Absolute claims_root under exe_dir → converted to relative."""
        exe_dir = os.path.join(tmp_dir, "exe")
        claims = os.path.join(exe_dir, "Claims")
        os.makedirs(exe_dir, exist_ok=True)
        home_cfg = os.path.join(tmp_dir, "home_cfg.json")
        _atomic_write_json(home_cfg, {"api_key": "", "claims_root": claims})

        with patch("config._get_exe_dir", return_value=exe_dir), \
             patch("config._HOME_CONFIG", home_cfg), \
             patch("config._resolve_config_path", return_value=home_cfg):
            enable_portable_mode()

        portable = os.path.join(exe_dir, ".invoice_reader.json")
        with open(portable) as f:
            data = json.load(f)
        assert data["claims_root"] == ".\\Claims"

    def test_keeps_absolute_if_outside_exe_dir(self, tmp_dir):
        """Absolute claims_root NOT under exe_dir → stays absolute."""
        exe_dir = os.path.join(tmp_dir, "exe")
        claims = os.path.join(tmp_dir, "other", "Claims")
        os.makedirs(exe_dir, exist_ok=True)
        home_cfg = os.path.join(tmp_dir, "home_cfg.json")
        _atomic_write_json(home_cfg, {"api_key": "", "claims_root": claims})

        with patch("config._get_exe_dir", return_value=exe_dir), \
             patch("config._HOME_CONFIG", home_cfg), \
             patch("config._resolve_config_path", return_value=home_cfg):
            enable_portable_mode()

        portable = os.path.join(exe_dir, ".invoice_reader.json")
        with open(portable) as f:
            data = json.load(f)
        assert data["claims_root"] == claims  # unchanged


class TestDisablePortableMode:
    def test_removes_portable_config(self, tmp_dir):
        """disable_portable_mode() removes exe-adjacent config."""
        exe_dir = os.path.join(tmp_dir, "exe")
        os.makedirs(exe_dir, exist_ok=True)
        portable = os.path.join(exe_dir, ".invoice_reader.json")
        home_cfg = os.path.join(tmp_dir, "home_cfg.json")
        _atomic_write_json(portable, {"api_key": "pk", "claims_root": ""})

        with patch("config._get_exe_dir", return_value=exe_dir), \
             patch("config._HOME_CONFIG", home_cfg), \
             patch("config._resolve_config_path", return_value=portable):
            disable_portable_mode()

        assert not os.path.isfile(portable)
        assert os.path.isfile(home_cfg)
        with open(home_cfg) as f:
            data = json.load(f)
        assert data["api_key"] == "pk"

    def test_converts_relative_to_absolute(self, tmp_dir):
        """Relative claims_root → converted back to absolute."""
        exe_dir = os.path.join(tmp_dir, "exe")
        os.makedirs(exe_dir, exist_ok=True)
        portable = os.path.join(exe_dir, ".invoice_reader.json")
        home_cfg = os.path.join(tmp_dir, "home_cfg.json")
        _atomic_write_json(portable, {"api_key": "", "claims_root": ".\\Claims"})

        with patch("config._get_exe_dir", return_value=exe_dir), \
             patch("config._HOME_CONFIG", home_cfg), \
             patch("config._resolve_config_path", return_value=portable):
            disable_portable_mode()

        with open(home_cfg) as f:
            data = json.load(f)
        expected = os.path.normpath(os.path.join(exe_dir, "Claims"))
        assert data["claims_root"] == expected
