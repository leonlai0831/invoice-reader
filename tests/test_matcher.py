"""Tests for matcher.py — parsing, matching, and helper functions."""

import csv
import io
import pytest
from datetime import datetime

from matcher import (
    _parse_date, _parse_amount, _safe_float, _name_similarity,
    _is_wechat_content, _is_wechat_csv, _detect_bank,
    _parse_wechat_rows, _parse_cc_rows, _parse_generic_rows,
    parse_cc_statement, parse_wechat_statement, parse_xlsx_statement,
    match_transactions, _find_col,
    BANK_PROFILES,
    compute_fingerprint, generate_stable_id, merge_transactions,
)


# ── Helper Functions ─────────────────────────────────────────────

class TestParseDate:
    def test_dd_mm_yyyy(self):
        d = _parse_date("15/03/2026")
        assert d == datetime(2026, 3, 15)

    def test_yyyy_mm_dd(self):
        d = _parse_date("2026-03-15")
        assert d == datetime(2026, 3, 15)

    def test_dd_mmm_yyyy(self):
        d = _parse_date("15 Mar 2026")
        assert d == datetime(2026, 3, 15)

    def test_dd_mm_yy(self):
        d = _parse_date("15/03/26")
        assert d == datetime(2026, 3, 15)

    def test_empty_returns_none(self):
        assert _parse_date("") is None
        assert _parse_date(None) is None

    def test_invalid_returns_none(self):
        assert _parse_date("not-a-date") is None


class TestParseAmount:
    def test_simple_number(self):
        assert _parse_amount("123.45") == 123.45

    def test_with_commas(self):
        assert _parse_amount("1,234.56") == 1234.56

    def test_with_currency_prefix(self):
        assert _parse_amount("RM 1,234.56") == 1234.56

    def test_negative_becomes_positive(self):
        assert _parse_amount("-500.00") == 500.00

    def test_empty_returns_none(self):
        assert _parse_amount("") is None
        assert _parse_amount(None) is None

    def test_non_numeric_returns_none(self):
        assert _parse_amount("N/A") is None


class TestSafeFloat:
    def test_string_number(self):
        assert _safe_float("123.45") == 123.45

    def test_with_commas(self):
        assert _safe_float("1,234.56") == 1234.56

    def test_invalid_returns_zero(self):
        assert _safe_float("abc") == 0

    def test_none_returns_zero(self):
        assert _safe_float(None) == 0


class TestNameSimilarity:
    def test_identical_strings(self):
        assert _name_similarity("GOOGLE ADS", "GOOGLE ADS") == 1.0

    def test_partial_overlap(self):
        score = _name_similarity("GOOGLE ASIA PACIFIC", "GOOGLE ADS PACIFIC")
        assert 0 < score < 1

    def test_no_overlap(self):
        assert _name_similarity("APPLE INC", "SAMSUNG CORP") == 0

    def test_empty_returns_zero(self):
        assert _name_similarity("", "GOOGLE") == 0
        assert _name_similarity(None, None) == 0


class TestFindCol:
    def test_exact_match(self):
        assert _find_col(["date", "description", "amount"], "date") == 0

    def test_partial_match(self):
        assert _find_col(["transaction date", "desc", "amt"], "transaction date") == 0

    def test_not_found(self):
        assert _find_col(["a", "b", "c"], "xyz") is None


# ── Detection ─────────────────────────────────────────────────────

class TestWeChatDetection:
    def test_wechat_content_detected(self):
        text = "微信支付\n交易时间,交易对方,收/支,金额\n2026-01-01,Shop,支出,100"
        assert _is_wechat_content(text) is True

    def test_non_wechat_content(self):
        assert _is_wechat_content("Date,Description,Amount") is False

    def test_wechat_csv_detected(self):
        text = "微信支付账单\n交易时间,交易对方,收/支,金额,商品\n2026-01-01,Shop,支出,100,item"
        assert _is_wechat_csv(text) is True


class TestBankDetection:
    def test_detect_maybank(self):
        header = ["Transaction Date", "Posting Date", "Transaction Description", "Transaction Amount"]
        assert _detect_bank(header) == "maybank"

    def test_detect_cimb(self):
        header = ["Txn Date", "Description", "Debit"]
        assert _detect_bank(header) == "cimb"

    def test_detect_public_bank(self):
        header = ["Date", "Details", "Amount"]
        assert _detect_bank(header) == "public_bank"

    def test_detect_rhb(self):
        header = ["Transaction Date", "Description", "Amount (RM)"]
        assert _detect_bank(header) == "rhb"

    def test_unknown_bank(self):
        header = ["Column A", "Column B"]
        assert _detect_bank(header) is None


# ── Parsing ───────────────────────────────────────────────────────

class TestParseWeChatRows:
    def _make_rows(self):
        return [
            ["微信支付账单明细"],
            ["交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态"],
            ["2026-01-15 10:30:00", "商户消费", "星巴克", "咖啡", "支出", "¥35.00", "零钱", "支付成功"],
            ["2026-01-16 14:00:00", "商户消费", "麦当劳", "午餐", "收入", "¥50.00", "零钱", "已收入"],
            ["2026-01-17 09:00:00", "商户消费", "淘宝", "商品", "支出", "¥128.50", "招商银行", "支付成功"],
        ]

    def test_parses_expenditures_only(self):
        txns = _parse_wechat_rows(self._make_rows())
        assert len(txns) == 2  # 收入 row should be excluded

    def test_amounts_correct(self):
        txns = _parse_wechat_rows(self._make_rows())
        assert txns[0]["amount"] == 35.0
        assert txns[1]["amount"] == 128.5

    def test_dates_formatted(self):
        txns = _parse_wechat_rows(self._make_rows())
        assert txns[0]["date"] == "15/01/2026"

    def test_description_includes_product(self):
        txns = _parse_wechat_rows(self._make_rows())
        assert "星巴克" in txns[0]["description"]
        assert "咖啡" in txns[0]["description"]

    def test_source_is_wechat(self):
        txns = _parse_wechat_rows(self._make_rows())
        assert txns[0]["source"] == "wechat"
        assert txns[0]["originalCurrency"] == "CNY"

    def test_empty_rows_returns_empty(self):
        assert _parse_wechat_rows([]) == []


class TestParseCcRows:
    def _make_maybank_rows(self):
        return [
            ["Transaction Date", "Posting Date", "Transaction Description", "Transaction Amount"],
            ["15/01/2026", "16/01/2026", "GRAB CAR", "25.50"],
            ["17/01/2026", "18/01/2026", "SHOPEE", "150.00"],
            ["", "", "", ""],  # empty row should be skipped
        ]

    def test_parses_maybank_format(self):
        txns = _parse_cc_rows(self._make_maybank_rows())
        assert len(txns) == 2

    def test_amounts_correct(self):
        txns = _parse_cc_rows(self._make_maybank_rows())
        assert txns[0]["amount"] == 25.50
        assert txns[1]["amount"] == 150.00

    def test_detected_bank(self):
        txns = _parse_cc_rows(self._make_maybank_rows())
        assert txns[0]["detectedBank"] == "maybank"


class TestParseGenericRows:
    def test_generic_csv(self):
        rows = [
            ["Date", "Description", "Amount"],
            ["01/02/2026", "PETROL SHELL", "80.00"],
            ["05/02/2026", "TESCO GROCERY", "234.50"],
        ]
        txns = _parse_generic_rows(rows)
        assert len(txns) == 2
        assert txns[0]["amount"] == 80.0
        assert txns[1]["description"] == "TESCO GROCERY"


class TestParseCcStatement:
    def _to_csv_bytes(self, rows):
        buf = io.StringIO()
        writer = csv.writer(buf)
        for row in rows:
            writer.writerow(row)
        return buf.getvalue().encode("utf-8-sig")

    def test_generic_csv(self):
        data = self._to_csv_bytes([
            ["Date", "Description", "Amount"],
            ["01/03/2026", "GRAB", "15.00"],
            ["02/03/2026", "SHOPEE", "99.90"],
        ])
        txns = parse_cc_statement(data, "statement.csv")
        assert len(txns) == 2

    def test_wechat_csv_auto_detected(self):
        data = self._to_csv_bytes([
            ["微信支付账单明细"],
            ["交易时间", "交易类型", "交易对方", "商品", "收/支", "金额(元)", "支付方式", "当前状态"],
            ["2026-01-15 10:30:00", "商户消费", "星巴克", "咖啡", "支出", "35.00", "零钱", "支付成功"],
        ])
        txns = parse_cc_statement(data, "wechat.csv")
        assert len(txns) == 1
        assert txns[0]["source"] == "wechat"


# ── Matching Algorithm ────────────────────────────────────────────

class TestMatchTransactions:
    def test_exact_match(self):
        invoices = [{
            "id": "inv1",
            "amount": 100.0,
            "invoiceDate": "15/01/2026",
            "supplierName": "GOOGLE",
            "originalAmount": 0,
            "originalCurrency": "MYR",
        }]
        cc_txns = [{
            "id": "cc1",
            "amount": 100.0,
            "date": "15/01/2026",
            "description": "GOOGLE PAYMENT",
            "source": "cc",
            "originalCurrency": "MYR",
        }]
        results = match_transactions(invoices, cc_txns)
        assert len(results) == 1
        assert len(results[0]["candidates"]) == 1
        assert results[0]["candidates"][0]["invoiceId"] == "inv1"
        assert results[0]["candidates"][0]["score"] > 0.5

    def test_no_match_different_amount(self):
        invoices = [{"id": "inv1", "amount": 100.0, "invoiceDate": "15/01/2026",
                      "supplierName": "ALPHA CORP", "originalAmount": 0, "originalCurrency": "MYR"}]
        cc_txns = [{"id": "cc1", "amount": 999.0, "date": "15/06/2026",
                     "description": "BETA INC", "source": "cc", "originalCurrency": "MYR"}]
        results = match_transactions(invoices, cc_txns)
        assert results[0]["candidates"] == []

    def test_skips_already_matched_invoices(self):
        invoices = [{"id": "inv1", "amount": 100.0, "invoiceDate": "15/01/2026",
                      "supplierName": "SHOP", "ccMatched": True,
                      "originalAmount": 0, "originalCurrency": "MYR"}]
        cc_txns = [{"id": "cc1", "amount": 100.0, "date": "15/01/2026",
                     "description": "SHOP", "source": "cc", "originalCurrency": "MYR"}]
        results = match_transactions(invoices, cc_txns)
        assert results[0]["candidates"] == []

    def test_wechat_cny_matching(self):
        invoices = [{
            "id": "inv1",
            "amount": 65.0,  # MYR amount
            "invoiceDate": "15/01/2026",
            "supplierName": "TAOBAO",
            "originalAmount": 100.0,  # CNY amount
            "originalCurrency": "CNY",
        }]
        cc_txns = [{
            "id": "wx1",
            "amount": 100.0,  # CNY
            "date": "15/01/2026",
            "description": "TAOBAO SHOPPING",
            "source": "wechat",
            "originalCurrency": "CNY",
        }]
        results = match_transactions(invoices, cc_txns)
        assert len(results[0]["candidates"]) == 1

    def test_date_tolerance(self):
        invoices = [{"id": "inv1", "amount": 100.0, "invoiceDate": "15/01/2026",
                      "supplierName": "SHOP", "originalAmount": 0, "originalCurrency": "MYR"}]
        # 3 days apart — within default 7-day tolerance
        cc_txns = [{"id": "cc1", "amount": 100.0, "date": "18/01/2026",
                     "description": "SHOP PAYMENT", "source": "cc", "originalCurrency": "MYR"}]
        results = match_transactions(invoices, cc_txns, date_tolerance=7)
        assert len(results[0]["candidates"]) == 1


class TestCrossReferenceStatements:
    """Tests for cross_reference_statements() — WeChat ↔ CC pairing."""

    def test_date_and_rate_match(self):
        """WeChat CNY 100 + CC MYR 62 on nearby dates should pair."""
        from matcher import cross_reference_statements
        wx = [{"id": "wx_0", "amount": 100.0, "date": "15/01/2026",
               "description": "拼多多", "source": "wechat", "originalCurrency": "CNY"}]
        cc = [{"id": "cc_0", "amount": 62.0, "date": "16/01/2026",
               "description": "BEA WEIXIN PANDUO PLATFORM", "source": "cc"}]
        result = cross_reference_statements(wx, cc, exchange_rate=0.62)
        assert len(result["pairs"]) == 1
        p = result["pairs"][0]
        assert p["wxId"] == "wx_0"
        assert p["ccId"] == "cc_0"
        assert p["score"] > 0.3
        assert abs(p["impliedRate"] - 0.62) < 0.01

    def test_no_match_wrong_rate(self):
        """If implied rate is wildly different from expected, no pair."""
        from matcher import cross_reference_statements
        wx = [{"id": "wx_0", "amount": 100.0, "date": "15/01/2026",
               "description": "shop", "source": "wechat", "originalCurrency": "CNY"}]
        cc = [{"id": "cc_0", "amount": 500.0, "date": "15/01/2026",
               "description": "BEA WEIXIN SHOP", "source": "cc"}]
        result = cross_reference_statements(wx, cc, exchange_rate=0.62)
        assert len(result["pairs"]) == 0
        assert "wx_0" in result["unmatchedWx"]
        assert "cc_0" in result["unmatchedCc"]

    def test_no_match_dates_too_far(self):
        """Dates more than 3 days apart should not pair."""
        from matcher import cross_reference_statements
        wx = [{"id": "wx_0", "amount": 100.0, "date": "15/01/2026",
               "description": "shop", "source": "wechat", "originalCurrency": "CNY"}]
        cc = [{"id": "cc_0", "amount": 62.0, "date": "25/01/2026",
               "description": "BEA WEIXIN SHOP", "source": "cc"}]
        result = cross_reference_statements(wx, cc, exchange_rate=0.62)
        assert len(result["pairs"]) == 0

    def test_one_to_one_assignment(self):
        """Each transaction matched at most once."""
        from matcher import cross_reference_statements
        wx = [
            {"id": "wx_0", "amount": 100.0, "date": "15/01/2026",
             "description": "A", "source": "wechat", "originalCurrency": "CNY"},
            {"id": "wx_1", "amount": 200.0, "date": "16/01/2026",
             "description": "B", "source": "wechat", "originalCurrency": "CNY"},
        ]
        cc = [
            {"id": "cc_0", "amount": 62.0, "date": "15/01/2026",
             "description": "BEA WEIXIN A", "source": "cc"},
            {"id": "cc_1", "amount": 124.0, "date": "16/01/2026",
             "description": "BEA WEIXIN B", "source": "cc"},
        ]
        result = cross_reference_statements(wx, cc, exchange_rate=0.62)
        assert len(result["pairs"]) == 2
        wx_ids = {p["wxId"] for p in result["pairs"]}
        cc_ids = {p["ccId"] for p in result["pairs"]}
        assert len(wx_ids) == 2  # no duplicates
        assert len(cc_ids) == 2

    def test_unmatched_lists(self):
        """Non-WeChat CC transactions appear in unmatchedCc."""
        from matcher import cross_reference_statements
        wx = [{"id": "wx_0", "amount": 100.0, "date": "15/01/2026",
               "description": "A", "source": "wechat", "originalCurrency": "CNY"}]
        cc = [
            {"id": "cc_0", "amount": 62.0, "date": "15/01/2026",
             "description": "BEA WEIXIN A", "source": "cc"},
            {"id": "cc_1", "amount": 50.0, "date": "20/01/2026",
             "description": "GRAB CAR", "source": "cc"},
        ]
        result = cross_reference_statements(wx, cc, exchange_rate=0.62)
        assert len(result["pairs"]) == 1
        assert "cc_1" in result["unmatchedCc"]
        assert len(result["unmatchedWx"]) == 0

    def test_weixin_keyword_boost(self):
        """CC description containing WEIXIN gets a higher score."""
        from matcher import cross_reference_statements
        wx = [{"id": "wx_0", "amount": 100.0, "date": "15/01/2026",
               "description": "shop", "source": "wechat", "originalCurrency": "CNY"}]
        cc_with = [{"id": "cc_with", "amount": 62.0, "date": "16/01/2026",
                    "description": "BEA WEIXIN STORE", "source": "cc"}]
        cc_without = [{"id": "cc_without", "amount": 62.0, "date": "16/01/2026",
                       "description": "RANDOM STORE", "source": "cc"}]
        r1 = cross_reference_statements(wx, cc_with, exchange_rate=0.62)
        r2 = cross_reference_statements(wx, cc_without, exchange_rate=0.62)
        # Both may match, but the WEIXIN one should have a higher score
        if r1["pairs"] and r2["pairs"]:
            assert r1["pairs"][0]["score"] > r2["pairs"][0]["score"]

    def test_backward_compat_empty(self):
        """Empty lists should return empty results, no errors."""
        from matcher import cross_reference_statements
        result = cross_reference_statements([], [])
        assert result["pairs"] == []
        assert result["avgRate"] is None

    def test_avg_rate_computed(self):
        """Average rate should be computed from matched pairs."""
        from matcher import cross_reference_statements
        wx = [
            {"id": "wx_0", "amount": 100.0, "date": "15/01/2026",
             "description": "A", "source": "wechat", "originalCurrency": "CNY"},
            {"id": "wx_1", "amount": 200.0, "date": "17/01/2026",
             "description": "B", "source": "wechat", "originalCurrency": "CNY"},
        ]
        cc = [
            {"id": "cc_0", "amount": 62.0, "date": "15/01/2026",
             "description": "BEA WEIXIN A", "source": "cc"},
            {"id": "cc_1", "amount": 126.0, "date": "17/01/2026",
             "description": "BEA WEIXIN B", "source": "cc"},
        ]
        result = cross_reference_statements(wx, cc, exchange_rate=0.63)
        assert len(result["pairs"]) == 2
        assert result["avgRate"] is not None
        assert 0.6 < result["avgRate"] < 0.7

class TestMatchWithCrossRef:
    """Tests for match_transactions with cross_ref_pairs."""

    def test_paired_wechat_txn_skipped(self):
        """WeChat transactions paired with CC should be skipped (no duplicate results)."""
        from matcher import match_transactions
        invoices = [{"id": "inv_1", "amount": 62.0, "invoiceDate": "15/01/2026",
                     "supplierName": "Shop A", "originalAmount": 100, "originalCurrency": "CNY"}]
        transactions = [
            {"id": "cc_1", "amount": 62.0, "date": "15/01/2026",
             "description": "BEA WEIXIN SHOP", "source": "cc", "originalCurrency": "MYR"},
            {"id": "wx_1", "amount": 100.0, "date": "15/01/2026",
             "description": "Shop A 商店", "source": "wechat", "originalCurrency": "CNY"},
        ]
        pairs = [{"wxId": "wx_1", "ccId": "cc_1", "score": 0.8, "impliedRate": 0.62}]
        results = match_transactions(invoices, transactions, cross_ref_pairs=pairs)
        # Should only have CC result, not WeChat (which is skipped)
        cc_ids = [r["ccId"] for r in results]
        assert "cc_1" in cc_ids
        assert "wx_1" not in cc_ids

    def test_paired_cc_uses_wx_name(self):
        """Paired CC txn should benefit from WeChat Chinese description for name matching."""
        from matcher import match_transactions
        invoices = [{"id": "inv_1", "amount": 62.0, "invoiceDate": "15/01/2026",
                     "supplierName": "拼多多商店", "originalAmount": 100, "originalCurrency": "CNY"}]
        transactions = [
            {"id": "cc_1", "amount": 62.0, "date": "15/01/2026",
             "description": "BEA WEIXIN PANDUO PLATFORM", "source": "cc", "originalCurrency": "MYR"},
            {"id": "wx_1", "amount": 100.0, "date": "15/01/2026",
             "description": "拼多多商店", "source": "wechat", "originalCurrency": "CNY"},
        ]
        pairs = [{"wxId": "wx_1", "ccId": "cc_1", "score": 0.8, "impliedRate": 0.62}]
        results = match_transactions(invoices, transactions, cross_ref_pairs=pairs)
        cc_result = [r for r in results if r["ccId"] == "cc_1"][0]
        # With WeChat partner, name matching should find candidates
        assert len(cc_result["candidates"]) > 0

    def test_paired_cc_uses_wx_amount(self):
        """Paired CC txn should try WeChat CNY amount vs invoice originalAmount."""
        from matcher import match_transactions
        # Invoice has CNY original amount matching WeChat, but CC MYR doesn't match invoice MYR amount
        invoices = [{"id": "inv_1", "amount": 30.0, "invoiceDate": "15/01/2026",
                     "supplierName": "Test Shop", "originalAmount": 100, "originalCurrency": "CNY"}]
        transactions = [
            {"id": "cc_1", "amount": 62.0, "date": "15/01/2026",
             "description": "BEA WEIXIN TEST", "source": "cc", "originalCurrency": "MYR"},
            {"id": "wx_1", "amount": 100.0, "date": "15/01/2026",
             "description": "Test Shop", "source": "wechat", "originalCurrency": "CNY"},
        ]
        pairs = [{"wxId": "wx_1", "ccId": "cc_1", "score": 0.8, "impliedRate": 0.62}]
        results = match_transactions(invoices, transactions, cross_ref_pairs=pairs)
        cc_result = [r for r in results if r["ccId"] == "cc_1"][0]
        # Should find the invoice via WeChat CNY amount match
        assert len(cc_result["candidates"]) > 0
        assert cc_result["candidates"][0]["invoiceId"] == "inv_1"

    def test_no_cross_ref_backward_compat(self):
        """Without cross_ref_pairs, behavior is unchanged."""
        from matcher import match_transactions
        invoices = [{"id": "inv_1", "amount": 62.0, "invoiceDate": "15/01/2026",
                     "supplierName": "Shop A"}]
        transactions = [
            {"id": "cc_1", "amount": 62.0, "date": "15/01/2026",
             "description": "SHOP A", "source": "cc"},
        ]
        results = match_transactions(invoices, transactions)
        assert len(results) == 1
        results2 = match_transactions(invoices, transactions, cross_ref_pairs=None)
        assert len(results2) == 1
        results3 = match_transactions(invoices, transactions, cross_ref_pairs=[])
        assert len(results3) == 1


# ── Ledger Dedup / Merge Tests ───────────────────────────────────

class TestComputeFingerprint:
    """Tests for compute_fingerprint()."""

    def test_basic_fingerprint(self):
        txn = {"dateISO": "2024-12-15", "amount": 125.50, "description": "PETRONAS STATION"}
        fp = compute_fingerprint(txn)
        assert fp == "2024-12-15|125.50|petronas station"

    def test_fingerprint_ignores_time(self):
        """dateISO with time should only use date portion."""
        txn1 = {"dateISO": "2024-12-15T10:30:00", "amount": 50.0, "description": "Shop"}
        txn2 = {"dateISO": "2024-12-15T18:45:00", "amount": 50.0, "description": "Shop"}
        assert compute_fingerprint(txn1) == compute_fingerprint(txn2)

    def test_fingerprint_case_insensitive(self):
        txn1 = {"dateISO": "2024-01-01", "amount": 10.0, "description": "STARBUCKS"}
        txn2 = {"dateISO": "2024-01-01", "amount": 10.0, "description": "starbucks"}
        assert compute_fingerprint(txn1) == compute_fingerprint(txn2)

    def test_fingerprint_whitespace_normalized(self):
        txn1 = {"dateISO": "2024-01-01", "amount": 10.0, "description": "KFC  Restaurant"}
        txn2 = {"dateISO": "2024-01-01", "amount": 10.0, "description": "KFC Restaurant"}
        assert compute_fingerprint(txn1) == compute_fingerprint(txn2)

    def test_different_amount_different_fp(self):
        txn1 = {"dateISO": "2024-01-01", "amount": 10.0, "description": "Shop"}
        txn2 = {"dateISO": "2024-01-01", "amount": 10.01, "description": "Shop"}
        assert compute_fingerprint(txn1) != compute_fingerprint(txn2)

    def test_different_date_different_fp(self):
        txn1 = {"dateISO": "2024-01-01", "amount": 10.0, "description": "Shop"}
        txn2 = {"dateISO": "2024-01-02", "amount": 10.0, "description": "Shop"}
        assert compute_fingerprint(txn1) != compute_fingerprint(txn2)

    def test_empty_fields(self):
        txn = {"dateISO": "", "amount": 0, "description": ""}
        fp = compute_fingerprint(txn)
        assert fp == "|0.00|"

    def test_missing_fields(self):
        """Should handle missing keys gracefully."""
        txn = {}
        fp = compute_fingerprint(txn)
        assert "|0.00|" in fp


class TestGenerateStableId:
    """Tests for generate_stable_id()."""

    def test_cc_id_format(self):
        txn = {"source": "cc", "detectedBank": "maybank", "dateISO": "2024-12-15",
               "amount": 125.50, "description": "PETRONAS"}
        id_ = generate_stable_id(txn, seq=0)
        assert id_.startswith("cc_")
        assert "mayban" in id_
        assert "20241215" in id_

    def test_wx_id_format(self):
        txn = {"source": "wechat", "detectedBank": "wechat_pay", "dateISO": "2024-12-15",
               "amount": 35.50, "description": "Starbucks"}
        id_ = generate_stable_id(txn, seq=3)
        assert id_.startswith("wx_")
        assert "_3_" in id_

    def test_deterministic(self):
        """Same inputs produce same ID."""
        txn = {"source": "cc", "detectedBank": "cimb", "dateISO": "2024-01-01",
               "amount": 100.0, "description": "SHELL"}
        id1 = generate_stable_id(txn, seq=5)
        id2 = generate_stable_id(txn, seq=5)
        assert id1 == id2

    def test_different_seq(self):
        txn = {"source": "cc", "detectedBank": "cimb", "dateISO": "2024-01-01",
               "amount": 100.0, "description": "SHELL"}
        id1 = generate_stable_id(txn, seq=0)
        id2 = generate_stable_id(txn, seq=1)
        assert id1 != id2  # seq is part of the ID


class TestMergeTransactions:
    """Tests for merge_transactions()."""

    def test_merge_empty_existing(self):
        """Merge into empty ledger: all transactions are new."""
        new = [
            {"dateISO": "2024-12-15", "amount": 100.0, "description": "Shop A", "source": "cc", "detectedBank": "maybank"},
            {"dateISO": "2024-12-16", "amount": 200.0, "description": "Shop B", "source": "cc", "detectedBank": "maybank"},
        ]
        merged, added, dups = merge_transactions([], new)
        assert added == 2
        assert dups == 0
        assert len(merged) == 2
        # All should have IDs and fingerprints
        for t in merged:
            assert "id" in t
            assert "fingerprint" in t
            assert t["id"].startswith("cc_")

    def test_dedup_exact_match(self):
        """Duplicate transactions should be skipped."""
        existing = [
            {"dateISO": "2024-12-15", "amount": 100.0, "description": "Shop A",
             "source": "cc", "detectedBank": "maybank", "id": "cc_0", "fingerprint": "2024-12-15|100.00|shop a"},
        ]
        new = [
            {"dateISO": "2024-12-15", "amount": 100.0, "description": "Shop A", "source": "cc", "detectedBank": "maybank"},
        ]
        merged, added, dups = merge_transactions(existing, new)
        assert added == 0
        assert dups == 1
        assert len(merged) == 1

    def test_dedup_case_insensitive(self):
        """Dedup should be case-insensitive on description."""
        existing = [
            {"dateISO": "2024-12-15", "amount": 100.0, "description": "PETRONAS",
             "source": "cc", "detectedBank": "maybank", "id": "cc_0"},
        ]
        new = [
            {"dateISO": "2024-12-15", "amount": 100.0, "description": "petronas", "source": "cc", "detectedBank": "maybank"},
        ]
        merged, added, dups = merge_transactions(existing, new)
        assert dups == 1
        assert added == 0

    def test_merge_mixed_new_and_dup(self):
        """Mix of new and duplicate transactions."""
        existing = [
            {"dateISO": "2024-12-15", "amount": 100.0, "description": "Shop A",
             "source": "cc", "detectedBank": "maybank", "id": "cc_0"},
        ]
        new = [
            {"dateISO": "2024-12-15", "amount": 100.0, "description": "Shop A", "source": "cc", "detectedBank": "maybank"},
            {"dateISO": "2024-12-16", "amount": 200.0, "description": "Shop B", "source": "cc", "detectedBank": "maybank"},
        ]
        merged, added, dups = merge_transactions(existing, new)
        assert added == 1
        assert dups == 1
        assert len(merged) == 2

    def test_wechat_transactions(self):
        """WeChat transactions get wx_ prefix IDs."""
        new = [
            {"dateISO": "2024-12-15T10:30:00", "amount": 35.50, "description": "Starbucks",
             "source": "wechat", "detectedBank": "wechat_pay"},
        ]
        merged, added, dups = merge_transactions([], new)
        assert added == 1
        assert merged[0]["id"].startswith("wx_")

    def test_preserves_existing_data(self):
        """Existing transactions should not be modified."""
        existing = [
            {"dateISO": "2024-12-15", "amount": 100.0, "description": "Shop A",
             "source": "cc", "detectedBank": "maybank", "id": "cc_old",
             "matched": True, "matchedInvoiceId": "inv_123"},
        ]
        new = [
            {"dateISO": "2024-12-16", "amount": 200.0, "description": "Shop B", "source": "cc", "detectedBank": "maybank"},
        ]
        merged, added, dups = merge_transactions(existing, new)
        assert merged[0]["id"] == "cc_old"
        assert merged[0]["matched"] is True
        assert merged[0]["matchedInvoiceId"] == "inv_123"

    def test_unique_ids(self):
        """All generated IDs should be unique."""
        new = [
            {"dateISO": "2024-12-15", "amount": 100.0, "description": "Shop A", "source": "cc", "detectedBank": "maybank"},
            {"dateISO": "2024-12-15", "amount": 100.0, "description": "Shop B", "source": "cc", "detectedBank": "maybank"},
            {"dateISO": "2024-12-15", "amount": 200.0, "description": "Shop A", "source": "cc", "detectedBank": "maybank"},
        ]
        merged, added, dups = merge_transactions([], new)
        ids = [t["id"] for t in merged]
        assert len(ids) == len(set(ids))  # all unique

    def test_empty_new(self):
        """Merging empty list should return existing unchanged."""
        existing = [
            {"dateISO": "2024-12-15", "amount": 100.0, "description": "Shop",
             "source": "cc", "detectedBank": "maybank", "id": "cc_0"},
        ]
        merged, added, dups = merge_transactions(existing, [])
        assert added == 0
        assert dups == 0
        assert len(merged) == 1

    def test_both_empty(self):
        merged, added, dups = merge_transactions([], [])
        assert merged == []
        assert added == 0
        assert dups == 0
