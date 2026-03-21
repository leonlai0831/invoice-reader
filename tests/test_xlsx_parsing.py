"""Tests for parse_xlsx_statement robustness — corrupted files, empty files, edge cases.

Covers P0-3: XLSX parsing had no robustness tests.
"""

import io
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _make_xlsx(rows):
    """Generate minimal XLSX bytes from a list of row lists."""
    import openpyxl
    wb = openpyxl.Workbook()
    ws = wb.active
    for row in rows:
        ws.append(row)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class TestParseXlsxStatement:
    def test_corrupted_bytes(self):
        """Non-XLSX bytes should not crash."""
        from matcher import parse_xlsx_statement
        with pytest.raises(Exception):
            parse_xlsx_statement(b"not an xlsx file", "bad.xlsx")

    def test_empty_xlsx(self):
        """XLSX with no rows should return empty list."""
        from matcher import parse_xlsx_statement
        xlsx_bytes = _make_xlsx([])
        txns, source = parse_xlsx_statement(xlsx_bytes, "empty.xlsx")
        assert txns == []

    def test_header_only_xlsx(self):
        """XLSX with only headers and no data rows should return empty."""
        from matcher import parse_xlsx_statement
        xlsx_bytes = _make_xlsx([["Date", "Description", "Amount"]])
        txns, source = parse_xlsx_statement(xlsx_bytes, "headers.xlsx")
        assert txns == []

    def test_valid_cc_xlsx(self):
        """XLSX with valid CC transaction data should parse correctly."""
        from matcher import parse_xlsx_statement
        xlsx_bytes = _make_xlsx([
            ["Date", "Description", "Amount"],
            ["15/01/2026", "GRAB CAR", 25.50],
            ["17/01/2026", "SHOPEE", 150.00],
        ])
        txns, source = parse_xlsx_statement(xlsx_bytes, "cc.xlsx")
        assert source == "cc"
        assert len(txns) == 2
        assert txns[0]["amount"] == 25.50

    def test_wechat_xlsx(self):
        """XLSX with WeChat markers should be detected as wechat source."""
        from matcher import parse_xlsx_statement
        xlsx_bytes = _make_xlsx([
            ["WeChat Pay Export"],
            ["交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态"],
            ["2026-01-15 10:30:00", "商户消费", "星巴克", "咖啡", "支出", "¥35.00", "零钱", "支付成功"],
        ])
        txns, source = parse_xlsx_statement(xlsx_bytes, "wechat.xlsx")
        assert source == "wechat"
        assert len(txns) >= 1

    def test_maybank_xlsx(self):
        """Maybank-format XLSX should be detected and parsed."""
        from matcher import parse_xlsx_statement
        xlsx_bytes = _make_xlsx([
            ["Transaction Date", "Posting Date", "Transaction Description", "Transaction Amount"],
            ["15/01/2026", "16/01/2026", "GRAB CAR", "25.50"],
            ["17/01/2026", "18/01/2026", "SHOPEE", "150.00"],
        ])
        txns, source = parse_xlsx_statement(xlsx_bytes, "maybank.xlsx")
        assert source == "cc"
        assert len(txns) == 2
        assert txns[0]["detectedBank"] == "maybank"

    def test_single_row_xlsx(self):
        """XLSX with only one data row should still parse."""
        from matcher import parse_xlsx_statement
        xlsx_bytes = _make_xlsx([
            ["Date", "Description", "Amount"],
            ["15/01/2026", "GRAB", "25.50"],
        ])
        txns, source = parse_xlsx_statement(xlsx_bytes, "single.xlsx")
        assert len(txns) == 1

    def test_mixed_types(self):
        """XLSX with mixed numeric/string amounts should handle both."""
        from matcher import parse_xlsx_statement
        xlsx_bytes = _make_xlsx([
            ["Date", "Description", "Amount"],
            ["15/01/2026", "GRAB", 25.50],
            ["16/01/2026", "SHOPEE", "150.00"],
            ["17/01/2026", "PETROL", "RM 80.00"],
        ])
        txns, source = parse_xlsx_statement(xlsx_bytes, "mixed.xlsx")
        assert len(txns) >= 2
