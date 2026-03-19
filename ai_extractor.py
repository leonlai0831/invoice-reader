"""Anthropic Claude API call for invoice data extraction."""

import json
import re
import time
import base64
import requests as req_lib

MODEL = "claude-sonnet-4-20250514"

SYSTEM_PROMPT = """You are an expert invoice/receipt data extractor for a Malaysian company (Optimum Group: Optimum Fit gym & Optimum Swim School).

Extract data and return ONLY a valid JSON object:
{
  "supplierName": "exact vendor name in UPPERCASE",
  "invoiceNo": "invoice or receipt number",
  "invoiceDate": "date in DD/MM/YYYY format, use - if not found",
  "amount": "the FINAL TOTAL amount the buyer must pay, as number string only e.g. 1234.56, NO currency symbols",
  "currency": "3-letter ISO code: USD, CNY, MYR, SGD, EUR, GBP. Detect from symbols ($=USD, ¥=CNY, RM=MYR, S$=SGD, €=EUR, £=GBP) or explicit text. Default MYR for Malaysian supplier.",
  "suggestedCategory": "best match from: Advertisement, Design Service, Equipment, Event, HR, Maintenance, Marketing, Operation, Others, Purchasing, Recruitment, Renovation, Sanitary, Service, Shipping, Staff Welfare, Stationary, Subscription, Telco, Welfare",
  "suggestedDescription": "concise description like: FB ads, Center internet service, Gym equipment. Do NOT include currency info here.",
  "address": "the billing or delivery address on the invoice (customer/buyer address, NOT supplier address), or empty string if not visible"
}

CRITICAL RULES for amount:
- For Chinese invoices (发票): ALWAYS use 价税合计 (total including tax, 小写 amount), NEVER use 金额 (subtotal before tax) or 合计 (subtotal). The 价税合计 is the actual total the buyer pays and is usually the LARGEST number near the bottom of the invoice.
- For Malaysian telco bills (Maxis, Celcomdigi, Digi, TM, Unifi, Time): use the CURRENT MONTH total charges / total charges for this billing period, NOT the total outstanding amount or total amount due. The outstanding amount often includes credits from previous overpayments, making it LESS than the actual current month charges.
- For all other invoices: use the grand total / total payable, NOT subtotals or line item amounts.
- If there is tax/GST/SST, the amount should INCLUDE tax.

Return ONLY JSON. No markdown. No explanation."""


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
            if resp.status_code in (429, 529) and attempt < max_retries:
                retry_after = int(resp.headers.get("retry-after", 2 ** (attempt + 1)))
                time.sleep(min(retry_after, 30))
                continue
            return resp
        except (req_lib.exceptions.Timeout, req_lib.exceptions.ConnectionError):
            if attempt < max_retries:
                time.sleep(2 ** (attempt + 1))
                continue
            raise
    return last_resp


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


def extract_invoice(api_key, file_bytes, mime_type):
    """Send an invoice image/PDF to Claude and return extracted data."""
    b64 = base64.b64encode(file_bytes).decode()
    is_pdf = "pdf" in mime_type

    if is_pdf:
        content_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        }
    else:
        content_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": mime_type, "data": b64},
        }

    resp = _api_call_with_retry(api_key, {
        "model": MODEL,
        "max_tokens": 1000,
        "system": [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        "messages": [
            {
                "role": "user",
                "content": [
                    content_block,
                    {"type": "text", "text": "Extract all invoice data as JSON."},
                ],
            }
        ],
    }, timeout=60)

    if resp.status_code != 200:
        err_data = resp.json()
        msg = err_data.get("error", {}).get("message", str(err_data))
        return {"ok": False, "error": f"API error {resp.status_code}: {msg}"}

    data = resp.json()
    text = ""
    for block in data.get("content", []):
        if block.get("type") == "text":
            text = block["text"]
            break

    try:
        parsed = _parse_json_object(text)
    except (json.JSONDecodeError, ValueError) as e:
        return {"ok": False, "error": f"AI 返回的数据格式异常: {str(e)[:200]}"}
    return {"ok": True, "data": parsed}


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
- date must be DD/MM/YYYY format
- description should be the merchant/payee name, cleaned up
- Return ONLY the JSON array. No markdown. No explanation."""


def extract_cc_statement(api_key, file_bytes, mime_type):
    """Send a CC statement PDF/image to Claude and return extracted transactions."""
    b64 = base64.b64encode(file_bytes).decode()
    is_pdf = "pdf" in mime_type

    if is_pdf:
        content_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        }
    else:
        content_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": mime_type, "data": b64},
        }

    resp = _api_call_with_retry(api_key, {
        "model": MODEL,
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
        err_data = resp.json()
        msg = err_data.get("error", {}).get("message", str(err_data))
        return {"ok": False, "error": f"API error {resp.status_code}: {msg}"}

    data = resp.json()
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
            amt = float(amt.replace(",", "").strip())
        if amt <= 0:
            continue
        result.append({
            "id": f"cc_{i}",
            "date": txn.get("date", ""),
            "dateISO": "",
            "description": txn.get("description", ""),
            "amount": round(amt, 2),
            "matched": False,
            "matchedInvoiceId": None,
        })

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
- date must be DD/MM/YYYY format
- description should be the merchant/counterparty name (交易对方), cleaned up
- If there's a product name (商品), include it separately
- Include the payment method (支付方式) if visible — this tells which credit card was used
- Return ONLY the JSON array. No markdown. No explanation."""


def extract_wechat_statement(api_key, file_bytes, mime_type):
    """Send a WeChat Pay statement PDF/image to Claude and return extracted transactions."""
    b64 = base64.b64encode(file_bytes).decode()
    is_pdf = "pdf" in mime_type

    if is_pdf:
        content_block = {
            "type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64},
        }
    else:
        content_block = {
            "type": "image",
            "source": {"type": "base64", "media_type": mime_type, "data": b64},
        }

    resp = _api_call_with_retry(api_key, {
        "model": MODEL,
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
        err_data = resp.json()
        msg = err_data.get("error", {}).get("message", str(err_data))
        return {"ok": False, "error": f"API error {resp.status_code}: {msg}"}

    data = resp.json()
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
            amt = float(amt.replace(",", "").replace("¥", "").replace("￥", "").strip())
        if amt <= 0:
            continue

        desc = txn.get("description", "")
        product = txn.get("product", "")
        if product and product != "/" and product != desc:
            desc = f"{desc} - {product}"

        result.append({
            "id": f"wx_{i}",
            "date": txn.get("date", ""),
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

    return {"ok": True, "transactions": result, "source": "wechat"}


def _parse_json_array(text):
    """Parse a JSON array, with fallback for truncated responses."""
    # Try direct parse first
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # If truncated, try to repair: find all complete {...} objects
    objects = []
    for m in re.finditer(r'\{[^{}]*\}', text):
        try:
            obj = json.loads(m.group())
            if "date" in obj or "description" in obj or "amount" in obj:
                objects.append(obj)
        except json.JSONDecodeError:
            continue

    if objects:
        return objects

    # Last resort: try adding closing bracket
    for suffix in (']', '"}]', '"}]', '}]'):
        try:
            return json.loads(text + suffix)
        except json.JSONDecodeError:
            continue

    raise ValueError(f"无法解析 AI 返回的 JSON 数据（长度 {len(text)}）")
