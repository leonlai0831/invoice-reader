"""Tests for memory.py — supplier matching, learning, and prediction."""

import os
import json
import pytest

from memory import (
    _normalize_name, _word_set, _name_similarity, _strip_currency_note,
    find_canonical_supplier, load_memory, save_memory, learn_from_rows,
    apply_memory, match_branch_by_address, rebuild_memory,
    SUPPLIER_MATCH_THRESHOLD,
)


# ── Name Normalization ────────────────────────────────────────────

class TestNormalizeName:
    def test_uppercases(self):
        assert _normalize_name("google") == "GOOGLE"

    def test_strips_punctuation(self):
        assert _normalize_name("Google (M) Sdn. Bhd.") == "GOOGLE M SDN BHD"

    def test_collapses_whitespace(self):
        assert _normalize_name("  Google   Asia  ") == "GOOGLE ASIA"

    def test_empty_input(self):
        assert _normalize_name("") == ""
        assert _normalize_name(None) == ""


class TestWordSet:
    def test_extracts_words(self):
        words = _word_set("Google Asia Pacific PTE LTD")
        assert "GOOGLE" in words
        assert "ASIA" in words
        assert "PACIFIC" in words

    def test_ignores_short_words(self):
        words = _word_set("A B CD EFG")
        assert "A" not in words
        assert "B" not in words
        assert "CD" in words


class TestNameSimilarity:
    def test_identical(self):
        assert _name_similarity("GOOGLE ASIA PACIFIC", "GOOGLE ASIA PACIFIC") == 1.0

    def test_zero_on_empty(self):
        assert _name_similarity("", "test") == 0
        assert _name_similarity(None, None) == 0


class TestStripCurrencyNote:
    def test_strips_usd_note(self):
        assert _strip_currency_note("Google ads (USD 100.00)") == "Google ads"

    def test_strips_with_rate(self):
        assert _strip_currency_note("FB ads (CNY 50.00 @ 0.62)") == "FB ads"

    def test_no_note_unchanged(self):
        assert _strip_currency_note("Google ads") == "Google ads"

    def test_empty(self):
        assert _strip_currency_note("") == ""


# ── Persistence ───────────────────────────────────────────────────

class TestLoadSaveMemory:
    def test_load_default_when_missing(self, tmp_dir):
        mem = load_memory(tmp_dir)
        assert mem["version"] == 1
        assert mem["suppliers"] == {}

    def test_save_then_load(self, tmp_dir):
        mem = load_memory(tmp_dir)
        mem["suppliers"]["TEST"] = {"variants": ["Test Inc"], "categories": {}, "descriptions": {}, "branches": {}, "count": 1}
        save_memory(tmp_dir, mem)

        loaded = load_memory(tmp_dir)
        assert "TEST" in loaded["suppliers"]
        assert loaded["lastUpdated"] != ""

    def test_atomic_write_no_tmp_file(self, tmp_dir):
        mem = load_memory(tmp_dir)
        save_memory(tmp_dir, mem)
        files = [f for f in os.listdir(tmp_dir) if f.startswith("memory")]
        assert files == ["memory.json"]


# ── Supplier Matching ─────────────────────────────────────────────

class TestFindCanonicalSupplier:
    def _mem_with_supplier(self, canonical, variants=None):
        return {
            "suppliers": {
                canonical: {
                    "variants": variants or [],
                    "categories": {},
                    "descriptions": {},
                    "branches": {},
                    "count": 5,
                }
            }
        }

    def test_exact_match(self):
        mem = self._mem_with_supplier("GOOGLE ASIA PACIFIC PTE LTD")
        name, score = find_canonical_supplier("Google Asia Pacific Pte Ltd", mem)
        assert name == "GOOGLE ASIA PACIFIC PTE LTD"
        assert score == 1.0

    def test_variant_match(self):
        mem = self._mem_with_supplier("GOOGLE", variants=["Google Asia Pacific PTE LTD"])
        name, score = find_canonical_supplier("Google Asia Pacific PTE LTD", mem)
        assert name == "GOOGLE"
        assert score == 1.0

    def test_fuzzy_match(self):
        mem = self._mem_with_supplier("GOOGLE ASIA PACIFIC PTE LTD")
        # 4/5 words overlap = 0.8, above 0.75 threshold
        name, score = find_canonical_supplier("GOOGLE ASIA PACIFIC PTE", mem)
        assert name == "GOOGLE ASIA PACIFIC PTE LTD"
        assert score >= SUPPLIER_MATCH_THRESHOLD

    def test_no_match(self):
        mem = self._mem_with_supplier("GOOGLE")
        name, score = find_canonical_supplier("COMPLETELY DIFFERENT COMPANY", mem)
        assert name is None
        assert score == 0

    def test_empty_input(self):
        mem = self._mem_with_supplier("GOOGLE")
        name, score = find_canonical_supplier("", mem)
        assert name is None


# ── Learning ──────────────────────────────────────────────────────

class TestLearnFromRows:
    def test_creates_supplier_entry(self, tmp_dir):
        rows = [{"supplierName": "New Vendor Ltd", "category": "Purchasing",
                 "description": "Office supplies", "branch": "HQ"}]
        mem = learn_from_rows(tmp_dir, rows)
        # Should have created a canonical entry
        assert len(mem["suppliers"]) == 1

    def test_tracks_category_frequency(self, tmp_dir):
        rows = [
            {"supplierName": "Vendor A", "category": "Telco", "description": "Internet", "branch": ""},
            {"supplierName": "Vendor A", "category": "Telco", "description": "Phone", "branch": ""},
            {"supplierName": "Vendor A", "category": "Purchasing", "description": "Item", "branch": ""},
        ]
        mem = learn_from_rows(tmp_dir, rows)
        canonical = list(mem["suppliers"].keys())[0]
        assert mem["suppliers"][canonical]["categories"]["Telco"] == 2
        assert mem["suppliers"][canonical]["categories"]["Purchasing"] == 1

    def test_detects_custom_suppliers(self, tmp_dir):
        rows = [{"supplierName": "BRAND NEW COMPANY SDN BHD", "category": "", "description": "", "branch": ""}]
        mem = learn_from_rows(tmp_dir, rows)
        assert "BRAND NEW COMPANY SDN BHD" in mem["customSuppliers"]

    def test_detects_custom_descriptions(self, tmp_dir):
        rows = [{"supplierName": "Test", "category": "Advertisement",
                 "description": "Custom ad service XYZ", "branch": ""}]
        mem = learn_from_rows(tmp_dir, rows)
        assert "Custom ad service XYZ" in mem["customDescriptions"].get("Advertisement", [])


# ── Prediction ────────────────────────────────────────────────────

class TestApplyMemory:
    def _setup_memory(self, tmp_dir):
        mem = {
            "version": 1, "lastUpdated": "", "customSuppliers": [], "customDescriptions": {},
            "branchAddresses": {},
            "suppliers": {
                "GOOGLE ASIA PACIFIC PTE LTD": {
                    "variants": ["Google Asia Pacific Pte. Ltd."],
                    "categories": {"Advertisement": 10, "Subscription": 2},
                    "descriptions": {"Google ads": 8, "Google Drive": 2},
                    "branches": {"HQ": 9, "PDD": 1},
                    "count": 12,
                }
            }
        }
        save_memory(tmp_dir, mem)

    def test_predicts_category(self, tmp_dir):
        self._setup_memory(tmp_dir)
        result = apply_memory(tmp_dir, {"supplierName": "Google Asia Pacific PTE LTD"})
        assert result["memoryCategory"] == "Advertisement"

    def test_suggests_descriptions(self, tmp_dir):
        self._setup_memory(tmp_dir)
        result = apply_memory(tmp_dir, {"supplierName": "Google Asia Pacific PTE LTD"})
        assert "Google ads" in result["memoryDescriptions"]

    def test_predicts_branch_with_confidence(self, tmp_dir):
        self._setup_memory(tmp_dir)
        result = apply_memory(tmp_dir, {"supplierName": "Google Asia Pacific PTE LTD"})
        assert result["memoryBranch"] == "HQ"
        assert result["memoryBranchConfidence"] >= 0.6

    def test_no_prediction_for_unknown(self, tmp_dir):
        self._setup_memory(tmp_dir)
        result = apply_memory(tmp_dir, {"supplierName": "TOTALLY UNKNOWN COMPANY"})
        assert "memoryCategory" not in result


# ── Address Matching ──────────────────────────────────────────────

class TestMatchBranchByAddress:
    def _setup_addresses(self, tmp_dir):
        mem = {
            "version": 1, "lastUpdated": "", "suppliers": {},
            "customSuppliers": [], "customDescriptions": {},
            "branchAddresses": {
                "HQ": "No 10 Jalan Sultan Ismail, Kuala Lumpur 50250",
                "PDD": "Lot 15 Jalan Ampang, Petaling Jaya 47301",
            }
        }
        save_memory(tmp_dir, mem)

    def test_matches_address(self, tmp_dir):
        self._setup_addresses(tmp_dir)
        branch, score = match_branch_by_address(tmp_dir, "Jalan Sultan Ismail, KL 50250")
        assert branch == "HQ"
        assert score > 0

    def test_no_match_unrelated(self, tmp_dir):
        self._setup_addresses(tmp_dir)
        branch, score = match_branch_by_address(tmp_dir, "123 Tokyo Street Japan")
        assert branch is None

    def test_empty_address(self, tmp_dir):
        self._setup_addresses(tmp_dir)
        branch, score = match_branch_by_address(tmp_dir, "")
        assert branch is None
