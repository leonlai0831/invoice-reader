"""Invoice processing, file serving, data persistence, and Excel export endpoints."""

import os
from datetime import datetime

import werkzeug.utils
from flask import Blueprint, request, jsonify, send_file, after_this_request

from config import load_cfg, get_claims_root
from ai_extractor import extract_invoice
from excel_handler import build_workbook, export_filename
from extraction_cache import cache_get, cache_put
from persistence import atomic_write_json, backup_json, audit_log, setup_logging, logger
from memory import apply_memory, match_branch_by_address

invoice_bp = Blueprint("invoice", __name__)

MAX_UPLOAD_SIZE = 100 * 1024 * 1024  # 100 MB

# ── Data persistence API ─────────────────────────────────────────

@invoice_bp.route("/api/data", methods=["GET"])
def get_data():
    root = get_claims_root()
    setup_logging(root)
    if not root:
        return jsonify({"ok": True, "rows": [], "needsFolder": True})
    data_path = os.path.join(root, "data.json")
    if os.path.exists(data_path):
        try:
            with open(data_path, "r", encoding="utf-8") as f:
                import json
                rows = json.load(f)
            return jsonify({"ok": True, "rows": rows})
        except Exception as e:
            logger.error("get_data read failed: %s", e)
            return jsonify({"ok": True, "rows": [], "error": "读取数据失败"})
    return jsonify({"ok": True, "rows": []})


@invoice_bp.route("/api/data", methods=["POST"])
def save_data():
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})
    data_path = os.path.join(root, "data.json")
    rows = request.json.get("rows", [])
    try:
        backup_json(data_path)
        atomic_write_json(data_path, rows)
        audit_log(root, "save_data", "/api/data", f"{len(rows)} rows")
        return jsonify({"ok": True})
    except Exception as e:
        logger.error("save_data failed: %s", e)
        return jsonify({"ok": False, "error": "保存数据失败，请查看日志"})


# ── Invoice processing ───────────────────────────────────────────

def _enhance_with_memory(root, data):
    """Apply smart memory predictions and address-based branch matching."""
    enhanced = apply_memory(root, data)
    addr = enhanced.get("address", "")
    if addr:
        branch, conf = match_branch_by_address(root, addr)
        if branch:
            enhanced["memoryBranchFromAddress"] = branch
            enhanced["memoryBranchAddressConf"] = conf
    return enhanced


@invoice_bp.route("/api/process", methods=["POST"])
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

        cached = cache_get(root, file_bytes) if root else None
        if cached:
            result = {"ok": True, "data": cached, "cached": True}
        else:
            result = extract_invoice(api_key, file_bytes, mime)
            if root and result.get("ok"):
                cache_put(root, file_bytes, result["data"])

        if root and result.get("ok"):
            working = os.path.join(root, "working")
            os.makedirs(working, exist_ok=True)
            safe_name = f"{int(datetime.now().timestamp()*1000)}_{werkzeug.utils.secure_filename(file.filename)}"
            save_path = os.path.join(working, safe_name)
            with open(save_path, "wb") as f:
                f.write(file_bytes)
            result["serverFilePath"] = safe_name

            try:
                result["data"] = _enhance_with_memory(root, result["data"])
            except Exception as e:
                logger.warning("Memory enhancement failed: %s", e)

        return jsonify(result)
    except Exception as e:
        logger.error("process_invoice failed: %s", e, exc_info=True)
        return jsonify({"ok": False, "error": "发票处理失败，请查看日志"})


# ── Scan New Claim folder ────────────────────────────────────────

@invoice_bp.route("/api/scan-folder", methods=["POST"])
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
    for dirpath, dirnames, filenames in os.walk(new_claim):
        for f in sorted(filenames):
            ext = os.path.splitext(f)[1].lower()
            if ext in valid_ext:
                full = os.path.join(dirpath, f)
                if os.path.isfile(full):
                    rel = os.path.relpath(full, new_claim).replace("\\", "/")
                    files.append({"name": rel, "size": os.path.getsize(full)})

    if not files:
        return jsonify({"ok": False, "error": "New Claim 文件夹中没有找到发票文件 (jpg/png/webp/pdf)"})

    return jsonify({"ok": True, "files": files, "folder": new_claim})


@invoice_bp.route("/api/process-local", methods=["POST"])
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
    if not os.path.realpath(file_path).startswith(
        os.path.realpath(os.path.join(root, "New Claim")) + os.sep
    ):
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

        cached = cache_get(root, file_bytes)
        if cached:
            result = {"ok": True, "data": cached, "cached": True}
        else:
            result = extract_invoice(api_key, file_bytes, mime)
            if result.get("ok"):
                cache_put(root, file_bytes, result["data"])

        if result.get("ok"):
            result["localFilePath"] = f"New Claim/{filename}"
            result["fileName"] = os.path.basename(filename)

            try:
                result["data"] = _enhance_with_memory(root, result["data"])
            except Exception as e:
                logger.warning("Memory enhancement failed: %s", e)

        return jsonify(result)
    except Exception as e:
        logger.error("process_local failed: %s", e, exc_info=True)
        return jsonify({"ok": False, "error": "本地文件处理失败，请查看日志"})


# ── File serving ─────────────────────────────────────────────────

@invoice_bp.route("/api/file/<path:filepath>")
def serve_file(filepath):
    """Serve invoice files from claims_root (working/ or New Claim/)."""
    from flask import abort
    root = get_claims_root()
    if not root:
        abort(404)
    full = os.path.join(root, filepath)
    if not os.path.realpath(full).startswith(os.path.realpath(root) + os.sep):
        abort(403)
    if not os.path.isfile(full):
        abort(404)
    return send_file(full)


# ── Excel export ─────────────────────────────────────────────────

@invoice_bp.route("/api/export", methods=["POST"])
def export_excel():
    path = None
    try:
        rows = request.json.get("rows", [])
        path = build_workbook(rows)

        @after_this_request
        def cleanup(response):
            try:
                if path:
                    os.unlink(path)
            except OSError:
                pass
            return response

        return send_file(
            path, as_attachment=True, download_name=export_filename(),
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except Exception as e:
        # Ensure temp file is cleaned up even on failure
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass
        logger.error("export_excel failed: %s", e)
        return jsonify({"ok": False, "error": "Excel 导出失败，请查看日志"})
