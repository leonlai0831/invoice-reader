"""Credit card / WeChat statement parsing, cross-reference, and ledger CRUD endpoints."""

import os

from flask import Blueprint, request, jsonify

from config import load_cfg, get_claims_root
from ai_extractor import extract_cc_statement, extract_wechat_statement
from matcher import (
    parse_cc_statement, parse_xlsx_statement, parse_pdf_statement,
    cross_reference_statements, merge_transactions,
)
from persistence import read_ledger, write_ledger, read_json, atomic_write_json, audit_log, logger

cc_bp = Blueprint("cc", __name__)


# ── Archive → Ledger migration (one-time) ────────────────────────

def _maybe_migrate_archive(root):
    """Auto-migrate old cc_archive.json into ledger files (one-time)."""
    archive_path = os.path.join(root, "cc_archive.json")
    migrated_flag = os.path.join(root, ".ledger_migrated")
    if os.path.exists(migrated_flag) or not os.path.exists(archive_path):
        return
    try:
        statements = read_json(archive_path, default=[])
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

        if cc_txns:
            merged_cc, _, _ = merge_transactions([], cc_txns)
            write_ledger(root, "cc", merged_cc)
        if wx_txns:
            merged_wx, _, _ = merge_transactions([], wx_txns)
            write_ledger(root, "wx", merged_wx)

        # Also migrate session transactions
        session_path = os.path.join(root, "cc_session.json")
        if os.path.exists(session_path):
            try:
                sess = read_json(session_path, default={})
                sess_txns = sess.get("transactions", [])
                for t in sess_txns:
                    src = t.get("source", "cc")
                    ledger_key = "wx" if src == "wechat" else "cc"
                    existing = read_ledger(root, ledger_key)
                    merged, added, _ = merge_transactions(existing, [t])
                    if added:
                        write_ledger(root, ledger_key, merged)
            except Exception:
                pass

        with open(migrated_flag, "w") as f:
            f.write("migrated")
        logger.info("Migrated archive: %d CC + %d WX transactions", len(cc_txns), len(wx_txns))
    except Exception as e:
        logger.error("Archive migration failed: %s", e)


# ── CC Parse ─────────────────────────────────────────────────────

@cc_bp.route("/api/cc/parse", methods=["POST"])
def cc_parse():
    file = request.files.get("file")
    if not file:
        return jsonify({"ok": False, "error": "没有收到文件"})

    is_wechat_hint = request.form.get("source", "") == "wechat"

    try:
        file_bytes = file.read()
        mime = (file.content_type or "").lower()
        fname = (file.filename or "").lower()
        is_pdf = "pdf" in mime or fname.endswith(".pdf")
        is_image = any(fname.endswith(ext) for ext in (".jpg", ".jpeg", ".png", ".webp"))
        is_xlsx = fname.endswith(".xlsx") or fname.endswith(".xls") or "spreadsheet" in mime

        source = "cc"
        used_ai = False

        if is_xlsx:
            transactions, detected_source = parse_xlsx_statement(file_bytes, file.filename)
            source = detected_source
        elif is_pdf:
            transactions, detected_source = parse_pdf_statement(file_bytes, file.filename)
            used_ai = False
            if transactions and detected_source:
                source = detected_source
            else:
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
            from matcher import _is_wechat_csv
            text_preview = file_bytes.decode("utf-8-sig", errors="ignore")
            if _is_wechat_csv(text_preview) or is_wechat_hint:
                source = "wechat"
            transactions = parse_cc_statement(file_bytes, file.filename)

        if not transactions:
            return jsonify({"ok": False, "error": "未能解析任何交易记录，请检查文件格式"})
        method = "ai" if used_ai else "local"
        return jsonify({"ok": True, "transactions": transactions, "source": source, "method": method})
    except Exception as e:
        logger.error("cc_parse failed: %s", e, exc_info=True)
        return jsonify({"ok": False, "error": "账单解析失败，请查看日志"})


@cc_bp.route("/api/cc/cross-reference", methods=["POST"])
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
        logger.error("cc_cross_reference failed: %s", e)
        return jsonify({"ok": False, "error": "交叉对账失败，请查看日志"})


# ── Ledger CRUD ──────────────────────────────────────────────────

@cc_bp.route("/api/cc/ledger", methods=["GET"])
def get_cc_ledger():
    """Return both CC and WeChat ledger data."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": True, "cc": [], "wx": [], "ccCount": 0, "wxCount": 0})

    _maybe_migrate_archive(root)

    cc = read_ledger(root, "cc")
    wx = read_ledger(root, "wx")
    cc_total = sum(t.get("amount", 0) for t in cc)
    wx_total = sum(t.get("amount", 0) for t in wx)

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


@cc_bp.route("/api/cc/ledger/merge", methods=["POST"])
def merge_cc_ledger():
    """Merge parsed transactions into the appropriate ledger."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})

    data = request.json
    transactions = data.get("transactions", [])
    source = data.get("source", "cc")

    if not transactions:
        return jsonify({"ok": False, "error": "No transactions to merge"})

    ledger_key = "wx" if source == "wechat" else "cc"
    existing = read_ledger(root, ledger_key)
    merged, added, dups = merge_transactions(existing, transactions)
    write_ledger(root, ledger_key, merged)
    audit_log(root, "ledger_merge", "/api/cc/ledger/merge",
              f"{ledger_key}: +{added} new, {dups} dups, total={len(merged)}")

    return jsonify({
        "ok": True, "added": added, "duplicates": dups,
        "total": len(merged),
    })


@cc_bp.route("/api/cc/ledger/save", methods=["POST"])
def save_cc_ledger():
    """Save updated ledger state (e.g. after match confirm)."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})

    data = request.json
    cc_txns = data.get("cc", [])
    wx_txns = data.get("wx", [])

    if cc_txns is not None:
        write_ledger(root, "cc", cc_txns)
    if wx_txns is not None:
        write_ledger(root, "wx", wx_txns)
    audit_log(root, "ledger_save", "/api/cc/ledger/save",
              f"cc={len(cc_txns or [])}, wx={len(wx_txns or [])}")

    return jsonify({"ok": True})


@cc_bp.route("/api/cc/ledger/<source>", methods=["DELETE"])
def clear_cc_ledger(source):
    """Clear all transactions from one ledger (cc or wx)."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})

    if source not in ("cc", "wx"):
        return jsonify({"ok": False, "error": "Invalid source"})

    audit_log(root, "ledger_clear", f"/api/cc/ledger/{source}",
              f"cleared all {source} transactions")
    write_ledger(root, source, [])
    return jsonify({"ok": True})


@cc_bp.route("/api/cc/ledger/transaction/<txn_id>", methods=["DELETE"])
def delete_ledger_transaction(txn_id):
    """Delete a single transaction from the appropriate ledger."""
    root = get_claims_root()
    if not root:
        return jsonify({"ok": False, "error": "Claims folder not set"})

    for ledger_key in ("cc", "wx"):
        txns = read_ledger(root, ledger_key)
        original_len = len(txns)
        txns = [t for t in txns if t.get("id") != txn_id]
        if len(txns) < original_len:
            audit_log(root, "ledger_delete_txn",
                      f"/api/cc/ledger/transaction/{txn_id}",
                      f"deleted 1 txn from {ledger_key}")
            write_ledger(root, ledger_key, txns)
            return jsonify({"ok": True})

    return jsonify({"ok": False, "error": "Transaction not found"})
