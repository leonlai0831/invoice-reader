"""Tests for ai_extractor optimizations."""

import json
import io
import os
import sys
import types
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_extractor import (
    _parse_json_object,
    _parse_json_array,
    _validate_invoice_data,
    _optimize_image,
    _safe_error_msg,
    _check_truncation,
    _log_usage,
    _build_content_block,
    _get_model,
    _api_call_with_retry,
    extract_invoice,
    VALID_CURRENCIES,
    CATEGORIES,
    RETRYABLE_STATUSES,
    MODEL_INVOICE,
    MODEL_STATEMENT,
)


# ── _parse_json_object ───────────────────────────────────────────

class TestParseJsonObject:
    def test_clean_json(self):
        result = _parse_json_object('{"a": 1, "b": "hello"}')
        assert result == {"a": 1, "b": "hello"}

    def test_markdown_wrapped(self):
        result = _parse_json_object('```json\n{"a": 1}\n```')
        assert result == {"a": 1}

    def test_extra_text_around_json(self):
        result = _parse_json_object('Here is the result: {"a": 1} hope that helps')
        assert result == {"a": 1}

    def test_nested_braces(self):
        result = _parse_json_object('{"outer": {"inner": 1}}')
        assert result == {"outer": {"inner": 1}}

    def test_truncated_with_missing_brace(self):
        result = _parse_json_object('{"a": "hello"')
        assert result == {"a": "hello"}

    def test_unparseable_raises(self):
        with pytest.raises(ValueError, match="无法解析"):
            _parse_json_object("not json at all")

    def test_array_not_returned(self):
        with pytest.raises((ValueError, TypeError)):
            _parse_json_object('[1, 2, 3]')


# ── _parse_json_array ────────────────────────────────────────────

class TestParseJsonArray:
    def test_clean_array(self):
        result = _parse_json_array('[{"date": "01/01/2025", "amount": 10}]')
        assert len(result) == 1

    def test_truncated_array(self):
        text = '[{"date": "01/01/2025", "amount": 10}, {"date": "02/01/2025", "amount": 20'
        result = _parse_json_array(text)
        assert len(result) == 1  # only complete object recovered
        assert result[0]["amount"] == 10

    def test_multiple_complete_objects_from_truncated(self):
        text = '[{"date": "01/01/2025", "description": "A", "amount": 10}, {"date": "02/01/2025", "description": "B", "amount": 20}, {"date": "03/01'
        result = _parse_json_array(text)
        assert len(result) == 2

    def test_unparseable_raises(self):
        with pytest.raises(ValueError, match="无法解析"):
            _parse_json_array("not json at all")


# ── _validate_invoice_data ───────────────────────────────────────

class TestValidateInvoiceData:
    def test_valid_data_unchanged(self):
        data = {
            "supplierName": "ACME",
            "invoiceNo": "INV-001",
            "invoiceDate": "15/03/2025",
            "amount": "1234.56",
            "currency": "MYR",
            "suggestedCategory": "Equipment",
            "suggestedDescription": "Gym equipment",
            "address": "123 Main St",
        }
        result = _validate_invoice_data(data.copy())
        assert result["amount"] == "1234.56"
        assert "_validationWarnings" not in result

    def test_amount_normalized(self):
        data = {"amount": "1,234.5", "supplierName": "X"}
        result = _validate_invoice_data(data)
        assert result["amount"] == "1234.50"

    def test_invalid_amount_warns(self):
        data = {"amount": "not-a-number", "supplierName": "X"}
        result = _validate_invoice_data(data)
        assert "_validationWarnings" in result
        assert any("Invalid amount" in w for w in result["_validationWarnings"])

    def test_bad_date_warns(self):
        data = {"invoiceDate": "2025-03-15", "supplierName": "X"}
        result = _validate_invoice_data(data)
        assert "_validationWarnings" in result
        assert result.get("invoiceDateRaw") == "2025-03-15"

    def test_dash_date_ok(self):
        data = {"invoiceDate": "-", "supplierName": "X", "amount": "100.00"}
        result = _validate_invoice_data(data)
        assert "_validationWarnings" not in result

    def test_unknown_currency_defaults_myr(self):
        data = {"currency": "JPY", "supplierName": "X"}
        result = _validate_invoice_data(data)
        assert result["currency"] == "MYR"
        assert "_validationWarnings" in result

    def test_unknown_category_defaults_others(self):
        data = {"suggestedCategory": "FoodAndBeverage", "supplierName": "X"}
        result = _validate_invoice_data(data)
        assert result["suggestedCategory"] == "Others"

    def test_empty_supplier_warns(self):
        data = {"supplierName": "  "}
        result = _validate_invoice_data(data)
        assert any("Empty supplier" in w for w in result["_validationWarnings"])


# ── _optimize_image ──────────────────────────────────────────────

class TestOptimizeImage:
    def _make_image(self, width, height, fmt="JPEG"):
        from PIL import Image
        img = Image.new("RGB", (width, height), color="red")
        buf = io.BytesIO()
        img.save(buf, format=fmt)
        return buf.getvalue()

    def test_small_image_unchanged(self):
        original = self._make_image(800, 600)
        result = _optimize_image(original, max_dim=2048)
        assert result is original  # same object, not resized

    def test_large_image_downscaled(self):
        original = self._make_image(4000, 3000)
        result = _optimize_image(original, max_dim=2048)
        assert len(result) < len(original)
        # Verify dimensions
        from PIL import Image
        img = Image.open(io.BytesIO(result))
        assert max(img.size) <= 2048

    def test_non_image_returns_original(self):
        garbage = b"not an image at all"
        result = _optimize_image(garbage)
        assert result is garbage


# ── _safe_error_msg ──────────────────────────────────────────────

class TestSafeErrorMsg:
    def test_json_error_response(self):
        resp = MagicMock()
        resp.status_code = 400
        resp.headers = {"request-id": "req-123"}
        resp.json.return_value = {"error": {"message": "invalid_api_key"}}
        msg = _safe_error_msg(resp)
        assert "400" in msg
        assert "invalid_api_key" in msg
        assert "req-123" in msg

    def test_non_json_error_response(self):
        resp = MagicMock()
        resp.status_code = 502
        resp.headers = {"request-id": "req-456"}
        resp.json.side_effect = json.JSONDecodeError("", "", 0)
        resp.text = "<html>Bad Gateway</html>"
        msg = _safe_error_msg(resp)
        assert "502" in msg
        assert "Bad Gateway" in msg
        assert "req-456" in msg

    def test_missing_request_id(self):
        resp = MagicMock()
        resp.status_code = 500
        resp.headers = {}
        resp.json.return_value = {"error": {"message": "internal"}}
        msg = _safe_error_msg(resp)
        assert "unknown" in msg


# ── _check_truncation ────────────────────────────────────────────

class TestCheckTruncation:
    def test_truncated(self):
        assert _check_truncation({"stop_reason": "max_tokens"}) is True

    def test_not_truncated(self):
        assert _check_truncation({"stop_reason": "end_turn"}) is False

    def test_missing_stop_reason(self):
        assert _check_truncation({}) is False


# ── _log_usage ───────────────────────────────────────────────────

class TestLogUsage:
    def test_returns_usage_dict(self):
        data = {"usage": {"input_tokens": 100, "output_tokens": 50}}
        result = _log_usage(data, "test")
        assert result["input_tokens"] == 100

    def test_missing_usage(self):
        result = _log_usage({})
        assert result == {}


# ── _get_model ───────────────────────────────────────────────────

class TestGetModel:
    def test_default_invoice(self):
        with patch("ai_extractor.load_cfg", return_value={}):
            assert _get_model("invoice") == MODEL_INVOICE

    def test_default_statement(self):
        with patch("ai_extractor.load_cfg", return_value={}):
            assert _get_model("statement") == MODEL_STATEMENT

    def test_config_override_invoice(self):
        with patch("ai_extractor.load_cfg", return_value={"model_invoice": "claude-sonnet-4-20250514"}):
            assert _get_model("invoice") == "claude-sonnet-4-20250514"

    def test_config_override_statement(self):
        with patch("ai_extractor.load_cfg", return_value={"model_statement": "claude-haiku-4-5-20251001"}):
            assert _get_model("statement") == "claude-haiku-4-5-20251001"


# ── _build_content_block ─────────────────────────────────────────

class TestBuildContentBlock:
    def test_pdf_block(self):
        block = _build_content_block(b"fake-pdf-bytes", "application/pdf")
        assert block["type"] == "document"
        assert block["source"]["media_type"] == "application/pdf"

    def test_image_block(self):
        from PIL import Image as PILImage
        img = PILImage.new("RGB", (100, 100))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        block = _build_content_block(buf.getvalue(), "image/jpeg")
        assert block["type"] == "image"
        assert block["source"]["media_type"] == "image/jpeg"


# ── _api_call_with_retry ─────────────────────────────────────────

class TestApiCallWithRetry:
    def test_success_no_retry(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        with patch("ai_extractor.req_lib.post", return_value=mock_resp) as mock_post:
            result = _api_call_with_retry("key", {"model": "test"}, timeout=10, max_retries=2)
            assert result.status_code == 200
            assert mock_post.call_count == 1

    def test_retries_on_429(self):
        resp_429 = MagicMock()
        resp_429.status_code = 429
        resp_429.headers = {"retry-after": "1", "request-id": "r1"}
        resp_200 = MagicMock()
        resp_200.status_code = 200
        with patch("ai_extractor.req_lib.post", side_effect=[resp_429, resp_200]):
            with patch("ai_extractor.time.sleep"):
                result = _api_call_with_retry("key", {}, timeout=10, max_retries=2)
                assert result.status_code == 200

    def test_retries_on_500(self):
        resp_500 = MagicMock()
        resp_500.status_code = 500
        resp_500.headers = {"request-id": "r2"}
        resp_200 = MagicMock()
        resp_200.status_code = 200
        with patch("ai_extractor.req_lib.post", side_effect=[resp_500, resp_200]):
            with patch("ai_extractor.time.sleep"):
                result = _api_call_with_retry("key", {}, timeout=10, max_retries=2)
                assert result.status_code == 200

    def test_retries_on_503(self):
        resp_503 = MagicMock()
        resp_503.status_code = 503
        resp_503.headers = {"request-id": "r3"}
        resp_200 = MagicMock()
        resp_200.status_code = 200
        with patch("ai_extractor.req_lib.post", side_effect=[resp_503, resp_200]):
            with patch("ai_extractor.time.sleep"):
                result = _api_call_with_retry("key", {}, timeout=10, max_retries=2)
                assert result.status_code == 200

    def test_non_retryable_returned_immediately(self):
        resp_400 = MagicMock()
        resp_400.status_code = 400
        with patch("ai_extractor.req_lib.post", return_value=resp_400) as mock_post:
            result = _api_call_with_retry("key", {}, timeout=10, max_retries=2)
            assert result.status_code == 400
            assert mock_post.call_count == 1


# ── extract_invoice (tool_use) ───────────────────────────────────

class TestExtractInvoice:
    def _mock_tool_response(self, invoice_data):
        return {
            "content": [
                {
                    "type": "tool_use",
                    "id": "toolu_123",
                    "name": "record_invoice",
                    "input": invoice_data,
                }
            ],
            "usage": {"input_tokens": 500, "output_tokens": 100},
            "stop_reason": "tool_use",
        }

    def test_successful_tool_use_extraction(self):
        invoice_data = {
            "supplierName": "ACME SDN BHD",
            "invoiceNo": "INV-001",
            "invoiceDate": "15/03/2025",
            "amount": "1234.56",
            "currency": "MYR",
            "suggestedCategory": "Equipment",
            "suggestedDescription": "Gym equipment",
            "address": "",
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = self._mock_tool_response(invoice_data)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="claude-haiku-4-5-20251001"):
                result = extract_invoice("key", b"fake-image", "image/jpeg")

        assert result["ok"] is True
        assert result["data"]["supplierName"] == "ACME SDN BHD"
        assert result["data"]["amount"] == "1234.56"

    def test_api_error_returns_safe_message(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 401
        mock_resp.headers = {"request-id": "req-err"}
        mock_resp.json.return_value = {"error": {"message": "invalid key"}}

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_invoice("bad-key", b"img", "image/jpeg")

        assert result["ok"] is False
        assert "invalid key" in result["error"]
        assert "req-err" in result["error"]

    def test_non_json_api_error(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 502
        mock_resp.headers = {}
        mock_resp.json.side_effect = json.JSONDecodeError("", "", 0)
        mock_resp.text = "<html>502 Bad Gateway</html>"

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_invoice("key", b"img", "image/jpeg")

        assert result["ok"] is False
        assert "502" in result["error"]

    def test_validation_applied_to_tool_output(self):
        """tool_use output with invalid currency gets corrected."""
        invoice_data = {
            "supplierName": "TEST",
            "invoiceNo": "X",
            "invoiceDate": "15/03/2025",
            "amount": "100",
            "currency": "JPY",  # not in VALID_CURRENCIES
            "suggestedCategory": "Equipment",
            "suggestedDescription": "test",
            "address": "",
        }
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = self._mock_tool_response(invoice_data)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_invoice("key", b"img", "image/jpeg")

        assert result["ok"] is True
        assert result["data"]["currency"] == "MYR"
        assert "_validationWarnings" in result["data"]

    def test_fallback_to_text_parsing(self):
        """If tool_use block is missing, falls back to text JSON parsing."""
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "content": [
                {"type": "text", "text": '{"supplierName": "FALLBACK", "amount": "50.00", "invoiceDate": "-", "invoiceNo": "X", "currency": "MYR", "suggestedCategory": "Others", "suggestedDescription": "test", "address": ""}'}
            ],
            "usage": {"input_tokens": 100, "output_tokens": 50},
            "stop_reason": "end_turn",
        }

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_invoice("key", b"img", "image/jpeg")

        assert result["ok"] is True
        assert result["data"]["supplierName"] == "FALLBACK"


# ── Constants ────────────────────────────────────────────────────

class TestConstants:
    def test_retryable_statuses(self):
        assert 429 in RETRYABLE_STATUSES
        assert 500 in RETRYABLE_STATUSES
        assert 503 in RETRYABLE_STATUSES
        assert 529 in RETRYABLE_STATUSES
        assert 400 not in RETRYABLE_STATUSES

    def test_valid_currencies(self):
        assert "MYR" in VALID_CURRENCIES
        assert "CNY" in VALID_CURRENCIES
        assert "USD" in VALID_CURRENCIES

    def test_categories_has_others(self):
        assert "Others" in CATEGORIES
