"""Anthropic Claude API call for invoice data extraction.

Optimizations (2026-03):
- Configurable models: Haiku for single invoices, Sonnet for statements
- tool_use for guaranteed structured JSON output (invoices)
- Image resolution optimization to reduce vision token cost
- Token usage logging and truncation detection
- Field-level validation on extraction results
- Robust error handling: safe JSON parsing, retryable 500/503, request-id logging
- Strengthened prompts to reduce hallucination risk
"""

import io
import json
import logging
import re
import time
import base64

import requests as req_lib
from PIL import Image

from config import load_cfg

logger = logging.getLogger("invoice_reader")

# ── Model defaults (overridable via config) ──────────────────────

MODEL_INVOICE = "claude-haiku-4-5-20251001"     # Single invoice: simple extraction
MODEL_STATEMENT = "claude-sonnet-4-20250514"    # Statements: complex multi-transaction

VALID_CURRENCIES = ("USD", "CNY", "MYR", "SGD", "EUR", "GBP")

CATEGORIES = (
    "Advertisement", "Design Service", "Equipment", "Event", "HR",
    "Maintenance", "Marketing", "Operation", "Others", "Purchasing",
    "Recruitment", "Renovation", "Sanitary", "Service", "Shipping",
    "Staff Welfare", "Stationary", "Subscription", "Telco", "Welfare",
)


def _get_model(kind="invoice"):
    """Return model ID, allowing user override via config."""
    cfg = load_cfg()
    if kind == "invoice":
        return cfg.get("model_invoice", MODEL_INVOICE)
    return cfg.get("model_statement", MODEL_STATEMENT)


# ── System prompt (shared for free-text fallback) ────────────────

SYSTEM_PROMPT = """You are an expert invoice/receipt data extractor for a Malaysian company (Optimum Group: Optimum Fit gym & Optimum Swim School).

Extract data and return ONLY a valid JSON object:
{
  "supplierName": "exact vendor name in UPPERCASE",
  "invoiceNo": "invoice or receipt number",
  "invoiceDate": "date in DD/MM/YYYY format, use - if not found",
  "amount": "the FINAL TOTAL amount the buyer must pay, as number string only e.g. 1234.56, NO currency symbols",
  "currency": "3-letter ISO code: USD, CNY, MYR, SGD, EUR, GBP. Detect from symbols ($=USD, ¥=CNY, RM=MYR, S$=SGD, €=EUR, £=GBP) or explicit text. If $ appears without country prefix: use MYR for Malaysian supplier, SGD for Singaporean supplier. Default MYR when uncertain.",
  "suggestedCategory": "best match from the predefined list. Use 'Others' if uncertain.",
  "suggestedDescription": "concise description like: FB ads, Center internet service, Gym equipment. Do NOT include currency info here.",
  "address": "the billing or delivery address on the invoice (customer/buyer address, NOT supplier address), or empty string if not visible"
}

CRITICAL RULES for amount:
- For Chinese invoices (发票): ALWAYS use 价税合计 (total including tax, 小写 amount), NEVER use 金额 (subtotal before tax) or 合计 (subtotal). The 价税合计 is the actual total the buyer pays and is usually the LARGEST number near the bottom of the invoice.
- For Malaysian telco bills (Maxis, Celcomdigi, Digi, TM, Unifi, Time): use the CURRENT MONTH total charges / total charges for this billing period, NOT the total outstanding amount or total amount due. The outstanding amount often includes credits from previous overpayments, making it LESS than the actual current month charges.
- For all other invoices: use the grand total / total payable, NOT subtotals or line item amounts.
- If there is tax/GST/SST, the amount should INCLUDE tax.

CRITICAL RULES for date:
- ONLY use the invoice/receipt issue date printed on the document.
- If no clear issue date is visible, return '-'. Do NOT guess or infer dates from due dates, print dates, or other dates.

Return ONLY JSON. No markdown. No explanation."""


# ── tool_use schema for invoice extraction ───────────────────────

INVOICE_TOOL = {
    "name": "record_invoice",
    "description": "Record the extracted invoice data from the document.",
    "input_schema": {
        "type": "object",
        "properties": {
            "supplierName": {
                "type": "string",
                "description": "Exact vendor name in UPPERCASE",
            },
            "invoiceNo": {
                "type": "string",
                "description": "Invoice or receipt number",
            },
            "invoiceDate": {
                "type": "string",
                "description": "Date in DD/MM/YYYY format, or '-' if not found",
            },
            "amount": {
                "type": "string",
                "description": "Final total amount as number string e.g. 1234.56, no currency symbols",
            },
            "currency": {
                "type": "string",
                "enum": list(VALID_CURRENCIES),
                "description": "3-letter ISO currency code",
            },
            "suggestedCategory": {
                "type": "string",
                "enum": list(CATEGORIES),
                "description": "Best matching expense category",
            },
            "suggestedDescription": {
                "type": "string",
                "description": "Concise description of the expense, no currency info",
            },
            "address": {
                "type": "string",
                "description": "Billing/delivery address (buyer address, NOT supplier), or empty string",
            },
        },
        "required": [
            "supplierName", "invoiceNo", "invoiceDate", "amount",
            "currency", "suggestedCategory", "suggestedDescription", "address",
        ],
    },
}


# ── Image optimization ───────────────────────────────────────────

def _optimize_image(file_bytes, max_dim=2048):
    """Downscale large images to reduce vision token cost."""
    try:
        img = Image.open(io.BytesIO(file_bytes))
        if max(img.size) <= max_dim:
            return file_bytes  # already small enough
        orig_w, orig_h = img.size
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)
        buf = io.BytesIO()
        fmt = img.format or "JPEG"
        save_kwargs = {"quality": 85}
        if fmt.upper() in ("JPEG", "JPG"):
            fmt = "JPEG"
        img.save(buf, format=fmt, **save_kwargs)
        logger.info(
            "Image optimized: %dx%d -> %dx%d (%.0fKB -> %.0fKB)",
            orig_w, orig_h, img.size[0], img.size[1],
            len(file_bytes) / 1024, buf.tell() / 1024,
        )
        return buf.getvalue()
    except Exception as e:
        logger.debug("Image optimization skipped: %s", e)
        return file_bytes


# ── API call with retry ──────────────────────────────────────────

RETRYABLE_STATUSES = (429, 500, 503, 529)


def _safe_error_msg(resp):
    """Extract error message from API response, handling non-JSON bodies."""
    request_id = resp.headers.get("request-id", "unknown")
    try:
        err_data = resp.json()
        msg = err_data.get("error", {}).get("message", str(err_data))
    except (json.JSONDecodeError, ValueError):
        msg = resp.text[:500]
    return f"API error {resp.status_code}: {msg} [request-id: {request_id}]"


def _log_usage(data, label=""):
    """Log token usage from API response."""
    usage = data.get("usage", {})
    input_t = usage.get("input_tokens", 0)
    output_t = usage.get("output_tokens", 0)
    cache_read = usage.get("cache_read_input_tokens", 0)
    cache_create = usage.get("cache_creation_input_tokens", 0)
    logger.info(
        "API usage%s: input=%d (cache_read=%d cache_create=%d) output=%d",
        f" [{label}]" if label else "",
        input_t, cache_read, cache_create, output_t,
    )
    return usage


def _check_truncation(data, label=""):
    """Warn if response was truncated at max_tokens."""
    if data.get("stop_reason") == "max_tokens":
        logger.warning(
            "AI response truncated at max_tokens%s",
            f" [{label}]" if label else "",
        )
        return True
    return False


def _api_call_with_retry(api_key, json_body, timeout=60, max_retries=3):
    """POST to Anthropic API with exponential backoff on retryable errors."""
    headers = {
        "Content-Type": "application/json",
        "x-api-key": api_key,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31",
    }
    last_resp = None
    for attempt in range(max_retries + 1):
        try:
            resp = req_lib.post(
                "https://api.anthropic.com/v1/messages",
                headers=headers, json=json_body, timeout=timeout,
            )
            last_resp = resp
            if resp.status_code in RETRYABLE_STATUSES and attempt < max_retries:
                retry_after = int(resp.headers.get("retry-after", 2 ** (attempt + 1)))
                logger.warning(
                    "API %d (attempt %d/%d), retry in %ds [request-id: %s]",
                    resp.status_code, attempt + 1, max_retries,
                    min(retry_after, 30),
                    resp.headers.get("request-id", "unknown"),
                )
                time.sleep(min(retry_after, 30))
                continue
            return resp
        except (req_lib.exceptions.Timeout, req_lib.exceptions.ConnectionError) as e:
            logger.warning("API network error (attempt %d/%d): %s", attempt + 1, max_retries, e)
            if attempt < max_retries:
                time.sleep(2 ** (attempt + 1))
                continue
            raise
    return last_resp


# ── JSON parsing helpers ─────────────────────────────────────────

def _parse_json_object(text):
    """Parse a JSON object, with fallback for malformed AI responses."""
    text = text.replace("```json", "").replace("```", "").strip()
    # Try direct parse first
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    # Try to find a {...} block (handle nested braces)
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError:
                    start = -1

    # Try adding closing brace for truncated responses
    if start >= 0:
        for suffix in ('}', '"}', '""}'):
            try:
                return json.loads(text[start:] + suffix)
            except json.JSONDecodeError:
                continue

    raise ValueError(f"无法解析 AI 返回的 JSON 数据（长度 {len(text)}）")


def _parse_json_array(text):
    """Parse a JSON array, with fallback for truncated responses."""
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # If truncated, try to repair: find all complete {...} objects (handles nested braces)
    objects = []
    depth = 0
    start = -1
    for i, ch in enumerate(text):
        if ch == '{':
            if depth == 0:
                start = i
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0 and start >= 0:
                try:
                    obj = json.loads(text[start:i + 1])
                    if isinstance(obj, dict) and ("date" in obj or "description" in obj or "amount" in obj):
                        objects.append(obj)
                except json.JSONDecodeError:
                    pass
                start = -1

    if objects:
        return objects

    # Last resort: try adding closing bracket
    for suffix in (']', '"}]', '"}]', '}]'):
        try:
            return json.loads(text + suffix)
        except json.JSONDecodeError:
            continue

    raise ValueError(f"无法解析 AI 返回的 JSON 数据（长度 {len(text)}）")


# ── Field-level validation ───────────────────────────────────────

_DATE_RE = re.compile(r'^\d{2}/\d{2}/\d{4}$')


def _validate_invoice_data(parsed):
    """Validate and sanitize extracted invoice fields. Returns cleaned data."""
    warnings = []

    # Amount: must be a valid number
    amt_raw = parsed.get("amount", "")
    try:
        amt_val = float(str(amt_raw).replace(",", "").strip())
        parsed["amount"] = f"{amt_val:.2f}"
    except (ValueError, TypeError):
        warnings.append(f"Invalid amount: {amt_raw}")

    # Date: must be DD/MM/YYYY or '-'
    date_raw = parsed.get("invoiceDate", "")
    if date_raw and date_raw != "-":
        if not _DATE_RE.match(date_raw):
            parsed["invoiceDateRaw"] = date_raw
            warnings.append(f"Non-standard date format: {date_raw}")

    # Currency: must be in allowed set
    currency = parsed.get("currency", "")
    if currency and currency not in VALID_CURRENCIES:
        warnings.append(f"Unknown currency '{currency}', defaulting to MYR")
        parsed["currency"] = "MYR"

    # Category: must be in allowed set
    cat = parsed.get("suggestedCategory", "")
    if cat and cat not in CATEGORIES:
        warnings.append(f"Unknown category '{cat}', defaulting to Others")
        parsed["suggestedCategory"] = "Others"

    # Supplier name should not be empty
    if not parsed.get("supplierName", "").strip():
        warnings.append("Empty supplier name")

    if warnings:
        logger.warning("Invoice validation warnings: %s", "; ".join(warnings))
        parsed["_validationWarnings"] = warnings

    return parsed


# ── Content block builder ────────────────────────────────────────

def _build_content_block(file_bytes, mime_type):
    """Build API content block for image or PDF, with image optimization."""
    is_pdf = "pdf" in mime_type
    if not is_pdf:
        file_bytes = _optimize_image(file_bytes)
    b64 = base64.b64encode(file_bytes).decode()

    if is_pdf:
        return {"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}
    return {"type": "image", "source": {"type": "base64", "media_type": mime_type, "data": b64}}


# ── Invoice extraction (tool_use) ───────────────────────────────

def extract_invoice(api_key, file_bytes, mime_type):
    """Send an invoice image/PDF to Claude and return extracted data.

    Uses tool_use for guaranteed structured JSON output.
    Falls back to free-text JSON parsing if tool_use fails.
    """
    content_block = _build_content_block(file_bytes, mime_type)
    model = _get_model("invoice")

    # Primary: tool_use for guaranteed structured output
    resp = _api_call_with_retry(api_key, {
        "model": model,
        "max_tokens": 1000,
        "system": [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        "tools": [INVOICE_TOOL],
        "tool_choice": {"type": "tool", "name": "record_invoice"},
        "messages": [
            {
                "role": "user",
                "content": [
                    content_block,
                    {"type": "text", "text": "Extract the invoice data."},
                ],
            }
        ],
    }, timeout=90)

    if resp.status_code != 200:
        return {"ok": False, "error": _safe_error_msg(resp)}

    data = resp.json()
    _log_usage(data, f"invoice/{model}")
    _check_truncation(data, "invoice")

    # Extract from tool_use response
    for block in data.get("content", []):
        if block.get("type") == "tool_use" and block.get("name") == "record_invoice":
            parsed = block.get("input", {})
            parsed = _validate_invoice_data(parsed)
            return {"ok": True, "data": parsed}

    # Fallback: try text block (in case tool_use wasn't used)
    text = ""
    for block in data.get("content", []):
        if block.get("type") == "text":
            text = block["text"]
            break

    if text:
        try:
            parsed = _parse_json_object(text)
            parsed = _validate_invoice_data(parsed)
            return {"ok": True, "data": parsed}
        except (json.JSONDecodeError, ValueError) as e:
            return {"ok": False, "error": f"AI 返回的数据格式异常: {str(e)[:200]}"}

    return {"ok": False, "error": "AI 未返回任何可解析的数据"}


# ── CC Statement PDF extraction ──────────────────────────────────

CC_STATEMENT_PROMPT = """You are an expert at reading credit card / bank statements.

Extract ALL debit transactions (purchases/charges) from this statement.
Return ONLY a valid JSON array of objects:
[
  {
    "date": "DD/MM/YYYY",
    "description": "merchant or transaction description",
    "amount": 123.45
  }
]

Rules:
- Only include DEBIT / purchase transactions (money spent), skip payments/credits/refunds
- amount must be a positive number (no currency symbols)
- date must be DD/MM/YYYY format — ONLY use the transaction date printed on the statement
- description should be the merchant/payee name, cleaned up
- Return ONLY the JSON array. No markdown. No explanation."""


def extract_cc_statement(api_key, file_bytes, mime_type):
    """Send a CC statement PDF/image to Claude and return extracted transactions."""
    content_block = _build_content_block(file_bytes, mime_type)
    model = _get_model("statement")

    resp = _api_call_with_retry(api_key, {
        "model": model,
        "max_tokens": 16000,
        "system": [{"type": "text", "text": CC_STATEMENT_PROMPT, "cache_control": {"type": "ephemeral"}}],
        "messages": [
            {
                "role": "user",
                "content": [
                    content_block,
                    {"type": "text", "text": "Extract all debit transactions as a JSON array."},
                ],
            }
        ],
    }, timeout=90)

    if resp.status_code != 200:
        return {"ok": False, "error": _safe_error_msg(resp)}

    data = resp.json()
    _log_usage(data, f"cc_statement/{model}")
    truncated = _check_truncation(data, "cc_statement")

    text = ""
    for block in data.get("content", []):
        if block.get("type") == "text":
            text = block["text"]
            break

    text = text.replace("```json", "").replace("```", "").strip()
    transactions = _parse_json_array(text)

    # Normalize into the same format as CSV-parsed transactions
    result = []
    for i, txn in enumerate(transactions):
        amt = txn.get("amount", 0)
        if isinstance(amt, str):
            try:
                amt = float(amt.replace(",", "").strip())
            except (ValueError, TypeError):
                continue
        if amt <= 0:
            continue

        date_val = txn.get("date", "")
        if date_val and date_val != "-" and not _DATE_RE.match(date_val):
            logger.warning("CC txn non-standard date: %s", date_val)

        result.append({
            "id": f"cc_{i}",
            "date": date_val,
            "dateISO": "",
            "description": txn.get("description", ""),
            "amount": round(amt, 2),
            "matched": False,
            "matchedInvoiceId": None,
        })

    if truncated:
        logger.warning("CC statement extraction truncated — %d transactions recovered", len(result))

    return {"ok": True, "transactions": result}


# ── WeChat Pay PDF/Screenshot extraction ─────────────────────────

WECHAT_STATEMENT_PROMPT = """You are an expert at reading WeChat Pay (微信支付) transaction bills and screenshots.

Extract ALL expense/payment transactions from this WeChat Pay bill.
Return ONLY a valid JSON array of objects:
[
  {
    "date": "DD/MM/YYYY",
    "description": "the counterparty/merchant name (交易对方)",
    "product": "the product/goods description (商品) if visible, or empty string",
    "amount": 123.45,
    "paymentMethod": "the payment method (支付方式) e.g. 招商银行信用卡(1234), or empty string",
    "currency": "CNY"
  }
]

Rules:
- Only include EXPENSE transactions (支出), skip income (收入), refunds (退款), and red packets (红包)
- amount must be a positive number (no ¥ symbol)
- date must be DD/MM/YYYY format — ONLY use the transaction date printed in the bill
- description should be the merchant/counterparty name (交易对方), cleaned up
- If there's a product name (商品), include it separately
- Include the payment method (支付方式) if visible — this tells which credit card was used
- Return ONLY the JSON array. No markdown. No explanation."""


def extract_wechat_statement(api_key, file_bytes, mime_type):
    """Send a WeChat Pay statement PDF/image to Claude and return extracted transactions."""
    content_block = _build_content_block(file_bytes, mime_type)
    model = _get_model("statement")

    resp = _api_call_with_retry(api_key, {
        "model": model,
        "max_tokens": 16000,
        "system": [{"type": "text", "text": WECHAT_STATEMENT_PROMPT, "cache_control": {"type": "ephemeral"}}],
        "messages": [
            {
                "role": "user",
                "content": [
                    content_block,
                    {"type": "text", "text": "Extract all WeChat Pay expense transactions as a JSON array."},
                ],
            }
        ],
    }, timeout=90)

    if resp.status_code != 200:
        return {"ok": False, "error": _safe_error_msg(resp)}

    data = resp.json()
    _log_usage(data, f"wechat_statement/{model}")
    truncated = _check_truncation(data, "wechat_statement")

    text = ""
    for block in data.get("content", []):
        if block.get("type") == "text":
            text = block["text"]
            break

    text = text.replace("```json", "").replace("```", "").strip()
    transactions = _parse_json_array(text)

    # Normalize into reconciliation format
    result = []
    for i, txn in enumerate(transactions):
        amt = txn.get("amount", 0)
        if isinstance(amt, str):
            try:
                amt = float(amt.replace(",", "").replace("\u00a5", "").replace("\uffe5", "").strip())
            except (ValueError, TypeError):
                continue
        if amt <= 0:
            continue

        desc = txn.get("description", "")
        product = txn.get("product", "")
        if product and product != "/" and product != desc:
            desc = f"{desc} - {product}"

        date_val = txn.get("date", "")
        if date_val and date_val != "-" and not _DATE_RE.match(date_val):
            logger.warning("WeChat txn non-standard date: %s", date_val)

        result.append({
            "id": f"wx_{i}",
            "date": date_val,
            "dateISO": "",
            "description": desc,
            "amount": round(amt, 2),
            "matched": False,
            "matchedInvoiceId": None,
            "source": "wechat",
            "detectedBank": "wechat_pay",
            "paymentMethod": txn.get("paymentMethod", ""),
            "originalCurrency": txn.get("currency", "CNY"),
        })

    if truncated:
        logger.warning("WeChat statement extraction truncated — %d transactions recovered", len(result))

    return {"ok": True, "transactions": result, "source": "wechat"}
