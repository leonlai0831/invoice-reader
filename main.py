"""
Invoice Reader Desktop App
Run: python main.py
Build exe: build.bat  (uses PyInstaller)
"""

import os
import sys

# Fix OpenSSL 3.0 legacy provider error (affects cryptography/pdfplumber on some systems)
os.environ.setdefault("CRYPTOGRAPHY_OPENSSL_NO_LEGACY", "1")

import json
import hashlib
import shutil
import threading
from datetime import datetime

import logging
from logging.handlers import RotatingFileHandler

import webview

from flask import Flask, request, jsonify, send_file, render_template, abort, after_this_request
import requests as req_lib

from config import load_cfg, save_cfg, get_claims_root, is_portable, get_portable_info, enable_portable_mode, disable_portable_mode, _get_exe_dir
from ai_extractor import extract_invoice, extract_cc_statement, extract_wechat_statement
from excel_handler import build_workbook, export_filename
from matcher import parse_cc_statement, parse_xlsx_statement, parse_pdf_statement, cross_reference_statements, compute_fingerprint, merge_transactions
from memory import apply_memory, learn_from_rows, match_branch_by_address, load_memory, save_memory, rebuild_memory

# ── PyInstaller resource path ────────────────────────────────────

def resource_path(relative_path):
    """Get path to resource — works both in dev and inside PyInstaller exe."""
    if getattr(sys, "_MEIPASS", None):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), relative_path)

app = Flask(
    __name__,
    template_folder=resource_path("templates"),
    static_folder=resource_path("static"),
)
app.config["TEMPLATES_AUTO_RELOAD"] = True

# ── Logging ───────────────────────────────────────────────────────
logger = logging.getLogger("invoice_reader")
logger.setLevel(logging.INFO)
_log_handler = None

def _setup_logging(claims_root):
    """Set up file logging to {claims_root}/app.log with rotation."""
    global _log_handler
    if _log_handler:
        return
    if not claims_root:
        return
    try:
        log_path = os.path.join(claims_root, "app.log")
        _log_handler = RotatingFileHandler(log_path, maxBytes=2*1024*1024, backupCount=3, encoding="utf-8")
        _log_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
        logger.addHandler(_log_handler)
        logger.info("Invoice Reader started")
    except Exception:
        pass

# ── Atomic JSON write (prevents corruption on crash) ────────────

def _atomic_write_json(path, data):
    """Write JSON atomically: write to .tmp then os.replace()."""
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, path)


def _backup_json(path):
    """Keep one .bak copy of a JSON file before overwriting."""
    if os.path.exists(path):
        try:
            bak = path + ".bak"
            # Only copy if source is non-empty (don't backup corrupted empty files)
            if os.path.getsize(path) > 2:
                shutil.copy2(path, bak)
        except Exception:
            pass

# ── File size limit ────────────────────────────────────────────
MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB

# ── Extraction Cache (in-memory + disk, avoid re-calling API) ────

_extraction_cache = {}
_extraction_cache_loaded = False
_cache_loaded_for_root = None
_cache_lock = threading.Lock()

def _file_hash(data: bytes) -> str:
    """SHA-256 hash of file content."""
    return hashlib.sha256(data).hexdigest()

def _load_extract_cache(root):
    """Load extraction cache from claims root."""
    if not root:
        return {}
    cache_path = os.path.join(root, "extraction_cache.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning("Cache load failed: %s", e)
    return {}

def _ensure_cache_loaded(root):
    """Load cache from disk once on first access, reload if root changes."""
    global _extraction_cache, _extraction_cache_loaded, _cache_loaded_for_root
    if root and (_cache_loaded_for_root != root):
        _extraction_cache = _load_extract_cache(root)
        _extraction_cache_loaded = True
        _cache_loaded_for_root = root

def _save_extract_cache(root, cache):
    """Save extraction cache to claims root."""
    if not root:
        return
    cache_path = os.path.join(root, "extraction_cache.json")
    try:
        # Keep cache from growing indefinitely: limit to 500 entries
        if len(cache) > 500:
            sorted_keys = sorted(cache.keys(), key=lambda k: cache[k].get("cachedAt", ""))
            for k in sorted_keys[:-500]:
                del cache[k]
        _atomic_write_json(cache_path, cache)
    except Exception as e:
        logger.warning("Cache save failed: %s", e)

def _cache_get(root, file_bytes):
    """Check if we have a cached extraction result for this file. Returns dict or None."""
    with _cache_lock:
        _ensure_cache_loaded(root)
        fhash = _file_hash(file_bytes)
        entry = _extraction_cache.get(fhash)
        if entry:
            return entry.get("data")
        return None

def _cache_put(root, file_bytes, data):
    """Store extraction result in cache."""
    with _cache_lock:
        _ensure_cache_loaded(root)
        fhash = _file_hash(file_bytes)
        _extraction_cache[fhash] = {"data": data, "cachedAt": datetime.now().isoformat()}
        _save_extract_cache(root, _extraction_cache)

# ── Pages ────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

# ── Config API ───────────────────────────────────────────────────

@app.route("/api/config", methods=["GET"])
def get_config():
    cfg = load_cfg()
    key = cfg.get("api_key", "")
    masked = key[:8] + "..." + key[-4:] if len(key) > 12 else ("已设置" if key else "")
    return jsonify({"has_key": bool(key), "masked": masked})

@app.route("/api/config", methods=["POST"])
def set_config():
    data = request.get_json(silent=True)
    if not data or not isinstance(data, dict):
        return jsonify({"ok": False, "error": "Invalid request body"}), 400
    allowed = {"api_key", "claims_root"}
    filtered = {k: v for k, v in data.items() if k in allowed}
    save_cfg(filtered)
    return jsonify({"ok": True})

# ── Portable Mode API ───────────────────────────────────────────

@app.route("/api/config/portable", methods=["GET"])
def get_portable():
    return jsonify(get_portable_info())

@app.route("/api/config/portable", methods=["POST"])
def set_portable():
    enabled = request.json.get("enabled", False)
    if enabled:
        enable_portable_mode()
    else:
        disable_portable_mode()
    return jsonify({"ok": True, "portable": enabled})

# ── Folder Config API ────────────────────────────────────────────

@app.route("/api/config/folder", methods=["GET"])
def get_folder():
    root = get_claims_root()
    return jsonify({"ok": True, "path": root})

@app.route("/api/config/folder", methods=["POST"])
def set_folder():
    path = request.json.get("path", "").strip()
    if path:
        os.makedirs(path, exist_ok=True)
        # In portable mode, try to store as relative path
        if is_portable() and os.path.isabs(path):
            try:
                rel = os.path.relpath(path, _get_exe_dir())
                if not rel.startswith(".."):
                    path = ".\\" + rel
            except ValueError:
                pass
    save_cfg({"claims_root": path})
    # Return the resolved absolute path for display
    display_path = get_claims_root() or path
    return jsonify({"ok": True, "path": display_path})

@app.route("/api/config/browse-folder", methods=["POST"])
def browse_folder():
    """Open native Windows folder picker via tkinter."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()
        root.attributes('-topmost', True)
        folder = filedialog.askdirectory(title="Select Claims Folder")
        root.destroy()
        if folder:
            folder = os.path.normpath(folder)
            save_path = folder
            # In portable mode, try to store as relative path
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
        return jsonify({"ok": False, "error": str(e)})

# ── Exchange rates ───────────────────────────────────────────────

@app.route("/api/rates")
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

# ── Data persistence API ────────────────────────────────────────

@app.route("/api/data", methods=["GET"])
def get_data():
    root = get_claims_root()
    _setup_logging(root)
    if not root:
        return jsonify({"ok": True, "rows": [], "needsFolder": True})
    data_path = os.path.join(root, "data.json")
    if os.path.exists(data_path):
        try:
            with open(data_path, "r", encoding="utf-8") as f:
                rows = json.load(f)
            return jsonify({"ok": True, "rows": rows})
        except Exception as e:
            return jsonify({"ok": True, "rows": [], "error": str(e)})
    return jsonify({"ok": True, "rows": []})

@app.route("/api/data", methods=["POST"])
def save_data():
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})
    data_path = os.path.join(root, "data.json")
    rows = request.json.get("rows", [])
    try:
        _backup_json(data_path)
        _atomic_write_json(data_path, rows)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})

# ── Invoice processing ──────────────────────────────────────────

@app.route("/api/process", methods=["POST"])
def process_invoice():
    cfg = load_cfg()
    api_key = cfg.get("api_key", "")
    if not api_key:
        return jsonify({"ok": False, "error": "请先在设置中输入 Anthropic API Key"})

    file = request.files.get("file")
    if not file:
        return jsonify({"ok": False, "error": "没有收到文件"})

    try:
        file_bytes = file.read()
        if len(file_bytes) > MAX_UPLOAD_SIZE:
            return jsonify({"ok": False, "error": f"文件过大 ({len(file_bytes)//1024//1024}MB)，上限 100MB"})
        mime = file.content_type or "image/jpeg"
        root = get_claims_root()

        # Check extraction cache first — avoid redundant API calls
        cached = _cache_get(root, file_bytes) if root else None
        if cached:
            result = {"ok": True, "data": cached, "cached": True}
        else:
            result = extract_invoice(api_key, file_bytes, mime)
            # Cache successful extraction
            if root and result.get("ok"):
                _cache_put(root, file_bytes, result["data"])

        # Save file to working directory if claims_root is set
        if root and result.get("ok"):
            working = os.path.join(root, "working")
            os.makedirs(working, exist_ok=True)
            safe_name = f"{int(datetime.now().timestamp()*1000)}_{file.filename}"
            save_path = os.path.join(working, safe_name)
            with open(save_path, "wb") as f:
                f.write(file_bytes)
            result["serverFilePath"] = safe_name

            # Smart Memory: enhance extracted data with predictions
            try:
                enhanced = apply_memory(root, result["data"])
                result["data"] = enhanced
                # Address-based branch matching
                addr = enhanced.get("address", "")
                if addr:
                    branch, conf = match_branch_by_address(root, addr)
                    if branch:
                        result["data"]["memoryBranchFromAddress"] = branch
                        result["data"]["memoryBranchAddressConf"] = conf
            except Exception as e:
                logger.warning("Memory enhancement failed: %s", e)

        return jsonify(result)
    except Exception as e:
        logger.error("process_invoice failed: %s", e)
        return jsonify({"ok": False, "error": str(e)})

# ── Scan New Claim folder ────────────────────────────────────────

@app.route("/api/scan-folder", methods=["POST"])
def scan_folder():
    """List all invoice files in the New Claim subfolder (recursive)."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "请先在设置中选择 Claims Folder"})

    new_claim = os.path.join(root, "New Claim")
    if not os.path.isdir(new_claim):
        return jsonify({"ok": False, "error": f"找不到 'New Claim' 文件夹: {new_claim}"})

    valid_ext = {".jpg", ".jpeg", ".png", ".webp", ".pdf"}
    files = []
    # Walk recursively through New Claim and all subfolders
    for dirpath, dirnames, filenames in os.walk(new_claim):
        for f in sorted(filenames):
            ext = os.path.splitext(f)[1].lower()
            if ext in valid_ext:
                full = os.path.join(dirpath, f)
                if os.path.isfile(full):
                    # Store relative path from New Claim folder
                    rel = os.path.relpath(full, new_claim).replace("\\", "/")
                    files.append({"name": rel, "size": os.path.getsize(full)})

    if not files:
        return jsonify({"ok": False, "error": "New Claim 文件夹中没有找到发票文件 (jpg/png/webp/pdf)"})

    return jsonify({"ok": True, "files": files, "folder": new_claim})

@app.route("/api/process-local", methods=["POST"])
def process_local():
    """Process a local file from the New Claim folder via AI extraction."""
    cfg = load_cfg()
    api_key = cfg.get("api_key", "")
    if not api_key:
        return jsonify({"ok": False, "error": "请先在设置中输入 Anthropic API Key"})

    filename = request.json.get("filename", "")
    if not filename:
        return jsonify({"ok": False, "error": "未指定文件名"})

    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})

    file_path = os.path.join(root, "New Claim", filename)
    # Security: ensure path stays within New Claim
    if not os.path.realpath(file_path).startswith(os.path.realpath(os.path.join(root, "New Claim")) + os.sep):
        return jsonify({"ok": False, "error": "非法文件路径"})
    if not os.path.isfile(file_path):
        return jsonify({"ok": False, "error": f"文件不存在: {filename}"})

    try:
        with open(file_path, "rb") as f:
            file_bytes = f.read()

        if len(file_bytes) > MAX_UPLOAD_SIZE:
            return jsonify({"ok": False, "error": f"文件过大 ({len(file_bytes)//1024//1024}MB)，上限 100MB"})

        ext = os.path.splitext(filename)[1].lower()
        mime_map = {
            ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".png": "image/png", ".webp": "image/webp",
            ".pdf": "application/pdf",
        }
        mime = mime_map.get(ext, "image/jpeg")

        # Check extraction cache first
        cached = _cache_get(root, file_bytes)
        if cached:
            result = {"ok": True, "data": cached, "cached": True}
        else:
            result = extract_invoice(api_key, file_bytes, mime)
            # Cache successful extraction
            if result.get("ok"):
                _cache_put(root, file_bytes, result["data"])
        if result.get("ok"):
            # Store relative path under claims_root for file serving
            # filename may include subfolder like "photos/receipt.jpg"
            result["localFilePath"] = f"New Claim/{filename}"
            result["fileName"] = os.path.basename(filename)

            # Smart Memory: enhance extracted data with predictions
            try:
                enhanced = apply_memory(root, result["data"])
                result["data"] = enhanced
                addr = enhanced.get("address", "")
                if addr:
                    branch, conf = match_branch_by_address(root, addr)
                    if branch:
                        result["data"]["memoryBranchFromAddress"] = branch
                        result["data"]["memoryBranchAddressConf"] = conf
            except Exception as e:
                logger.warning("Memory enhancement failed: %s", e)

        return jsonify(result)
    except Exception as e:
        logger.error("process_local failed: %s", e)
        return jsonify({"ok": False, "error": str(e)})

# ── File serving ─────────────────────────────────────────────────

@app.route("/api/file/<path:filepath>")
def serve_file(filepath):
    """Serve invoice files from claims_root (working/ or New Claim/)."""
    root = get_claims_root()
    if not root:
        abort(404)
    full = os.path.join(root, filepath)
    # Security: ensure path doesn't escape claims root
    if not os.path.realpath(full).startswith(os.path.realpath(root) + os.sep):
        abort(403)
    if not os.path.isfile(full):
        abort(404)
    return send_file(full)

# ── Excel export ─────────────────────────────────────────────────

@app.route("/api/export", methods=["POST"])
def export_excel():
    try:
        rows = request.json.get("rows", [])
        path = build_workbook(rows)

        @after_this_request
        def cleanup(response):
            try:
                os.unlink(path)
            except OSError:
                pass
            return response

        return send_file(
            path, as_attachment=True, download_name=export_filename(),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})

# ── CC Reconcile ─────────────────────────────────────────────────

@app.route("/api/cc/parse", methods=["POST"])
def cc_parse():
    file = request.files.get("file")
    if not file:
        return jsonify({"ok": False, "error": "没有收到文件"})

    # Check if user explicitly indicated this is a WeChat Pay file
    is_wechat_hint = request.form.get("source", "") == "wechat"

    try:
        file_bytes = file.read()
        mime = (file.content_type or "").lower()
        fname = (file.filename or "").lower()
        is_pdf = "pdf" in mime or fname.endswith(".pdf")
        is_image = any(fname.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp"))
        is_xlsx = fname.endswith(".xlsx") or fname.endswith(".xls") or "spreadsheet" in mime

        source = "cc"  # default source
        used_ai = False  # track whether AI API was used

        if is_xlsx:
            # Excel file — parse with openpyxl, auto-detect WeChat vs CC
            transactions, detected_source = parse_xlsx_statement(file_bytes, file.filename)
            source = detected_source
        elif is_pdf:
            # PDF: try pdfplumber (local, free) first, fall back to AI
            transactions, detected_source = parse_pdf_statement(file_bytes, file.filename)
            used_ai = False
            if transactions and detected_source:
                source = detected_source
            else:
                # pdfplumber couldn't parse — fall back to AI
                cfg = load_cfg()
                api_key = cfg.get("api_key", "")
                if not api_key:
                    return jsonify({"ok": False, "error": "PDF 本地解析失败，需要 API Key 进行 AI 解析"})
                if is_wechat_hint:
                    result = extract_wechat_statement(api_key, file_bytes, mime)
                    source = "wechat"
                else:
                    result = extract_cc_statement(api_key, file_bytes, mime)
                if not result["ok"]:
                    return jsonify(result)
                transactions = result["transactions"]
                if result.get("source") == "wechat":
                    source = "wechat"
                used_ai = True
        elif is_image:
            # Images always need AI
            cfg = load_cfg()
            api_key = cfg.get("api_key", "")
            if not api_key:
                return jsonify({"ok": False, "error": "解析图片账单需要 API Key，请先在设置中输入"})

            if is_wechat_hint:
                result = extract_wechat_statement(api_key, file_bytes, mime)
                source = "wechat"
            else:
                result = extract_cc_statement(api_key, file_bytes, mime)

            if not result["ok"]:
                return jsonify(result)
            transactions = result["transactions"]
            if result.get("source") == "wechat":
                source = "wechat"
            used_ai = True
        else:
            # CSV parsing — auto-detects WeChat vs bank CC format
            from matcher import _is_wechat_csv
            text_preview = file_bytes.decode("utf-8-sig", errors="ignore")
            if _is_wechat_csv(text_preview) or is_wechat_hint:
                source = "wechat"
            transactions = parse_cc_statement(file_bytes, file.filename)

        if not transactions:
            return jsonify({"ok": False, "error": "未能解析任何交易记录，请检查文件格式"})
        # Tell frontend which method was used (helps user see API savings)
        method = "ai" if used_ai else "local"
        return jsonify({"ok": True, "transactions": transactions, "source": source, "method": method})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/cc/cross-reference", methods=["POST"])
def cc_cross_reference():
    """Cross-reference WeChat and CC transactions to find same purchases."""
    try:
        data = request.json
        wechat_txns = data.get("wechatTransactions", [])
        cc_txns = data.get("ccTransactions", [])
        exchange_rate = data.get("exchangeRate", None)
        result = cross_reference_statements(wechat_txns, cc_txns, exchange_rate=exchange_rate)
        return jsonify({"ok": True, **result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})

# ── Complete Claim — Archive to dated folder ─────────────────────

@app.route("/api/complete-claim", methods=["POST"])
def complete_claim():
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})

    rows = request.json.get("rows", [])
    remaining_rows = request.json.get("remainingRows", None)  # rows to keep
    if not rows:
        return jsonify({"ok": False, "error": "No invoices to archive"})

    try:
        # Create year/dated folder (YYYY/YYYYMMDD), with _2 suffix if exists
        now = datetime.now()
        year_str = now.strftime("%Y")
        date_str = now.strftime("%Y%m%d")
        year_dir = os.path.join(root, year_str)
        os.makedirs(year_dir, exist_ok=True)
        archive_dir = os.path.join(year_dir, date_str)
        suffix = 1
        while os.path.exists(archive_dir):
            suffix += 1
            archive_dir = os.path.join(year_dir, f"{date_str}_{suffix}")
        os.makedirs(archive_dir)

        # Export Excel into the archive folder
        excel_name = export_filename()
        excel_path = os.path.join(archive_dir, excel_name)
        build_workbook(rows, output_path=excel_path)

        # Move source files into the archive folder
        file_count = 0
        for row in rows:
            src = None
            dest_name = None

            # Priority 1: local file from New Claim folder
            lfp = row.get("localFilePath", "")
            if lfp:
                candidate = os.path.join(root, lfp)
                if os.path.isfile(candidate):
                    src = candidate
                    dest_name = os.path.basename(lfp)

            # Priority 2: uploaded file in working/
            if not src:
                sfp = row.get("serverFilePath", "")
                if sfp:
                    candidate = os.path.join(root, "working", sfp)
                    if os.path.isfile(candidate):
                        src = candidate
                        parts = sfp.split("_", 1)
                        dest_name = parts[1] if len(parts) > 1 else sfp

            if not src or not dest_name:
                continue

            try:
                dest = os.path.join(archive_dir, dest_name)
                # Handle duplicate filenames
                if os.path.exists(dest):
                    base, ext_part = os.path.splitext(dest_name)
                    dest = os.path.join(archive_dir, f"{base}_{file_count}{ext_part}")

                # Copy first, then delete source (safer than rename on Windows)
                shutil.copy2(src, dest)
                # Verify copy succeeded before deleting source
                if os.path.isfile(dest) and os.path.getsize(dest) > 0:
                    try:
                        os.remove(src)
                        logger.info("Moved file: %s -> %s", src, dest)
                    except PermissionError:
                        # File may be locked by WebView2 preview — retry after GC
                        import gc; gc.collect()
                        try:
                            os.remove(src)
                            logger.info("Moved file (retry): %s -> %s", src, dest)
                        except PermissionError:
                            logger.warning("Could not remove source (locked): %s", src)
                    except OSError as e:
                        logger.warning("Could not remove source: %s — %s", src, e)
                else:
                    logger.error("Copy verification failed: %s -> %s", src, dest)
                    continue

                file_count += 1
            except Exception as e:
                logger.error("File move failed for %s: %s", src, e)
                continue

        # Calculate total amount for archive entry
        total_amt = 0
        for r in rows:
            try:
                total_amt += float(str(r.get("amount", 0)).replace(",", ""))
            except (ValueError, TypeError):
                pass

        # Save to archive.json
        archive_json_path = os.path.join(root, "archive.json")
        existing_archive = []
        if os.path.exists(archive_json_path):
            try:
                with open(archive_json_path, "r", encoding="utf-8") as f:
                    existing_archive = json.load(f)
            except Exception:
                existing_archive = []

        archive_entry = {
            "id": f"claim_{int(now.timestamp() * 1000)}",
            "date": now.strftime("%Y-%m-%d %H:%M:%S"),
            "archivePath": archive_dir,
            "excelFile": excel_name,
            "fileCount": file_count + 1,
            "invoiceCount": len(rows),
            "totalAmount": round(total_amt, 2),
            "rows": rows,
        }
        existing_archive.append(archive_entry)
        _backup_json(archive_json_path)
        _atomic_write_json(archive_json_path, existing_archive)

        # Smart Memory: learn from submitted rows (non-critical)
        try:
            learn_from_rows(root, rows)
        except Exception as e:
            logger.warning("learn_from_rows failed: %s", e)

        # Clean up empty subdirectories in New Claim folder
        new_claim_dir = os.path.join(root, "New Claim")
        if os.path.isdir(new_claim_dir):
            for dirpath, dirnames, filenames in os.walk(new_claim_dir, topdown=False):
                if dirpath != new_claim_dir and not filenames and not dirnames:
                    try:
                        os.rmdir(dirpath)
                    except OSError:
                        pass

        # Save remaining rows (partial claim support) or clear
        data_path = os.path.join(root, "data.json")
        if remaining_rows is not None and len(remaining_rows) > 0:
            _atomic_write_json(data_path, remaining_rows)
        else:
            if os.path.exists(data_path):
                os.remove(data_path)
            # Clean working directory only when ALL rows archived
            # Only rmdir if empty to avoid destroying files that failed to copy
            working = os.path.join(root, "working")
            if os.path.isdir(working):
                try:
                    remaining_files = os.listdir(working)
                    if not remaining_files:
                        os.rmdir(working)
                    else:
                        logger.warning("Working dir not empty (%d files remain), skipping cleanup", len(remaining_files))
                except OSError:
                    pass

        return jsonify({
            "ok": True,
            "archivePath": archive_dir,
            "excelFile": excel_name,
            "fileCount": file_count + 1,  # +1 for Excel
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── Archive — Load archived claims ──────────────────────────────

@app.route("/api/archive", methods=["GET"])
def get_archive():
    root = get_claims_root()
    if not root:
        return jsonify({"ok": True, "claims": []})
    archive_path = os.path.join(root, "archive.json")
    if os.path.exists(archive_path):
        try:
            with open(archive_path, "r", encoding="utf-8") as f:
                claims = json.load(f)
            return jsonify({"ok": True, "claims": claims})
        except Exception as e:
            return jsonify({"ok": True, "claims": [], "error": str(e)})
    return jsonify({"ok": True, "claims": []})

# ── Smart Memory API ─────────────────────────────────────────

@app.route("/api/memory", methods=["GET"])
def get_memory():
    """Return memory data for frontend dropdown merging."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": True, "suppliers": {}, "customSuppliers": [], "customDescriptions": {}})
    try:
        mem = load_memory(root)
        return jsonify({
            "ok": True,
            "suppliers": mem.get("suppliers", {}),
            "customSuppliers": mem.get("customSuppliers", []),
            "customDescriptions": mem.get("customDescriptions", {}),
        })
    except Exception as e:
        return jsonify({"ok": True, "suppliers": {}, "customSuppliers": [], "customDescriptions": {}, "error": str(e)})


@app.route("/api/memory/rebuild", methods=["POST"])
def rebuild_memory_endpoint():
    """Rebuild memory.json from archive.json."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})
    try:
        result = rebuild_memory(root)
        return jsonify(result)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.route("/api/memory/branches", methods=["GET"])
def get_branch_addresses():
    """Get configured branch addresses."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": True, "branchAddresses": {}})
    try:
        mem = load_memory(root)
        return jsonify({"ok": True, "branchAddresses": mem.get("branchAddresses", {})})
    except Exception:
        return jsonify({"ok": True, "branchAddresses": {}})


@app.route("/api/memory/branches", methods=["POST"])
def set_branch_addresses():
    """Save branch addresses."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})
    try:
        addresses = request.json.get("branchAddresses", {})
        mem = load_memory(root)
        mem["branchAddresses"] = addresses
        save_memory(root, mem)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


# ── Open Folder ──────────────────────────────────────────────────

@app.route("/api/open-folder", methods=["POST"])
def open_folder():
    """Open a folder in Windows Explorer."""
    path = request.json.get("path", "")
    if path and os.path.isdir(path):
        # Security: only allow opening folders within claims_root
        root = get_claims_root()
        if root:
            real_path = os.path.realpath(path)
            real_root = os.path.realpath(root)
            if real_path != real_root and not real_path.startswith(real_root + os.sep):
                return jsonify({"ok": False, "error": "Path outside claims folder"})
        import subprocess
        subprocess.Popen(["explorer", os.path.normpath(path)])
        return jsonify({"ok": True})
    return jsonify({"ok": False, "error": "Folder not found"})


# ── CC Ledger (replaces per-month archive) ────────────────────

def _read_ledger(root, source):
    """Read a ledger file. source is 'cc' or 'wx'."""
    path = os.path.join(root, f"{source}_ledger.json")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return []


def _write_ledger(root, source, txns):
    """Write a ledger file atomically."""
    path = os.path.join(root, f"{source}_ledger.json")
    _atomic_write_json(path, txns)


def _maybe_migrate_archive(root):
    """Auto-migrate old cc_archive.json into ledger files (one-time)."""
    archive_path = os.path.join(root, "cc_archive.json")
    migrated_flag = os.path.join(root, ".ledger_migrated")
    if os.path.exists(migrated_flag) or not os.path.exists(archive_path):
        return
    try:
        with open(archive_path, "r", encoding="utf-8") as f:
            statements = json.load(f)
        if not statements:
            return

        cc_txns = []
        wx_txns = []
        for stmt in statements:
            src = stmt.get("source", "cc")
            for t in stmt.get("transactions", []):
                t["source"] = t.get("source", src)
                if src == "wechat" or t.get("source") == "wechat":
                    wx_txns.append(t)
                else:
                    cc_txns.append(t)

        # Dedup within each ledger
        from matcher import compute_fingerprint, merge_transactions
        if cc_txns:
            merged_cc, _, _ = merge_transactions([], cc_txns)
            _write_ledger(root, "cc", merged_cc)
        if wx_txns:
            merged_wx, _, _ = merge_transactions([], wx_txns)
            _write_ledger(root, "wx", merged_wx)

        # Also migrate session transactions into ledger
        session_path = os.path.join(root, "cc_session.json")
        if os.path.exists(session_path):
            try:
                with open(session_path, "r", encoding="utf-8") as f:
                    sess = json.load(f)
                sess_txns = sess.get("transactions", [])
                for t in sess_txns:
                    src = t.get("source", "cc")
                    if src == "wechat":
                        existing = _read_ledger(root, "wx")
                        merged, added, _ = merge_transactions(existing, [t])
                        if added:
                            _write_ledger(root, "wx", merged)
                    else:
                        existing = _read_ledger(root, "cc")
                        merged, added, _ = merge_transactions(existing, [t])
                        if added:
                            _write_ledger(root, "cc", merged)
            except Exception:
                pass

        # Mark migration done
        with open(migrated_flag, "w") as f:
            f.write("migrated")
        logger.info("Migrated archive: %d CC + %d WX transactions", len(cc_txns), len(wx_txns))
    except Exception as e:
        logger.error("Archive migration failed: %s", e)


@app.route("/api/cc/ledger", methods=["GET"])
def get_cc_ledger():
    """Return both CC and WeChat ledger data."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": True, "cc": [], "wx": [], "ccCount": 0, "wxCount": 0})

    _maybe_migrate_archive(root)

    cc = _read_ledger(root, "cc")
    wx = _read_ledger(root, "wx")
    cc_total = sum(t.get("amount", 0) for t in cc)
    wx_total = sum(t.get("amount", 0) for t in wx)

    # Collect bank breakdown for CC
    banks = {}
    for t in cc:
        b = t.get("detectedBank", "unknown")
        banks[b] = banks.get(b, 0) + 1

    return jsonify({
        "ok": True,
        "cc": cc, "wx": wx,
        "ccCount": len(cc), "wxCount": len(wx),
        "ccTotal": round(cc_total, 2), "wxTotal": round(wx_total, 2),
        "banks": banks,
    })


@app.route("/api/cc/ledger/merge", methods=["POST"])
def merge_cc_ledger():
    """Merge parsed transactions into the appropriate ledger."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})

    data = request.json
    transactions = data.get("transactions", [])
    source = data.get("source", "cc")  # "cc" or "wechat"

    if not transactions:
        return jsonify({"ok": False, "error": "No transactions to merge"})

    ledger_key = "wx" if source == "wechat" else "cc"
    existing = _read_ledger(root, ledger_key)
    merged, added, dups = merge_transactions(existing, transactions)
    _write_ledger(root, ledger_key, merged)

    return jsonify({
        "ok": True, "added": added, "duplicates": dups,
        "total": len(merged),
    })


@app.route("/api/cc/ledger/save", methods=["POST"])
def save_cc_ledger():
    """Save updated ledger state (e.g. after match confirm)."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})

    data = request.json
    cc_txns = data.get("cc", [])
    wx_txns = data.get("wx", [])

    if cc_txns is not None:
        _write_ledger(root, "cc", cc_txns)
    if wx_txns is not None:
        _write_ledger(root, "wx", wx_txns)

    return jsonify({"ok": True})


@app.route("/api/cc/ledger/<source>", methods=["DELETE"])
def clear_cc_ledger(source):
    """Clear all transactions from one ledger (cc or wx)."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})

    if source not in ("cc", "wx"):
        return jsonify({"ok": False, "error": "Invalid source"})

    _write_ledger(root, source, [])
    return jsonify({"ok": True})


@app.route("/api/cc/ledger/transaction/<txn_id>", methods=["DELETE"])
def delete_ledger_transaction(txn_id):
    """Delete a single transaction from the appropriate ledger."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})

    for ledger_key in ("cc", "wx"):
        txns = _read_ledger(root, ledger_key)
        original_len = len(txns)
        txns = [t for t in txns if t.get("id") != txn_id]
        if len(txns) < original_len:
            _write_ledger(root, ledger_key, txns)
            return jsonify({"ok": True})

    return jsonify({"ok": False, "error": "Transaction not found"})


# ── CC Session Persistence ──────────────────────────────────────



# ── Launch ───────────────────────────────────────────────────────

def _find_free_port(preferred=7788):
    """Find a free port, preferring the given one."""
    import socket
    # Try preferred port first
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", preferred))
            return preferred
    except OSError:
        pass
    # Auto-select a free port
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]

_flask_port = 7788

def _start_flask():
    """Run Flask in a background thread so the main thread can own the GUI."""
    app.run(host="127.0.0.1", port=_flask_port, debug=False, use_reloader=False)

if __name__ == "__main__":
    _flask_port = _find_free_port()

    # Flask on daemon thread — dies automatically when window closes
    t = threading.Thread(target=_start_flask, daemon=True)
    t.start()

    # Native desktop window (Edge WebView2 on Windows)
    webview.create_window(
        "Invoice Reader — Optimum Group",
        f"http://localhost:{_flask_port}",
        width=1440,
        height=900,
        min_size=(900, 600),
    )
    webview.start()  # blocks until user closes the window
