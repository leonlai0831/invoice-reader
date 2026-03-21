"""Config, portable mode, folder selection, and exchange rate endpoints."""

import logging
import os

import requests as req_lib
from flask import Blueprint, request, jsonify

logger = logging.getLogger("invoice_reader")

from config import (
    load_cfg, save_cfg, get_claims_root, is_portable,
    get_portable_info, enable_portable_mode, disable_portable_mode, _get_exe_dir,
)
from extraction_cache import cache_clear, cache_stats

config_bp = Blueprint("config", __name__)

# ── Data Privacy Disclosure ──────────────────────────────────────

DATA_DISCLOSURE = (
    "本应用使用 Anthropic Claude API 处理发票/账单图片。"
    "上传的文件内容（含供应商名称、金额、发票号等）将通过 HTTPS 发送至 Anthropic 服务器进行 AI 提取。"
    "数据传输受 Anthropic 的 API 服务条款和隐私政策约束。"
    "本地处理的 Excel/CSV 账单不会发送至外部服务器。"
)


@config_bp.route("/api/privacy-disclosure")
def privacy_disclosure():
    return jsonify({"ok": True, "disclosure": DATA_DISCLOSURE})


# ── Cache management ─────────────────────────────────────────────

@config_bp.route("/api/cache/stats")
def get_cache_stats():
    root = get_claims_root()
    return jsonify({"ok": True, "count": cache_stats(root)})


@config_bp.route("/api/cache/clear", methods=["POST"])
def clear_cache():
    root = get_claims_root()
    cache_clear(root)
    return jsonify({"ok": True})


# ── Config API ───────────────────────────────────────────────────

@config_bp.route("/api/config", methods=["GET"])
def get_config():
    cfg = load_cfg()
    key = cfg.get("api_key", "")
    masked = key[:8] + "..." if len(key) > 12 else ("已设置" if key else "")
    return jsonify({"has_key": bool(key), "masked": masked})


@config_bp.route("/api/config", methods=["POST"])
def set_config():
    data = request.get_json(silent=True)
    if not data or not isinstance(data, dict):
        return jsonify({"ok": False, "error": "Invalid request body"}), 400
    allowed = {"api_key", "claims_root"}
    filtered = {k: v for k, v in data.items() if k in allowed}
    save_cfg(filtered)
    return jsonify({"ok": True})


# ── Portable Mode API ────────────────────────────────────────────

@config_bp.route("/api/config/portable", methods=["GET"])
def get_portable():
    return jsonify(get_portable_info())


@config_bp.route("/api/config/portable", methods=["POST"])
def set_portable():
    data = request.get_json(silent=True) or {}
    enabled = data.get("enabled", False)
    if enabled:
        enable_portable_mode()
    else:
        disable_portable_mode()
    return jsonify({"ok": True, "portable": enabled})


# ── Folder Config API ────────────────────────────────────────────

@config_bp.route("/api/config/folder", methods=["GET"])
def get_folder():
    root = get_claims_root()
    return jsonify({"ok": True, "path": root})


@config_bp.route("/api/config/folder", methods=["POST"])
def set_folder():
    data = request.get_json(silent=True) or {}
    path = data.get("path", "").strip()
    if path:
        os.makedirs(path, exist_ok=True)
        if is_portable() and os.path.isabs(path):
            try:
                rel = os.path.relpath(path, _get_exe_dir())
                if not rel.startswith(".."):
                    path = ".\\" + rel
            except ValueError:
                pass
    save_cfg({"claims_root": path})
    display_path = get_claims_root() or path
    return jsonify({"ok": True, "path": display_path})


@config_bp.route("/api/config/browse-folder", methods=["POST"])
def browse_folder():
    """Open native Windows folder picker via tkinter."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes("-topmost", True)
        folder = filedialog.askdirectory(title="Select Claims Folder")
        root.destroy()
        if folder:
            folder = os.path.normpath(folder)
            save_path = folder
            if is_portable() and os.path.isabs(folder):
                try:
                    rel = os.path.relpath(folder, _get_exe_dir())
                    if not rel.startswith(".."):
                        save_path = ".\\" + rel
                except ValueError:
                    pass
            save_cfg({"claims_root": save_path})
            return jsonify({"ok": True, "path": folder})
        return jsonify({"ok": False, "error": "未选择文件夹"})
    except Exception as e:
        logger.error("browse_folder failed: %s", e)
        return jsonify({"ok": False, "error": "文件夹选择失败，请查看日志"})


# ── Exchange rates ───────────────────────────────────────────────

@config_bp.route("/api/rates")
def get_rates():
    try:
        r = req_lib.get("https://api.exchangerate-api.com/v4/latest/MYR", timeout=6)
        data = r.json()
        raw = data.get("rates")
        if not raw or not isinstance(raw, dict):
            raise ValueError("Invalid rate response")
        result = {}
        for cur in ("USD", "CNY", "SGD", "EUR", "GBP"):
            val = raw.get(cur)
            if not val or not isinstance(val, (int, float)) or val <= 0:
                raise ValueError(f"Invalid rate for {cur}: {val}")
            rate = round(1 / val, 4)
            if rate < 0.0001 or rate > 100000:
                raise ValueError(f"Rate out of range for {cur}: {rate}")
            result[cur] = rate
        result["MYR"] = 1
        return jsonify({"ok": True, "rates": result, "live": True})
    except Exception:
        return jsonify({
            "ok": True, "live": False,
            "rates": {"USD": 4.45, "CNY": 0.62, "SGD": 3.35, "EUR": 4.85, "GBP": 5.75, "MYR": 1},
        })


@config_bp.route("/api/rates/history")
def get_rates_history():
    """Fetch historical daily exchange rates for a date range."""
    start = request.args.get("start", "")
    end = request.args.get("end", "")
    base = request.args.get("base", "CNY").upper()
    target = request.args.get("target", "MYR").upper()
    if not start or not end:
        return jsonify({"ok": False, "error": "start and end required"})
    try:
        url = f"https://api.frankfurter.app/{start}..{end}?from={base}&to={target}"
        r = req_lib.get(url, timeout=10)
        data = r.json()
        raw_rates = data.get("rates", {})
        result = {}
        for date_str, rate_obj in raw_rates.items():
            val = rate_obj.get(target)
            if val and isinstance(val, (int, float)) and val > 0:
                result[date_str] = round(val, 6)
        return jsonify({"ok": True, "rates": result})
    except Exception as e:
        logger.error("get_rates_history failed: %s", e)
        return jsonify({"ok": False, "error": "汇率查询失败"})
