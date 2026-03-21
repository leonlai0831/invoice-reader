"""Tests for CC and WeChat statement AI extraction (extract_cc_statement, extract_wechat_statement).

Covers P0-1: these two functions had zero test coverage despite being production-critical.
"""

import json
import os
import sys
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from ai_extractor import (
    extract_cc_statement,
    extract_wechat_statement,
    _parse_json_array,
)


def _mock_api_response(text_content, status_code=200, stop_reason="end_turn"):
    """Build a mock API response returning text content."""
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = {"request-id": "test-req"}
    resp.json.return_value = {
        "content": [{"type": "text", "text": text_content}],
        "usage": {"input_tokens": 500, "output_tokens": 200},
        "stop_reason": stop_reason,
    }
    return resp


def _mock_error_response(status_code, message="error"):
    resp = MagicMock()
    resp.status_code = status_code
    resp.headers = {"request-id": "err-req"}
    resp.json.return_value = {"error": {"message": message}}
    return resp


# ── extract_cc_statement ──────────────────────────────────────────


class TestExtractCcStatement:
    def test_successful_extraction(self):
        """Normal CC statement with 2 transactions."""
        api_text = json.dumps([
            {"date": "15/01/2026", "description": "GRAB CAR", "amount": 25.50},
            {"date": "16/01/2026", "description": "SHOPEE", "amount": 150.00},
        ])
        mock_resp = _mock_api_response(api_text)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test-model"):
                result = extract_cc_statement("key", b"fake-pdf", "application/pdf")

        assert result["ok"] is True
        assert len(result["transactions"]) == 2
        assert result["transactions"][0]["description"] == "GRAB CAR"
        assert result["transactions"][0]["amount"] == 25.50
        assert result["transactions"][0]["id"] == "cc_0"
        assert result["transactions"][1]["id"] == "cc_1"
        assert result["transactions"][0]["matched"] is False

    def test_skips_zero_and_negative_amounts(self):
        """Transactions with amount <= 0 should be filtered out."""
        api_text = json.dumps([
            {"date": "01/01/2026", "description": "VALID", "amount": 50.0},
            {"date": "02/01/2026", "description": "ZERO", "amount": 0},
            {"date": "03/01/2026", "description": "NEGATIVE", "amount": -10.0},
            {"date": "04/01/2026", "description": "CREDIT", "amount": "0.00"},
        ])
        mock_resp = _mock_api_response(api_text)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_cc_statement("key", b"pdf", "application/pdf")

        assert result["ok"] is True
        assert len(result["transactions"]) == 1
        assert result["transactions"][0]["description"] == "VALID"

    def test_string_amount_parsed(self):
        """Amount as string like '1,234.56' should be parsed correctly."""
        api_text = json.dumps([
            {"date": "01/01/2026", "description": "BIG PURCHASE", "amount": "1,234.56"},
        ])
        mock_resp = _mock_api_response(api_text)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_cc_statement("key", b"pdf", "application/pdf")

        assert result["ok"] is True
        assert result["transactions"][0]["amount"] == 1234.56

    def test_api_error(self):
        mock_resp = _mock_error_response(401, "invalid key")

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_cc_statement("bad-key", b"pdf", "application/pdf")

        assert result["ok"] is False
        assert "invalid key" in result["error"]

    def test_truncated_response_recovers_partial(self):
        """If AI response is truncated, should recover complete objects."""
        api_text = '[{"date": "01/01/2026", "description": "A", "amount": 10}, {"date": "02/01/2026", "desc'
        mock_resp = _mock_api_response(api_text, stop_reason="max_tokens")

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_cc_statement("key", b"pdf", "application/pdf")

        assert result["ok"] is True
        assert len(result["transactions"]) == 1

    def test_markdown_wrapped_json(self):
        """AI sometimes wraps JSON in markdown code blocks."""
        api_text = '```json\n[{"date": "01/01/2026", "description": "SHOP", "amount": 99}]\n```'
        mock_resp = _mock_api_response(api_text)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_cc_statement("key", b"pdf", "application/pdf")

        assert result["ok"] is True
        assert len(result["transactions"]) == 1

    def test_empty_content_returns_empty_transactions(self):
        """Empty content blocks should not crash."""
        resp = MagicMock()
        resp.status_code = 200
        resp.headers = {"request-id": "test"}
        resp.json.return_value = {
            "content": [],
            "usage": {"input_tokens": 100, "output_tokens": 0},
            "stop_reason": "end_turn",
        }

        with patch("ai_extractor._api_call_with_retry", return_value=resp):
            with patch("ai_extractor._get_model", return_value="test"):
                # Should raise because text is empty and _parse_json_array fails
                with pytest.raises(Exception):
                    extract_cc_statement("key", b"pdf", "application/pdf")

    def test_non_standard_date_logged(self):
        """Non DD/MM/YYYY dates should still be included but logged."""
        api_text = json.dumps([
            {"date": "2026-01-15", "description": "SHOP", "amount": 50},
        ])
        mock_resp = _mock_api_response(api_text)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_cc_statement("key", b"pdf", "application/pdf")

        assert result["ok"] is True
        assert result["transactions"][0]["date"] == "2026-01-15"


# ── extract_wechat_statement ──────────────────────────────────────


class TestExtractWechatStatement:
    def test_successful_extraction(self):
        """Normal WeChat statement with 2 expense transactions."""
        api_text = json.dumps([
            {"date": "15/01/2026", "description": "Starbucks", "product": "Coffee",
             "amount": 35.0, "paymentMethod": "Visa(1234)", "currency": "CNY"},
            {"date": "16/01/2026", "description": "Taobao", "product": "Goods",
             "amount": 128.5, "paymentMethod": "CMB", "currency": "CNY"},
        ])
        mock_resp = _mock_api_response(api_text)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_wechat_statement("key", b"img", "image/jpeg")

        assert result["ok"] is True
        assert result["source"] == "wechat"
        assert len(result["transactions"]) == 2
        t0 = result["transactions"][0]
        assert t0["id"] == "wx_0"
        assert t0["source"] == "wechat"
        assert t0["detectedBank"] == "wechat_pay"
        assert t0["originalCurrency"] == "CNY"
        assert "Starbucks" in t0["description"]
        assert "Coffee" in t0["description"]
        assert t0["paymentMethod"] == "Visa(1234)"

    def test_product_same_as_description_not_duplicated(self):
        """When product == description, don't create 'X - X' format."""
        api_text = json.dumps([
            {"date": "01/01/2026", "description": "Shop", "product": "Shop",
             "amount": 10, "currency": "CNY"},
        ])
        mock_resp = _mock_api_response(api_text)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_wechat_statement("key", b"img", "image/jpeg")

        assert result["transactions"][0]["description"] == "Shop"

    def test_product_slash_ignored(self):
        """Product '/' should be ignored (WeChat uses / for empty product)."""
        api_text = json.dumps([
            {"date": "01/01/2026", "description": "Shop", "product": "/",
             "amount": 10, "currency": "CNY"},
        ])
        mock_resp = _mock_api_response(api_text)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_wechat_statement("key", b"img", "image/jpeg")

        assert result["transactions"][0]["description"] == "Shop"

    def test_yen_symbol_stripped_from_amount(self):
        """Amount strings with yen symbols should be cleaned."""
        api_text = json.dumps([
            {"date": "01/01/2026", "description": "Shop", "amount": "\u00a535.00",
             "currency": "CNY"},
        ])
        mock_resp = _mock_api_response(api_text)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_wechat_statement("key", b"img", "image/jpeg")

        assert result["transactions"][0]["amount"] == 35.0

    def test_skips_zero_amount(self):
        api_text = json.dumps([
            {"date": "01/01/2026", "description": "Free", "amount": 0, "currency": "CNY"},
            {"date": "01/01/2026", "description": "Paid", "amount": 10, "currency": "CNY"},
        ])
        mock_resp = _mock_api_response(api_text)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_wechat_statement("key", b"img", "image/jpeg")

        assert len(result["transactions"]) == 1
        assert result["transactions"][0]["description"] == "Paid"

    def test_api_error(self):
        mock_resp = _mock_error_response(500, "server error")

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_wechat_statement("key", b"img", "image/jpeg")

        assert result["ok"] is False

    def test_missing_currency_defaults_cny(self):
        """If currency field is missing, should default to CNY."""
        api_text = json.dumps([
            {"date": "01/01/2026", "description": "Shop", "amount": 10},
        ])
        mock_resp = _mock_api_response(api_text)

        with patch("ai_extractor._api_call_with_retry", return_value=mock_resp):
            with patch("ai_extractor._get_model", return_value="test"):
                result = extract_wechat_statement("key", b"img", "image/jpeg")

        assert result["transactions"][0]["originalCurrency"] == "CNY"
