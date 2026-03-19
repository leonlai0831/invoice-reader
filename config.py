"""Configuration file management — stores API key and claims folder locally.

Portable mode: when .invoice_reader.json exists next to the exe (or main.py),
config is read/written there and claims_root uses relative paths.
This lets users put the entire folder on Google Drive / OneDrive for cross-PC sync.
"""

import os
import sys
import json

_HOME_CONFIG = os.path.join(os.path.expanduser("~"), ".invoice_reader.json")


def _get_exe_dir():
    """Return directory containing the exe (PyInstaller) or the main script (dev)."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    # Dev mode: use sys.argv[0] (main.py location) if available
    if sys.argv and sys.argv[0]:
        return os.path.dirname(os.path.abspath(sys.argv[0]))
    return os.path.dirname(os.path.abspath(__file__))


def _resolve_config_path():
    """Portable: config next to exe; Normal: ~/."""
    exe_dir = _get_exe_dir()
    portable_path = os.path.join(exe_dir, ".invoice_reader.json")
    if os.path.isfile(portable_path):
        return portable_path
    return _HOME_CONFIG


def _atomic_write_json(path, data):
    """Write JSON atomically: write to .tmp then os.replace()."""
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, path)


def load_cfg():
    try:
        with open(_resolve_config_path()) as f:
            return json.load(f)
    except Exception:
        return {"api_key": ""}


def save_cfg(d):
    """Merge-based save — incoming dict is merged with existing config."""
    existing = load_cfg()
    existing.update(d)
    _atomic_write_json(_resolve_config_path(), existing)


def get_claims_root():
    """Return the claims root folder, creating it if needed. Empty = not set.

    Relative paths (e.g. ./Claims) are resolved against the exe directory.
    """
    cfg = load_cfg()
    root = cfg.get("claims_root", "")
    if root and not os.path.isabs(root):
        root = os.path.normpath(os.path.join(_get_exe_dir(), root))
    if root:
        os.makedirs(root, exist_ok=True)
    return root


# ── Portable mode helpers ────────────────────────────────────────

def is_portable():
    """Check if running in portable mode (config next to exe)."""
    return _resolve_config_path() != _HOME_CONFIG


def get_portable_info():
    """Return portable mode status and exe directory."""
    return {"portable": is_portable(), "exe_dir": _get_exe_dir()}


def enable_portable_mode():
    """Copy config to exe dir, convert claims_root to relative path."""
    cfg = load_cfg()  # load from current location (home)
    exe_dir = _get_exe_dir()
    # Convert absolute claims_root to relative (if it is under exe_dir)
    root = cfg.get("claims_root", "")
    if root and os.path.isabs(root):
        try:
            rel = os.path.relpath(root, exe_dir)
            if not rel.startswith(".."):
                cfg["claims_root"] = ".\\" + rel
        except ValueError:
            pass  # different drive on Windows — keep absolute
    portable_path = os.path.join(exe_dir, ".invoice_reader.json")
    _atomic_write_json(portable_path, cfg)


def disable_portable_mode():
    """Move config back to ~/, convert relative paths to absolute, remove portable file."""
    cfg = load_cfg()  # load from portable location
    exe_dir = _get_exe_dir()
    root = cfg.get("claims_root", "")
    if root and not os.path.isabs(root):
        cfg["claims_root"] = os.path.normpath(os.path.join(exe_dir, root))
    _atomic_write_json(_HOME_CONFIG, cfg)
    # Remove the portable config file
    portable_path = os.path.join(exe_dir, ".invoice_reader.json")
    if os.path.isfile(portable_path):
        os.remove(portable_path)
