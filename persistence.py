"""Shared persistence utilities — atomic JSON writes, backup, ledger I/O, audit trail, logging."""

import json
import os
import shutil
import logging
from datetime import datetime
from logging.handlers import RotatingFileHandler

logger = logging.getLogger("invoice_reader")

_log_handler = None


def setup_logging(claims_root):
    """Set up file logging to {claims_root}/app.log with rotation."""
    global _log_handler
    if _log_handler:
        return
    if not claims_root:
        return
    try:
        log_path = os.path.join(claims_root, "app.log")
        _log_handler = RotatingFileHandler(
            log_path, maxBytes=2 * 1024 * 1024, backupCount=3, encoding="utf-8"
        )
        _log_handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
            )
        )
        logger.addHandler(_log_handler)
        logger.info("Invoice Reader started")
    except Exception:
        pass


def atomic_write_json(path, data):
    """Write JSON atomically: write to .tmp then os.replace()."""
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, path)


def backup_json(path):
    """Keep one .bak copy of a JSON file before overwriting."""
    if os.path.exists(path):
        try:
            bak = path + ".bak"
            if os.path.getsize(path) > 2:
                shutil.copy2(path, bak)
        except Exception:
            pass


def audit_log(root, action, endpoint="", detail=""):
    """Append an entry to the audit changelog (append-only JSON lines file)."""
    if not root:
        return
    try:
        log_path = os.path.join(root, "changelog.jsonl")
        entry = json.dumps({
            "ts": datetime.now().isoformat(),
            "action": action,
            "endpoint": endpoint,
            "detail": detail,
        }, ensure_ascii=False)
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(entry + "\n")
    except Exception:
        pass


def read_json(path, default=None):
    """Read a JSON file, returning *default* on any error."""
    if default is None:
        default = []
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return default


def read_ledger(root, source):
    """Read a ledger file.  *source* is ``'cc'`` or ``'wx'``."""
    path = os.path.join(root, f"{source}_ledger.json")
    return read_json(path, default=[])


def write_ledger(root, source, txns):
    """Write a ledger file atomically."""
    path = os.path.join(root, f"{source}_ledger.json")
    atomic_write_json(path, txns)
