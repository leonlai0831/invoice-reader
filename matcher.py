"""Credit card statement reconciliation — parse statements and match to invoices."""

import csv
import io
import re
from datetime import datetime, timedelta


# ── PDF Parsing (pdfplumber — local, no API) ─────────────────────

def parse_pdf_statement(file_bytes, filename=None):
    """Parse a CC or WeChat Pay statement from a PDF using pdfplumber (no API needed).

    Extracts tables and text from the PDF, then attempts to parse as
    WeChat Pay or bank CC statement using existing parsers.

    Returns (transactions_list, detected_source) or ([], None) if parsing fails.
    Source is "wechat", "cc", or None (meaning fallback to AI needed).
    """
    try:
        import pdfplumber
    except ImportError:
        return [], None

    all_rows = []
    full_text = ""

    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page in pdf.pages:
                # Extract text for WeChat detection
                page_text = page.extract_text() or ""
                full_text += page_text + "\n"

                # Extract tables (pdfplumber is excellent at this)
                tables = page.extract_tables()
                for table in tables:
                    for row in table:
                        if row:
                            cleaned = [str(cell).strip() if cell else "" for cell in row]
                            if any(c for c in cleaned):
                                all_rows.append(cleaned)

            # If no tables found, try to parse text lines as rows
            if not all_rows and full_text.strip():
                all_rows = _text_to_rows(full_text)
    except Exception:
        return [], None

    if not all_rows:
        return [], None

    # Check if this is a WeChat Pay PDF
    is_wechat = _is_wechat_content(full_text) or _is_wechat_content(
        "\n".join(",".join(r) for r in all_rows[:25])
    )

    if is_wechat:
        txns = _parse_wechat_rows(all_rows)
        if txns:
            return txns, "wechat"

    # Try as bank CC statement
    txns = _parse_cc_rows(all_rows)
    if txns:
        return txns, "cc"

    # Try generic text-based parsing for simple statements
    if full_text.strip():
        txns = _parse_text_statement(full_text)
        if txns:
            return txns, "cc"

    return [], None


def _text_to_rows(text):
    """Convert PDF text lines into row-like structures for table parsers."""
    rows = []
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        # Try splitting by multiple spaces (common in PDF text extraction)
        parts = re.split(r'\s{2,}', line)
        if len(parts) >= 2:
            rows.append(parts)
        else:
            # Try tab or pipe separators
            for sep in ['\t', '|', ',']:
                parts = [p.strip() for p in line.split(sep)]
                if len(parts) >= 2:
                    rows.append(parts)
                    break
    return rows


def _parse_text_statement(text):
    """Parse CC statement from raw text when no tables are found.

    Looks for patterns like:
      DD/MM/YYYY  MERCHANT NAME  1,234.56
      DD MMM YYYY  DESCRIPTION  RM 123.45
    """
    # Date pattern followed by description and amount
    date_pattern = r'(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}|\d{1,2}\s+\w{3}\s+\d{2,4})'
    amount_pattern = r'([\d,]+\.\d{2})\s*$'

    transactions = []
    idx = 0
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue

        # Look for line with date at start and amount at end
        date_match = re.match(date_pattern, line)
        amount_match = re.search(amount_pattern, line)

        if date_match and amount_match:
            raw_date = date_match.group(1)
            raw_amt = amount_match.group(1)

            # Description is everything between date and amount
            desc_start = date_match.end()
            desc_end = amount_match.start()
            raw_desc = line[desc_start:desc_end].strip()
            raw_desc = re.sub(r'^[\s\-]+', '', raw_desc)  # Clean leading dashes/spaces

            parsed_date = _parse_date(raw_date)
            parsed_amt = _parse_amount(raw_amt)

            if parsed_amt and parsed_amt > 0 and (parsed_date or raw_desc):
                transactions.append({
                    "id": f"cc_{idx}",
                    "date": parsed_date.strftime("%d/%m/%Y") if parsed_date else raw_date,
                    "dateISO": parsed_date.isoformat() if parsed_date else "",
                    "description": raw_desc,
                    "amount": round(parsed_amt, 2),
                    "matched": False,
                    "matchedInvoiceId": None,
                    "detectedBank": "pdf_text",
                })
                idx += 1

    return transactions if len(transactions) >= 2 else []  # Need at least 2 to be meaningful


# ── XLSX Parsing ─────────────────────────────────────────────────

def parse_xlsx_statement(file_bytes, filename=None):
    """Parse a credit card or WeChat Pay statement from an .xlsx file.

    Auto-detects if it's a WeChat Pay or bank CC statement by looking for
    Chinese header markers (交易时间, 交易对方, etc.).

    Returns (transactions_list, detected_source) where source is "wechat" or "cc".
    """
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    ws = wb.active

    # Read all rows into a list of lists (same format as csv.reader output)
    all_rows = []
    for row in ws.iter_rows(values_only=True):
        all_rows.append([str(cell) if cell is not None else "" for cell in row])
    wb.close()

    if not all_rows:
        return [], "cc"

    # Check if this is a WeChat Pay xlsx
    flat_text = "\n".join(",".join(r) for r in all_rows[:25])
    is_wechat = _is_wechat_content(flat_text)

    if is_wechat:
        return _parse_wechat_rows(all_rows), "wechat"
    else:
        return _parse_cc_rows(all_rows), "cc"


def _is_wechat_content(text):
    """Check if text content looks like WeChat Pay bill."""
    markers = ["微信支付", "交易时间", "交易对方", "收/支", "金额"]
    found = sum(1 for m in markers if m in text)
    return found >= 3


def _parse_wechat_rows(all_rows):
    """Parse WeChat Pay transactions from row data (shared by CSV & XLSX)."""
    # Find header row
    header_idx = None
    for i, row in enumerate(all_rows):
        if any("交易时间" in str(c) for c in row):
            header_idx = i
            break
    if header_idx is None:
        return []

    header = [str(c).strip() for c in all_rows[header_idx]]

    # Map columns
    col_map = {}
    for j, h in enumerate(header):
        if "交易时间" in h:
            col_map["time"] = j
        elif "交易类型" in h:
            col_map["type"] = j
        elif "交易对方" in h:
            col_map["counterparty"] = j
        elif "商品" in h:
            col_map["product"] = j
        elif "收/支" in h:
            col_map["direction"] = j
        elif "金额" in h:
            col_map["amount"] = j
        elif "支付方式" in h:
            col_map["payment_method"] = j
        elif "当前状态" in h:
            col_map["status"] = j

    transactions = []
    for i in range(header_idx + 1, len(all_rows)):
        row = all_rows[i]
        if not any(str(c).strip() for c in row):
            continue
        if len(row) < len(header):
            row += [""] * (len(header) - len(row))

        raw_time = str(row[col_map.get("time", 0)]).strip()
        txn_type = str(row[col_map.get("type", 1)]).strip() if "type" in col_map else ""
        counterparty = str(row[col_map.get("counterparty", 2)]).strip() if "counterparty" in col_map else ""
        product = str(row[col_map.get("product", 3)]).strip() if "product" in col_map else ""
        direction = str(row[col_map.get("direction", 4)]).strip() if "direction" in col_map else ""
        raw_amt = str(row[col_map.get("amount", 5)]).strip() if "amount" in col_map else ""
        payment = str(row[col_map.get("payment_method", 6)]).strip() if "payment_method" in col_map else ""
        status = str(row[col_map.get("status", 7)]).strip() if "status" in col_map else ""

        if "支出" not in direction:
            continue
        if status and "支付成功" not in status and "已转账" not in status and "朋友已收钱" not in status:
            continue
        if txn_type in {"微信红包", "群收款"}:
            continue

        amt_cleaned = re.sub(r"[¥￥,\s]", "", raw_amt)
        try:
            parsed_amt = abs(float(amt_cleaned))
        except (ValueError, TypeError):
            continue
        if parsed_amt <= 0:
            continue

        parsed_date = None
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S", "%Y-%m-%d"):
            try:
                parsed_date = datetime.strptime(raw_time, fmt)
                break
            except ValueError:
                continue

        desc = counterparty
        if product and product != "/" and product != counterparty:
            desc = f"{counterparty} - {product}"

        transactions.append({
            "id": f"wx_{i}",
            "date": parsed_date.strftime("%d/%m/%Y") if parsed_date else raw_time[:10],
            "dateISO": parsed_date.isoformat() if parsed_date else "",
            "description": desc,
            "amount": round(parsed_amt, 2),
            "matched": False,
            "matchedInvoiceId": None,
            "detectedBank": "wechat_pay",
            "source": "wechat",
            "paymentMethod": payment,
            "originalCurrency": "CNY",
        })

    return transactions


def _parse_cc_rows(all_rows):
    """Parse bank CC statement from row data (for XLSX files)."""
    # Try bank-specific detection first
    bank = None
    header_idx = None

    for i, row in enumerate(all_rows):
        if not any(str(c).strip() for c in row):
            continue
        lower = [str(c).strip().lower() for c in row]
        has_date = any(k in lower for k in (
            "date", "transaction date", "txn date", "trans date", "posting date"
        ))
        has_amt = any(k in lower for k in (
            "amount", "amount (myr)", "debit", "debit amount", "amount(rm)", "amount (rm)",
            "transaction amount", "debit(rm)", "debit (rm)"
        ))
        if has_date or has_amt:
            bank = _detect_bank(row)
            header_idx = i
            break

    if bank and header_idx is not None:
        return _parse_bank_rows(all_rows, header_idx, BANK_PROFILES[bank], bank)

    # Fallback to generic
    return _parse_generic_rows(all_rows)


def _parse_bank_rows(all_rows, header_idx, profile, bank_name):
    """Parse bank-specific CC statement from row data."""
    header = [str(c).strip().lower() for c in all_rows[header_idx]]
    transactions = []

    date_idx = _find_col(header, profile["date_col"])
    desc_idx = _find_col(header, profile["desc_col"])
    amt_idx = _find_col(header, profile["amt_col"])

    if date_idx is None and amt_idx is None:
        return []

    for i in range(header_idx + 1, len(all_rows)):
        row = all_rows[i]
        if not any(str(c).strip() for c in row):
            continue
        if len(row) <= max(filter(None, [date_idx, desc_idx, amt_idx]), default=0):
            continue

        raw_date = str(row[date_idx]).strip() if date_idx is not None else ""
        raw_desc = str(row[desc_idx]).strip() if desc_idx is not None else ""
        raw_amt = str(row[amt_idx]).strip() if amt_idx is not None else ""

        if profile["amount_handler"] == "debit_only":
            if not raw_amt or raw_amt == "-":
                continue
            parsed_amt = _parse_amount(raw_amt)
            if parsed_amt is None or parsed_amt <= 0:
                continue
        else:
            parsed_amt = _parse_amount(raw_amt)
            if parsed_amt is None or parsed_amt <= 0:
                continue

        parsed_date = None
        for fmt in profile.get("date_formats", []):
            try:
                parsed_date = datetime.strptime(raw_date, fmt)
                break
            except ValueError:
                continue
        if not parsed_date:
            parsed_date = _parse_date(raw_date)

        transactions.append({
            "id": f"cc_{i}",
            "date": parsed_date.strftime("%d/%m/%Y") if parsed_date else raw_date,
            "dateISO": parsed_date.isoformat() if parsed_date else "",
            "description": raw_desc,
            "amount": round(parsed_amt, 2),
            "matched": False,
            "matchedInvoiceId": None,
            "detectedBank": bank_name,
        })

    return transactions


def _parse_generic_rows(all_rows):
    """Generic CC statement parser for row data."""
    date_keys = {"date", "transaction date", "txn date", "trans date", "posting date"}
    desc_keys = {"description", "merchant", "details", "narrative", "particulars", "transaction description"}
    amt_keys = {"amount", "amount (myr)", "debit", "debit amount", "amount(rm)", "amount (rm)", "transaction amount"}

    header = None
    col_map = {}
    transactions = []

    for i, row in enumerate(all_rows):
        if not any(str(c).strip() for c in row):
            continue

        if header is None:
            lower = [str(c).strip().lower() for c in row]
            found_date = any(k in lower for k in date_keys)
            found_amt = any(k in lower for k in amt_keys)
            if found_date or found_amt:
                header = lower
                for j, col in enumerate(header):
                    if col in date_keys:
                        col_map["date"] = j
                    elif col in desc_keys:
                        col_map["desc"] = j
                    elif col in amt_keys:
                        col_map["amt"] = j
                continue

        if header is None:
            continue
        if len(row) < max(col_map.values(), default=0) + 1:
            continue

        raw_date = str(row[col_map.get("date", 0)]).strip()
        raw_desc = str(row[col_map.get("desc", 1)]).strip() if "desc" in col_map else ""
        raw_amt = str(row[col_map.get("amt", 2)]).strip() if "amt" in col_map else ""

        parsed_date = _parse_date(raw_date)
        parsed_amt = _parse_amount(raw_amt)

        if parsed_amt is None or parsed_amt <= 0:
            continue

        transactions.append({
            "id": f"cc_{i}",
            "date": parsed_date.strftime("%d/%m/%Y") if parsed_date else raw_date,
            "dateISO": parsed_date.isoformat() if parsed_date else "",
            "description": raw_desc,
            "amount": round(parsed_amt, 2),
            "matched": False,
            "matchedInvoiceId": None,
            "detectedBank": "generic",
        })

    return transactions


# ── WeChat Pay CSV detection & parsing ────────────────────────────

def _is_wechat_csv(text):
    """Detect if the CSV text is a WeChat Pay bill export."""
    # WeChat bills start with metadata lines containing these markers
    markers = ["微信支付账单", "交易时间", "交易对方", "收/支", "金额"]
    found = 0
    for line in text.split("\n")[:25]:
        for m in markers:
            if m in line:
                found += 1
    return found >= 3


def parse_wechat_statement(file_bytes, filename=None):
    """Parse WeChat Pay bill CSV export.

    Decodes CSV to row data and delegates to _parse_wechat_rows().
    Returns list of transaction dicts compatible with CC reconciliation.
    """
    text = file_bytes.decode("utf-8-sig")
    all_rows = list(csv.reader(io.StringIO(text)))
    return _parse_wechat_rows(all_rows)


# ── Bank-specific CSV profiles for Malaysian banks ───────────────

BANK_PROFILES = {
    "maybank": {
        "detect": lambda headers: "transaction date" in headers and "posting date" in headers,
        "date_col": "transaction date",
        "desc_col": "transaction description",
        "amt_col": "transaction amount",
        "date_formats": ["%d/%m/%Y", "%d %b %Y", "%d-%m-%Y"],
        "amount_handler": "signed",
    },
    "cimb": {
        "detect": lambda headers: "txn date" in headers and any(
            h in headers for h in ("debit", "debit(rm)", "debit (rm)")
        ),
        "date_col": "txn date",
        "desc_col": "description",
        "amt_col": "debit",
        "date_formats": ["%d/%m/%Y", "%d-%m-%Y", "%d %b %Y"],
        "amount_handler": "debit_only",
    },
    "public_bank": {
        "detect": lambda headers: "details" in headers and "date" in headers and len(headers) <= 6,
        "date_col": "date",
        "desc_col": "details",
        "amt_col": "amount",
        "date_formats": ["%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y"],
        "amount_handler": "signed",
    },
    "rhb": {
        "detect": lambda headers: any(
            "amount (rm)" in h or "amount(rm)" in h for h in headers
        ),
        "date_col": "transaction date",
        "desc_col": "description",
        "amt_col": "amount (rm)",
        "date_formats": ["%d/%m/%Y", "%d %b %Y", "%d-%m-%Y"],
        "amount_handler": "signed",
    },
}


def _detect_bank(header_row):
    """Auto-detect bank from CSV header patterns. Returns bank key or None."""
    lower = [h.strip().lower() for h in header_row]
    for bank, profile in BANK_PROFILES.items():
        if profile["detect"](lower):
            return bank
    return None


# ── CSV Parsing ──────────────────────────────────────────────────

def parse_cc_statement(file_bytes, filename):
    """Parse a credit card or WeChat Pay statement CSV with auto-detection.

    Returns list of dicts: {id, date, dateISO, description, amount, matched, matchedInvoiceId}
    """
    text = file_bytes.decode("utf-8-sig")

    # Check for WeChat Pay format first (unique Chinese header structure)
    if _is_wechat_csv(text):
        return parse_wechat_statement(file_bytes, filename)

    all_rows = list(csv.reader(io.StringIO(text)))

    # Find header row and detect bank
    bank = None
    header_idx = None

    for i, row in enumerate(all_rows):
        if not any(cell.strip() for cell in row):
            continue
        lower = [c.strip().lower() for c in row]
        has_date = any(k in lower for k in (
            "date", "transaction date", "txn date", "trans date", "posting date"
        ))
        has_amt = any(k in lower for k in (
            "amount", "amount (myr)", "debit", "debit amount", "amount(rm)", "amount (rm)",
            "transaction amount", "debit(rm)", "debit (rm)"
        ))
        if has_date or has_amt:
            bank = _detect_bank(row)
            header_idx = i
            break

    if bank and header_idx is not None:
        return _parse_bank_specific(all_rows, header_idx, BANK_PROFILES[bank], bank)

    # Fallback to generic parser
    return _parse_generic(all_rows)


def _parse_bank_specific(all_rows, header_idx, profile, bank_name):
    """Parse using a bank-specific profile (delegates to _parse_bank_rows)."""
    return _parse_bank_rows(all_rows, header_idx, profile, bank_name)


def _parse_generic(all_rows):
    """Generic parser with flexible header matching (original logic)."""
    date_keys = {"date", "transaction date", "txn date", "trans date", "posting date"}
    desc_keys = {"description", "merchant", "details", "narrative", "particulars", "transaction description"}
    amt_keys = {"amount", "amount (myr)", "debit", "debit amount", "amount(rm)", "amount (rm)", "transaction amount"}

    header = None
    col_map = {}
    transactions = []

    for i, row in enumerate(all_rows):
        if not any(cell.strip() for cell in row):
            continue

        if header is None:
            lower = [c.strip().lower() for c in row]
            found_date = any(k in lower for k in date_keys)
            found_amt = any(k in lower for k in amt_keys)
            if found_date or found_amt:
                header = lower
                for j, col in enumerate(header):
                    if col in date_keys:
                        col_map["date"] = j
                    elif col in desc_keys:
                        col_map["desc"] = j
                    elif col in amt_keys:
                        col_map["amt"] = j
                continue

        if header is None:
            continue
        if len(row) < max(col_map.values(), default=0) + 1:
            continue

        raw_date = row[col_map.get("date", 0)].strip()
        raw_desc = row[col_map.get("desc", 1)].strip() if "desc" in col_map else ""
        raw_amt = row[col_map.get("amt", 2)].strip() if "amt" in col_map else ""

        parsed_date = _parse_date(raw_date)
        parsed_amt = _parse_amount(raw_amt)

        if parsed_amt is None or parsed_amt <= 0:
            continue

        transactions.append({
            "id": f"cc_{i}",
            "date": parsed_date.strftime("%d/%m/%Y") if parsed_date else raw_date,
            "dateISO": parsed_date.isoformat() if parsed_date else "",
            "description": raw_desc,
            "amount": round(parsed_amt, 2),
            "matched": False,
            "matchedInvoiceId": None,
            "detectedBank": "generic",
        })

    return transactions


def _find_col(header, col_name):
    """Find a column index in header, with fuzzy matching."""
    col_name = col_name.strip().lower()
    for i, h in enumerate(header):
        if h == col_name:
            return i
    # Partial match fallback
    for i, h in enumerate(header):
        if col_name in h or h in col_name:
            return i
    return None


# ── Matching Algorithm ───────────────────────────────────────────

def match_transactions(invoices, cc_transactions, date_tolerance=7, amount_tolerance_pct=10, cross_ref_pairs=None):
    """Match CC/WeChat transactions to invoices.

    Scoring:
      - Amount closeness (40%): how close the amounts are
      - Date proximity (30%): within date_tolerance days
      - Name similarity (30%): merchant name vs supplier name

    For WeChat Pay transactions (CNY): compare against original amount in CNY first,
    then fall back to MYR amount.

    Returns list of match groups:
      {ccId, candidates: [{invoiceId, score, amountDiff, dateDiff, actualRate}]}
    """
    # Build cross-ref lookup: paired WeChat txns share info with CC txns
    paired_wx_ids = set()   # WeChat txns to skip (already represented by CC side)
    cc_wx_partner = {}      # ccId -> WeChat txn data (for enhanced matching)
    if cross_ref_pairs:
        wx_by_id = {t.get("id"): t for t in cc_transactions if t.get("source") == "wechat"}
        for pair in cross_ref_pairs:
            wx_id = pair.get("wxId")
            cc_id = pair.get("ccId")
            if wx_id:
                paired_wx_ids.add(wx_id)
            if wx_id and cc_id and wx_id in wx_by_id:
                cc_wx_partner[cc_id] = wx_by_id[wx_id]

    results = []

    for cc in cc_transactions:
        cc_amt = cc.get("amount", 0)
        cc_date = _parse_date(cc.get("date", ""))
        cc_desc = cc.get("description", "").upper()
        cc_source = cc.get("source", "cc")
        cc_currency = cc.get("originalCurrency", "MYR")  # WeChat txns are CNY
        cc_id = cc.get("id")

        # Skip WeChat txns that are already paired with a CC txn (avoid duplicates)
        if cc_id in paired_wx_ids:
            continue

        # If this CC txn has a WeChat partner, get partner data for enhanced matching
        wx_partner = cc_wx_partner.get(cc_id)

        candidates = []
        for inv in invoices:
            inv_myr = _safe_float(inv.get("amount", 0))
            orig_amt = _safe_float(inv.get("originalAmount", 0))
            orig_cur = inv.get("originalCurrency", "MYR")
            inv_date = _parse_date(inv.get("invoiceDate", ""))
            inv_supplier = (inv.get("supplierName", "") or "").upper()

            # Skip already-matched invoices
            if inv.get("ccMatched"):
                continue

            # ── Amount score (40%) ──
            # For WeChat Pay (CNY) transactions: compare against original CNY amount if available
            compare_amt = inv_myr  # default: compare against MYR amount
            if cc_source == "wechat" and cc_currency == "CNY":
                if orig_cur == "CNY" and orig_amt > 0:
                    compare_amt = orig_amt  # compare CNY to CNY directly
                elif inv_myr <= 0:
                    continue
            elif inv_myr <= 0:
                continue

            if compare_amt <= 0:
                continue

            amt_diff = abs(cc_amt - compare_amt)
            pct_diff = (amt_diff / compare_amt * 100) if compare_amt else 100
            if pct_diff > amount_tolerance_pct:
                amount_score = 0
            else:
                amount_score = max(0, 1 - pct_diff / amount_tolerance_pct)

            # Cross-ref enhanced: also try WeChat CNY amount if partner exists
            if wx_partner and amount_score < 0.5:
                wx_amt_cny = wx_partner.get("amount", 0)
                if wx_amt_cny > 0 and orig_cur == "CNY" and orig_amt > 0:
                    wx_diff = abs(wx_amt_cny - orig_amt)
                    wx_pct = (wx_diff / orig_amt * 100) if orig_amt else 100
                    if wx_pct <= amount_tolerance_pct:
                        wx_score = max(0, 1 - wx_pct / amount_tolerance_pct)
                        if wx_score > amount_score:
                            amount_score = wx_score
                            amt_diff = wx_diff
                            compare_amt = orig_amt

            # ── Date score (30%) ──
            date_score = 0
            day_diff = None
            if cc_date and inv_date:
                day_diff = abs((cc_date - inv_date).days)
                if day_diff <= date_tolerance:
                    date_score = max(0, 1 - day_diff / date_tolerance)

            # ── Name score (30%) ──
            name_score = _name_similarity(cc_desc, inv_supplier)

            # Cross-ref enhanced: also try WeChat Chinese description
            if wx_partner:
                wx_desc = (wx_partner.get("description", "") or "").upper()
                if wx_desc:
                    wx_name_score = _name_similarity(wx_desc, inv_supplier)
                    name_score = max(name_score, wx_name_score)

            total = amount_score * 0.4 + date_score * 0.3 + name_score * 0.3
            if total < 0.15:
                continue

            # Calculate actual exchange rate for foreign currency
            actual_rate = None
            if orig_cur != "MYR" and orig_amt and orig_amt > 0:
                if cc_source == "wechat" and cc_currency == "CNY" and orig_cur == "CNY":
                    # WeChat CNY matched to CNY invoice — no rate needed
                    actual_rate = None
                else:
                    actual_rate = round(cc_amt / orig_amt, 4)

            candidates.append({
                "invoiceId": inv.get("id"),
                "supplierName": inv.get("supplierName", ""),
                "invoiceNo": inv.get("invoiceNo", ""),
                "invoiceAmount": inv_myr,
                "originalAmount": orig_amt,
                "originalCurrency": orig_cur,
                "score": round(total, 3),
                "amountDiff": round(amt_diff, 2),
                "dateDiff": day_diff,
                "actualRate": actual_rate,
                "matchCurrency": cc_currency if cc_source == "wechat" else "MYR",
            })

        candidates.sort(key=lambda x: x["score"], reverse=True)
        results.append({
            "ccId": cc.get("id"),
            "ccDate": cc.get("date"),
            "ccDescription": cc.get("description"),
            "ccAmount": cc_amt,
            "ccSource": cc_source,
            "ccCurrency": cc_currency,
            "candidates": candidates[:5],
        })

    return results


# ── Cross-Reference: WeChat ↔ CC Statement Pairing ─────────────

# Keywords in CC description that indicate a WeChat-sourced transaction
_WEIXIN_KEYWORDS = {"WEIXIN", "WECHAT", "TENPAY", "WX", "BEA WEIXIN"}


def cross_reference_statements(wechat_txns, cc_txns, exchange_rate=None, date_tolerance=3):
    """Cross-reference WeChat (CNY) and CC (MYR) transactions to find same purchases.

    When a user pays via WeChat linked to a credit card, the same purchase
    appears in both statements with different currencies and merchant names.

    Scoring: rate_consistency(40%) + date(35%) + desc_keyword(25%)

    Returns:
        dict with keys: pairs, unmatchedWx, unmatchedCc, avgRate
    """
    if not wechat_txns or not cc_txns:
        return {"pairs": [], "unmatchedWx": [t.get("id") for t in wechat_txns],
                "unmatchedCc": [t.get("id") for t in cc_txns], "avgRate": None}

    # Step 1: Compute all candidate pairs with implied rates
    candidates = []
    for wx in wechat_txns:
        wx_amt = wx.get("amount", 0)
        wx_date = _parse_date(wx.get("date", ""))
        if not wx_amt or wx_amt <= 0:
            continue
        for cc in cc_txns:
            cc_amt = cc.get("amount", 0)
            cc_date = _parse_date(cc.get("date", ""))
            if not cc_amt or cc_amt <= 0:
                continue

            implied_rate = cc_amt / wx_amt

            # Date score (35%): within date_tolerance days
            date_score = 0
            if wx_date and cc_date:
                day_diff = abs((cc_date - wx_date).days)
                if day_diff <= date_tolerance:
                    date_score = max(0, 1 - day_diff / date_tolerance)
                else:
                    continue  # Skip if dates too far apart

            # Description keyword score (25%): CC desc contains WeChat markers
            cc_desc_upper = (cc.get("description", "") or "").upper()
            kw_score = 0
            for kw in _WEIXIN_KEYWORDS:
                if kw in cc_desc_upper:
                    kw_score = 1.0
                    break

            candidates.append({
                "wxId": wx.get("id"),
                "ccId": cc.get("id"),
                "impliedRate": round(implied_rate, 6),
                "dateScore": date_score,
                "kwScore": kw_score,
                "wxAmt": wx_amt,
                "ccAmt": cc_amt,
            })

    if not candidates:
        return {"pairs": [], "unmatchedWx": [t.get("id") for t in wechat_txns],
                "unmatchedCc": [t.get("id") for t in cc_txns], "avgRate": None}

    # Step 2: Determine reference exchange rate
    ref_rate = exchange_rate
    if not ref_rate:
        # Use median implied rate from candidates with WeChat keywords as reference
        kw_rates = [c["impliedRate"] for c in candidates if c["kwScore"] > 0]
        if not kw_rates:
            kw_rates = [c["impliedRate"] for c in candidates]
        kw_rates.sort()
        if kw_rates:
            mid = len(kw_rates) // 2
            ref_rate = kw_rates[mid]

    if not ref_rate or ref_rate <= 0:
        return {"pairs": [], "unmatchedWx": [t.get("id") for t in wechat_txns],
                "unmatchedCc": [t.get("id") for t in cc_txns], "avgRate": None}

    # Step 3: Score all candidates with rate consistency
    rate_tolerance = 0.05  # 5% deviation allowed
    for c in candidates:
        rate_dev = abs(c["impliedRate"] - ref_rate) / ref_rate
        if rate_dev > rate_tolerance:
            c["rateScore"] = 0
        else:
            c["rateScore"] = max(0, 1 - rate_dev / rate_tolerance)
        # Hard veto: if rate deviates > 50%, skip regardless of other signals
        if rate_dev > 0.5:
            c["score"] = 0
        else:
            c["score"] = round(c["rateScore"] * 0.4 + c["dateScore"] * 0.35 + c["kwScore"] * 0.25, 4)

    # Step 4: Greedy one-to-one assignment (highest score first)
    candidates.sort(key=lambda x: x["score"], reverse=True)
    used_wx = set()
    used_cc = set()
    pairs = []
    min_threshold = 0.3

    for c in candidates:
        if c["score"] < min_threshold:
            break
        if c["wxId"] in used_wx or c["ccId"] in used_cc:
            continue
        pairs.append({
            "wxId": c["wxId"],
            "ccId": c["ccId"],
            "score": c["score"],
            "impliedRate": c["impliedRate"],
        })
        used_wx.add(c["wxId"])
        used_cc.add(c["ccId"])

    # Compute average rate from matched pairs
    avg_rate = None
    if pairs:
        avg_rate = round(sum(p["impliedRate"] for p in pairs) / len(pairs), 4)

    unmatched_wx = [t.get("id") for t in wechat_txns if t.get("id") not in used_wx]
    unmatched_cc = [t.get("id") for t in cc_txns if t.get("id") not in used_cc]

    return {"pairs": pairs, "unmatchedWx": unmatched_wx,
            "unmatchedCc": unmatched_cc, "avgRate": avg_rate}


# ── Helpers ──────────────────────────────────────────────────────

def _parse_date(s):
    """Try common date formats and return a datetime or None."""
    if not s:
        return None
    s = s.strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%d %b %Y", "%d/%m/%y", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S", "%d/%m/%Y %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _parse_amount(s):
    """Extract a numeric amount from a string like 'RM 1,234.56' or '-123.45'."""
    if not s:
        return None
    cleaned = re.sub(r"[^\d.\-]", "", s.replace(",", ""))
    # Handle European-style thousands dots (e.g. 1.234.56 -> 1234.56)
    if cleaned.count(".") > 1:
        parts = cleaned.rsplit(".", 1)
        cleaned = parts[0].replace(".", "") + "." + parts[1]
    try:
        return abs(float(cleaned))
    except (ValueError, TypeError):
        return None


def _safe_float(v):
    """Safely convert a value to float."""
    try:
        return float(str(v).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0


def _name_similarity(a, b):
    """Simple word-overlap similarity between two strings."""
    if not a or not b:
        return 0
    words_a = set(re.findall(r"[A-Z0-9]{2,}", a))
    words_b = set(re.findall(r"[A-Z0-9]{2,}", b))
    if not words_a or not words_b:
        return 0
    overlap = len(words_a & words_b)
    return overlap / max(len(words_a), len(words_b))


# ── Ledger Dedup / Merge ────────────────────────────────────────

def compute_fingerprint(txn):
    """Create a dedup fingerprint from transaction date, amount, and description.

    Two transactions with the same fingerprint are considered duplicates.
    """
    date_part = (txn.get("dateISO") or "")[:10]  # date portion only
    amount = f"{float(txn.get('amount', 0)):.2f}"
    raw_desc = txn.get("description", "")
    # Normalize: lowercase, collapse whitespace, strip punctuation edges
    desc = re.sub(r"\s+", " ", raw_desc.lower().strip())
    return f"{date_part}|{amount}|{desc}"


def generate_stable_id(txn, seq=0):
    """Generate a globally-unique, human-readable ID for a ledger transaction.

    Format: {prefix}_{bank}_{dateYYYYMMDD}_{seq}_{hash4}
    Example: cc_mbb_20241215_0_a1b2, wx_20241215_3_c3d4
    """
    import hashlib
    source = txn.get("source", "cc")
    prefix = "wx" if source == "wechat" else "cc"
    bank_raw = txn.get("detectedBank", "unk") or "unk"
    # Abbreviate bank name: first 3 letters of first word
    bank = re.sub(r"[^a-z0-9]", "", bank_raw.lower())[:6] or "unk"
    date_part = (txn.get("dateISO") or "")[:10].replace("-", "")
    fp = compute_fingerprint(txn)
    h = hashlib.md5(fp.encode()).hexdigest()[:4]
    return f"{prefix}_{bank}_{date_part}_{seq}_{h}"


def merge_transactions(existing_txns, new_txns):
    """Merge new transactions into an existing ledger list, deduplicating by fingerprint.

    Returns (merged_list, added_count, dup_count).
    New transactions get stable IDs and fingerprints assigned.
    """
    existing_fps = set()
    existing_ids = set()
    for t in existing_txns:
        fp = t.get("fingerprint") or compute_fingerprint(t)
        t["fingerprint"] = fp
        existing_fps.add(fp)
        existing_ids.add(t.get("id", ""))

    added = []
    dups = 0
    seq = len(existing_txns)
    for t in new_txns:
        fp = compute_fingerprint(t)
        if fp in existing_fps:
            dups += 1
            continue
        existing_fps.add(fp)
        t["fingerprint"] = fp
        # Generate a new stable ID
        new_id = generate_stable_id(t, seq)
        while new_id in existing_ids:
            seq += 1
            new_id = generate_stable_id(t, seq)
        t["id"] = new_id
        existing_ids.add(new_id)
        added.append(t)
        seq += 1

    return existing_txns + added, len(added), dups
