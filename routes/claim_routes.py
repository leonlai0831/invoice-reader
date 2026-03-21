"""Claim archival, archive listing, folder opening, and smart memory endpoints."""

import os
import shutil
from datetime import datetime

from flask import Blueprint, request, jsonify

from config import get_claims_root
from excel_handler import build_workbook, export_filename
from persistence import atomic_write_json, backup_json, audit_log, logger
from memory import load_memory, save_memory, learn_from_rows, rebuild_memory

claim_bp = Blueprint("claim", __name__)


# ── Complete Claim — Archive to dated folder ─────────────────────

@claim_bp.route("/api/complete-claim", methods=["POST"])
def complete_claim():
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})

    rows = request.json.get("rows", [])
    remaining_rows = request.json.get("remainingRows", None)
    if not rows:
        return jsonify({"ok": False, "error": "No invoices to archive"})

    try:
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

            lfp = row.get("localFilePath", "")
            if lfp:
                candidate = os.path.join(root, lfp)
                # Path traversal check: resolved path must stay within claims root
                if os.path.realpath(candidate).startswith(os.path.realpath(root) + os.sep):
                    if os.path.isfile(candidate):
                        src = candidate
                        dest_name = os.path.basename(lfp)

            if not src:
                sfp = row.get("serverFilePath", "")
                if sfp:
                    candidate = os.path.join(root, "working", sfp)
                    # Path traversal check
                    if os.path.realpath(candidate).startswith(os.path.realpath(root) + os.sep):
                        if os.path.isfile(candidate):
                            src = candidate
                            parts = sfp.split("_", 1)
                            dest_name = parts[1] if len(parts) > 1 else sfp

            if not src or not dest_name:
                continue

            try:
                dest = os.path.join(archive_dir, dest_name)
                if os.path.exists(dest):
                    base, ext_part = os.path.splitext(dest_name)
                    dest = os.path.join(archive_dir, f"{base}_{file_count}{ext_part}")

                shutil.copy2(src, dest)
                if os.path.isfile(dest) and os.path.getsize(dest) > 0:
                    try:
                        os.remove(src)
                        logger.info("Moved file: %s -> %s", src, dest)
                    except PermissionError:
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
        import json
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
        backup_json(archive_json_path)
        atomic_write_json(archive_json_path, existing_archive)

        # Smart Memory: learn from submitted rows
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

        # Save remaining rows or clear
        data_path = os.path.join(root, "data.json")
        if remaining_rows is not None and len(remaining_rows) > 0:
            atomic_write_json(data_path, remaining_rows)
        else:
            if os.path.exists(data_path):
                os.remove(data_path)
            working = os.path.join(root, "working")
            if os.path.isdir(working):
                try:
                    remaining_files = os.listdir(working)
                    if not remaining_files:
                        os.rmdir(working)
                    else:
                        logger.warning(
                            "Working dir not empty (%d files remain), skipping cleanup",
                            len(remaining_files),
                        )
                except OSError:
                    pass

        audit_log(root, "complete_claim", "/api/complete-claim",
                  f"archived {len(rows)} invoices, total={round(total_amt,2)}, dir={archive_dir}")

        return jsonify({
            "ok": True,
            "archivePath": archive_dir,
            "excelFile": excel_name,
            "fileCount": file_count + 1,
        })
    except Exception as e:
        logger.error("complete_claim failed: %s", e)
        return jsonify({"ok": False, "error": "归档失败，请查看日志"})


# ── Archive — Load archived claims ───────────────────────────────

@claim_bp.route("/api/archive", methods=["GET"])
def get_archive():
    root = get_claims_root()
    if not root:
        return jsonify({"ok": True, "claims": []})
    archive_path = os.path.join(root, "archive.json")
    if os.path.exists(archive_path):
        try:
            import json
            with open(archive_path, "r", encoding="utf-8") as f:
                claims = json.load(f)
            return jsonify({"ok": True, "claims": claims})
        except Exception as e:
            logger.error("get_archive read failed: %s", e)
            return jsonify({"ok": True, "claims": [], "error": "读取归档失败"})
    return jsonify({"ok": True, "claims": []})


# ── Smart Memory API ─────────────────────────────────────────────

@claim_bp.route("/api/memory", methods=["GET"])
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
        logger.error("get_memory failed: %s", e)
        return jsonify({"ok": True, "suppliers": {}, "customSuppliers": [], "customDescriptions": {}, "error": "读取记忆失败"})


@claim_bp.route("/api/memory/rebuild", methods=["POST"])
def rebuild_memory_endpoint():
    """Rebuild memory.json from archive.json."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})
    try:
        result = rebuild_memory(root)
        return jsonify(result)
    except Exception as e:
        logger.error("rebuild_memory failed: %s", e)
        return jsonify({"ok": False, "error": "记忆重建失败，请查看日志"})


@claim_bp.route("/api/memory/branches", methods=["GET"])
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


@claim_bp.route("/api/memory/branches", methods=["POST"])
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
        logger.error("set_branch_addresses failed: %s", e)
        return jsonify({"ok": False, "error": "保存分支地址失败，请查看日志"})


# ── Open Folder ──────────────────────────────────────────────────

@claim_bp.route("/api/open-folder", methods=["POST"])
def open_folder():
    """Open a folder in Windows Explorer."""
    path = request.json.get("path", "")
    if path and os.path.isdir(path):
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


# ── Open External URL ────────────────────────────────────────────

@claim_bp.route("/api/open-external", methods=["POST"])
def open_external():
    """Open a URL or local file in the system default browser/app."""
    import webbrowser
    url = request.json.get("url", "")
    if not url:
        return jsonify({"ok": False, "error": "No URL provided"})
    # Only allow http/https and the app's own /api/ prefix
    if not (url.startswith("http://") or url.startswith("https://") or url.startswith("/api/")):
        return jsonify({"ok": False, "error": "Invalid URL scheme"}), 400
    # For local API file URLs, construct full localhost URL
    if url.startswith("/api/"):
        host = request.host_url.rstrip("/")
        url = host + url
    webbrowser.open(url)
    return jsonify({"ok": True})
