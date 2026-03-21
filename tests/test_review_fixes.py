"""Tests for code review fixes and ai_extractor.py."""

import json
import os
import pytest


# ── Fix #5: _parse_amount European format ────────────────────────

class TestParseAmountEuropean:
    def test_european_thousands_dot(self):
        from matcher import _parse_amount
        # "1.234" with 3 digits after dot => thousands separator => 1234
        assert _parse_amount("1.234") == 1234

    def test_european_thousands_large(self):
        from matcher import _parse_amount
        assert _parse_amount("12.345") == 12345

    def test_normal_decimal_2_digits(self):
        from matcher import _parse_amount
        # "1.23" with 2 digits after dot => normal decimal
        assert _parse_amount("1.23") == 1.23

    def test_normal_decimal_1_digit(self):
        from matcher import _parse_amount
        # "1.2" with 1 digit after dot => normal decimal
        assert _parse_amount("1.2") == 1.2

    def test_multiple_dots_european(self):
        from matcher import _parse_amount
        # "1.234.56" => 1234.56 (existing behavior)
        assert _parse_amount("1.234.56") == 1234.56

    def test_rm_prefixed_thousands(self):
        from matcher import _parse_amount
        assert _parse_amount("RM 1.234") == 1234

    def test_four_digit_after_dot_is_normal(self):
        from matcher import _parse_amount
        # "1.2345" => should stay as 1.2345 (not matching 3-digit rule)
        assert _parse_amount("1.2345") == 1.2345

    def test_zero_dot_three_digits(self):
        from matcher import _parse_amount
        # "0.500" should stay as 0.5, not 500 (integer_part is "0")
        assert _parse_amount("0.500") == 0.5


# ── Fix #7: _parse_json_array with nested braces ────────────────

class TestParseJsonArrayNested:
    def test_simple_array(self):
        from ai_extractor import _parse_json_array
        result = _parse_json_array('[{"date": "01/01/2026", "amount": 100}]')
        assert len(result) == 1
        assert result[0]["amount"] == 100

    def test_nested_braces_in_description(self):
        from ai_extractor import _parse_json_array
        # This would fail with the old regex approach
        text = '[{"date": "01/01/2026", "description": "A {B} C", "amount": 50}]'
        result = _parse_json_array(text)
        assert len(result) == 1
        assert result[0]["description"] == "A {B} C"

    def test_truncated_array_recovery(self):
        from ai_extractor import _parse_json_array
        # Simulate truncated AI response with two complete objects and one incomplete
        text = '[{"date": "01/01/2026", "amount": 100}, {"date": "02/01/2026", "amount": 200}, {"date": "03/01/20'
        result = _parse_json_array(text)
        assert len(result) == 2
        assert result[0]["amount"] == 100
        assert result[1]["amount"] == 200


# ── Fix #7: _parse_json_object ───────────────────────────────────

class TestParseJsonObject:
    def test_clean_json(self):
        from ai_extractor import _parse_json_object
        result = _parse_json_object('{"supplierName": "TEST", "amount": "100"}')
        assert result["supplierName"] == "TEST"

    def test_wrapped_in_markdown(self):
        from ai_extractor import _parse_json_object
        text = '```json\n{"supplierName": "TEST"}\n```'
        result = _parse_json_object(text)
        assert result["supplierName"] == "TEST"

    def test_invalid_raises(self):
        from ai_extractor import _parse_json_object
        with pytest.raises(ValueError):
            _parse_json_object("not json at all")


# ── Fix #4: Cache trimming ───────────────────────────────────────

class TestCacheTrimming:
    def test_trim_preserves_newest(self, tmp_dir):
        from extraction_cache import _save_extract_cache
        # Build a cache with 510 entries
        cache = {}
        for i in range(510):
            cache[f"hash_{i:04d}"] = {
                "data": {"test": i},
                "cachedAt": f"2026-01-01T{i // 60:02d}:{i % 60:02d}:00",
            }
        _save_extract_cache(tmp_dir, cache)
        # Cache should be trimmed to 500
        assert len(cache) == 500
        # The newest entries should remain
        assert "hash_0509" in cache  # newest
        assert "hash_0000" not in cache  # oldest trimmed
