"""Smart Memory — learns supplier/category/branch/description patterns from submitted claims."""

import os
import json
import re
from datetime import datetime

MEMORY_FILE = "memory.json"

# ── Hardcoded reference lists (must match app.js) ────────────────

HARDCODED_SUPPLIERS = [
    "GOOGLE ASIA PACIFIC PTE LTD", "META PLATFORMS IRELAND LIMITED",
    "CELCOM MOBILE SDN BHD", "CELCOMDIGI TELECOMMUNICATION SDN BHD",
    "TM TECHNOLOGY SERVICES SDN BHD", "MAXIS BROADBAND SDN BHD",
    "DIGI TELECOMMUNICATIONS SDN BHD", "ADOBE SYSTEMS SOFTWARE IRELAND LTD",
    "APPLE MALAYSIA SDN BHD", "ARTSCAPE ADVERTISING DESIGN STUDIO",
    "AGENSI PEKERJAAN JOBSTREET.COM SDN BHD", "BUYMALL SERVICES SDN BHD",
    "200 LABS, INC", "BEANSTALK SOLUTIONS SDN BHD",
    "C&L LIGHTING M SDN BHD", "BECON ENTERPRISE SDN BHD",
]

HARDCODED_DESC_BY_CAT = {
    "Advertisement": ["FB ads", "Google ads", "Gym FB ads", "Gym Google ads",
                      "Swimming FB ads", "Swimming Google ads", "Tiktok ads"],
    "Subscription": ["FB Verified service", "Google Drive", "Gym Youtube Premium",
                     "Capcut pro subscription", "PDF editor", "AI agent",
                     "FB AI chatbot", "Gym FB AI chatbot", "Swimming FB AI chatbot"],
    "Telco": ["Center internet service", "Gym internet service",
              "Center and director phone bill", "Center phone bill",
              "Director phone bill", "Hostel wifi service", "XHS phone data service"],
    "Marketing": ["Artwork design service", "Branding colour guide", "Gym logo design",
                  "Gym web design", "Marketing service", "Tiktok KOC video shooting",
                  "XHS KOC video", "KOC recruitment service", "Booth event flyer printing"],
    "Purchasing": ["Gym equipment", "Gym pilates equipment", "Gym sauna equipment",
                   "Gym ice bath machine", "Gym lighting", "Gym toilet lighting",
                   "Gym light bulb", "Gym hair dryer bracket", "Gym hand soap bottle",
                   "Gym toilet paper", "Center furniture", "Office equipment",
                   "Director laptop", "Marketing laptop", "Gym PC set",
                   "keyboard mouse set", "A4 paper", "Pool decking liner",
                   "Swimming pool heater"],
    "Shipping": ["Shipping fee", "Gym item shipping fee",
                 "Gym pilates equipment shipping fee", "Gym sauna equipment shipping fee",
                 "Gym ice bath machine shipping fee", "Office equipment shipping fee",
                 "Center furniture shipping", "Heater shipping fee",
                 "Event booth item shipping fee"],
    "Maintenance": ["Gym equipment maintenance", "Gym equipment replacement part",
                    "Center pc repair", "Cleaning service"],
    "Renovation": ["Gym internet installation", "Lighting part for renovation",
                   "BT shoplot TNB deposit"],
    "HR": ["Management course", "PT training sponsorship for staff",
            "MRI claim", "Payroll system renewal"],
    "Recruitment": ["KOC recruitment service", "JOb hiring ads", "recruitment ad"],
    "Staff Welfare": ["Hostel wifi service", "Dinner",
                      "Marketing team lunch treat", "Lunch treat for staff after event"],
    "Welfare": ["Dinner", "Flower stand for Cedric", "Lunch treat for staff after event"],
    "Stationary": ["A4 paper", "Office stationary", "Gym attendance card",
                   "Gym printer ink", "Center printer ink"],
    "Sanitary": ["Gym toilet paper", "Gym hand soap bottle",
                 "Gym shower soap dispenser", "Sanitory refill"],
    "Others": ["TTPM online registration charge", "Competitor SSM report purchase",
               "Gym business trip flight", "Gym business trip hotel"],
}

ALL_HARDCODED_DESCS = set()
for _descs in HARDCODED_DESC_BY_CAT.values():
    ALL_HARDCODED_DESCS.update(_descs)


# ── Persistence ──────────────────────────────────────────────────

def _memory_path(claims_root):
    return os.path.join(claims_root, MEMORY_FILE)


def load_memory(claims_root):
    """Load memory.json from claims root. Returns default if missing."""
    path = _memory_path(claims_root)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return _empty_memory()


def save_memory(claims_root, mem):
    """Save memory.json to claims root (atomic write)."""
    mem["lastUpdated"] = datetime.now().isoformat()
    path = _memory_path(claims_root)
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(mem, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_path, path)


def _empty_memory():
    return {
        "version": 1,
        "lastUpdated": "",
        "suppliers": {},
        "customSuppliers": [],
        "customDescriptions": {},
        "branchAddresses": {},
    }


# ── Supplier Name Normalization ──────────────────────────────────

def _normalize_name(name):
    """Uppercase, strip punctuation, collapse whitespace."""
    n = (name or "").upper().strip()
    n = re.sub(r"[.,()']", "", n)
    n = re.sub(r"\s+", " ", n)
    return n


def _word_set(name):
    """Extract significant words (2+ alphanumeric chars) for fuzzy matching."""
    return set(re.findall(r"[A-Z0-9]{2,}", (name or "").upper()))


def _name_similarity(a, b):
    """Word-overlap similarity between two strings (0..1)."""
    words_a = _word_set(a)
    words_b = _word_set(b)
    if not words_a or not words_b:
        return 0
    overlap = len(words_a & words_b)
    return overlap / max(len(words_a), len(words_b))


SUPPLIER_MATCH_THRESHOLD = 0.75


def find_canonical_supplier(raw_name, memory):
    """Find best matching canonical supplier in memory.

    Returns (canonical_name, score) or (None, 0).
    """
    if not raw_name:
        return None, 0

    norm = _normalize_name(raw_name)
    suppliers = memory.get("suppliers", {})

    best_name = None
    best_score = 0.0

    for canonical, entry in suppliers.items():
        # Exact normalized match against canonical key
        if _normalize_name(canonical) == norm:
            return canonical, 1.0

        # Exact normalized match against known variants
        for variant in entry.get("variants", []):
            if _normalize_name(variant) == norm:
                return canonical, 1.0

        # Fuzzy match
        score = _name_similarity(raw_name, canonical)
        for variant in entry.get("variants", []):
            s = _name_similarity(raw_name, variant)
            score = max(score, s)

        if score > best_score:
            best_score = score
            best_name = canonical

    if best_score >= SUPPLIER_MATCH_THRESHOLD:
        return best_name, best_score
    return None, 0


# ── Learning ─────────────────────────────────────────────────────

def _strip_currency_note(desc):
    """Remove trailing (USD 123.45) or (CNY 50.00 @ 0.62) annotations."""
    return re.sub(r"\s*\([A-Z]{3}\s+[\d.]+(?:\s*@\s*[\d.]+)?\)$", "", desc or "")


def learn_from_rows(claims_root, rows):
    """Update memory from a batch of submitted claim rows."""
    mem = load_memory(claims_root)

    hardcoded_supplier_set = set(s.upper() for s in HARDCODED_SUPPLIERS)
    custom_suppliers = set(mem.get("customSuppliers", []))
    custom_descs = dict(mem.get("customDescriptions", {}))

    for row in rows:
        raw_supplier = (row.get("supplierName") or "").strip()
        if not raw_supplier:
            continue

        # Find or create canonical supplier entry
        canonical, _score = find_canonical_supplier(raw_supplier, mem)
        if canonical is None:
            canonical = _normalize_name(raw_supplier)

        if canonical not in mem["suppliers"]:
            mem["suppliers"][canonical] = {
                "variants": [],
                "categories": {},
                "descriptions": {},
                "branches": {},
                "count": 0,
            }

        entry = mem["suppliers"][canonical]

        # Record variant
        if raw_supplier not in entry["variants"]:
            entry["variants"].append(raw_supplier)

        # Category frequency
        cat = row.get("category", "")
        if cat:
            entry["categories"][cat] = entry["categories"].get(cat, 0) + 1

        # Description frequency (strip currency annotation)
        base_desc = _strip_currency_note(row.get("description", ""))
        if base_desc:
            entry["descriptions"][base_desc] = entry["descriptions"].get(base_desc, 0) + 1

        # Branch frequency
        branch = row.get("branch", "")
        if branch:
            entry["branches"][branch] = entry["branches"].get(branch, 0) + 1

        entry["count"] += 1

        # --- Detect custom (non-hardcoded) suppliers ---
        if raw_supplier.upper() not in hardcoded_supplier_set:
            custom_suppliers.add(raw_supplier.upper())

        # --- Detect custom descriptions ---
        hardcoded_for_cat = set(HARDCODED_DESC_BY_CAT.get(cat, []))
        if base_desc and base_desc not in ALL_HARDCODED_DESCS and base_desc not in hardcoded_for_cat:
            if cat not in custom_descs:
                custom_descs[cat] = []
            if base_desc not in custom_descs[cat]:
                custom_descs[cat].append(base_desc)

    mem["customSuppliers"] = sorted(custom_suppliers)
    mem["customDescriptions"] = custom_descs
    save_memory(claims_root, mem)
    return mem


# ── Prediction / Applying Memory ─────────────────────────────────

def apply_memory(claims_root, extracted_data):
    """Enhance AI-extracted data with memory predictions.

    Returns a new dict with original data plus memory-prefixed keys.
    """
    mem = load_memory(claims_root)
    result = dict(extracted_data)

    raw_supplier = result.get("supplierName", "")
    canonical, score = find_canonical_supplier(raw_supplier, mem)

    if canonical and canonical in mem["suppliers"]:
        entry = mem["suppliers"][canonical]

        # Canonical supplier name
        result["memoryCanonicalSupplier"] = canonical
        result["memorySupplierScore"] = round(score, 3)

        # Predict category (highest frequency)
        if entry.get("categories"):
            best_cat = max(entry["categories"], key=entry["categories"].get)
            result["memoryCategory"] = best_cat
            result["memoryCategoryCount"] = entry["categories"][best_cat]

        # Suggest descriptions (sorted by frequency, top 5)
        if entry.get("descriptions"):
            sorted_descs = sorted(entry["descriptions"].items(),
                                  key=lambda x: x[1], reverse=True)
            result["memoryDescriptions"] = [d[0] for d in sorted_descs[:5]]

        # Predict branch (if ≥ 60% confidence)
        if entry.get("branches"):
            best_branch = max(entry["branches"], key=entry["branches"].get)
            total = sum(entry["branches"].values())
            confidence = entry["branches"][best_branch] / total
            if confidence >= 0.6:
                result["memoryBranch"] = best_branch
                result["memoryBranchConfidence"] = round(confidence, 3)

    return result


# ── Address-Based Branch Matching ────────────────────────────────

ADDRESS_MATCH_THRESHOLD = 0.3


def match_branch_by_address(claims_root, invoice_address):
    """Match an extracted invoice address to a configured branch.

    Returns (branch_code, confidence) or (None, 0).
    """
    mem = load_memory(claims_root)
    branch_addrs = mem.get("branchAddresses", {})

    if not branch_addrs or not invoice_address:
        return None, 0

    addr_words = set(re.findall(r"[A-Za-z0-9]{2,}", invoice_address.upper()))
    if not addr_words:
        return None, 0

    best_branch = None
    best_score = 0.0

    for branch_code, branch_addr in branch_addrs.items():
        branch_words = set(re.findall(r"[A-Za-z0-9]{2,}", branch_addr.upper()))
        if not branch_words:
            continue
        overlap = len(addr_words & branch_words)
        score = overlap / max(len(addr_words), len(branch_words))
        if score > best_score:
            best_score = score
            best_branch = branch_code

    if best_score >= ADDRESS_MATCH_THRESHOLD:
        return best_branch, round(best_score, 3)
    return None, 0


# ── Rebuild from Archive ─────────────────────────────────────────

def rebuild_memory(claims_root):
    """Rebuild memory.json from scratch using archive.json.

    Preserves user-configured branchAddresses.
    """
    archive_path = os.path.join(claims_root, "archive.json")
    if not os.path.exists(archive_path):
        return {"ok": False, "error": "No archive.json found"}

    # Load archive FIRST — if it fails, we preserve existing memory
    try:
        with open(archive_path, "r", encoding="utf-8") as f:
            archive = json.load(f)
    except (json.JSONDecodeError, Exception) as e:
        return {"ok": False, "error": f"Failed to read archive.json: {e}"}

    # Keep branchAddresses (user-configured, not derived from data)
    old_mem = load_memory(claims_root)
    old_addrs = old_mem.get("branchAddresses", {})

    # Reset memory only after archive is successfully loaded
    mem = _empty_memory()
    mem["branchAddresses"] = old_addrs
    save_memory(claims_root, mem)

    # Re-learn from all archived claim rows
    all_rows = []
    for claim in archive:
        all_rows.extend(claim.get("rows", []))

    if all_rows:
        learn_from_rows(claims_root, all_rows)

    return {"ok": True, "rowsProcessed": len(all_rows)}
