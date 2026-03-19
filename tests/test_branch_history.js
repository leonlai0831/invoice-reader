/**
 * Tests for buildBranchHistoryMap logic (archive-only).
 * Run: node tests/test_branch_history.js
 */

function buildBranchHistoryMap(archivedClaims) {
  const map = new Map();
  for (const claim of archivedClaims) {
    const claimDate = claim.date || "";
    for (const row of (claim.rows || [])) {
      const supplier = (row.supplierName || "").trim().toUpperCase();
      const branch = (row.branch || "").trim();
      if (!supplier || !branch) continue;
      if (!map.has(supplier)) map.set(supplier, []);
      map.get(supplier).push({ branch, claimDate, invoiceDate: row.invoiceDate || "" });
    }
  }
  for (const [key, entries] of map) {
    entries.sort((a, b) => b.claimDate.localeCompare(a.claimDate));
    if (entries.length > 5) map.set(key, entries.slice(0, 5));
  }
  return map;
}

let passed = 0;
let failed = 0;
function assert(condition, msg) {
  if (condition) { passed++; }
  else { failed++; console.error("FAIL:", msg); }
}

// Test 1: Empty archive
let map = buildBranchHistoryMap([]);
assert(map.size === 0, "empty archive should produce empty map");

// Test 2: Single claim, single row
map = buildBranchHistoryMap([{
  date: "2026-01-15 10:00:00",
  rows: [{ supplierName: "LCYCONSULTING", branch: "HQ", invoiceDate: "15/01/2026" }]
}]);
assert(map.has("LCYCONSULTING"), "should have LCYCONSULTING");
assert(map.get("LCYCONSULTING").length === 1, "should have 1 entry");
assert(map.get("LCYCONSULTING")[0].branch === "HQ", "branch should be HQ");

// Test 3: Rotation pattern — most recent first
map = buildBranchHistoryMap([
  { date: "2026-01-15 10:00:00", rows: [{ supplierName: "LCYCONSULTING", branch: "HQ", invoiceDate: "15/01/2026" }] },
  { date: "2026-02-15 10:00:00", rows: [{ supplierName: "LCYCONSULTING", branch: "BK", invoiceDate: "15/02/2026" }] },
  { date: "2026-03-15 10:00:00", rows: [{ supplierName: "LCYCONSULTING", branch: "BT", invoiceDate: "15/03/2026" }] },
]);
assert(map.get("LCYCONSULTING")[0].branch === "BT", "most recent should be BT");
assert(map.get("LCYCONSULTING")[1].branch === "BK", "second should be BK");
assert(map.get("LCYCONSULTING")[2].branch === "HQ", "oldest should be HQ");

// Test 4: Empty branch filtered out
map = buildBranchHistoryMap([{
  date: "2026-01-15 10:00:00",
  rows: [{ supplierName: "VENDOR", branch: "", invoiceDate: "" }]
}]);
assert(!map.has("VENDOR"), "empty branch should be filtered out");

// Test 5: Cap at 5 entries
const claims = [];
for (let i = 0; i < 10; i++) {
  claims.push({
    date: `2026-${String(i + 1).padStart(2, "0")}-01 10:00:00`,
    rows: [{ supplierName: "BIG CO", branch: `BR${i}`, invoiceDate: `01/${String(i + 1).padStart(2, "0")}/2026` }]
  });
}
map = buildBranchHistoryMap(claims);
assert(map.get("BIG CO").length === 5, "should cap at 5 entries");
assert(map.get("BIG CO")[0].claimDate.startsWith("2026-10"), "first should be most recent (month 10)");

// Test 6: Case normalization and trim
map = buildBranchHistoryMap([{
  date: "2026-01-01 00:00:00",
  rows: [{ supplierName: "  Google Asia  ", branch: "PJ", invoiceDate: "" }]
}]);
assert(map.has("GOOGLE ASIA"), "should normalize to uppercase trimmed");

// Test 7: Multiple suppliers in same claim
map = buildBranchHistoryMap([{
  date: "2026-03-01 10:00:00",
  rows: [
    { supplierName: "VENDOR A", branch: "HQ", invoiceDate: "" },
    { supplierName: "VENDOR B", branch: "BK", invoiceDate: "" },
  ]
}]);
assert(map.has("VENDOR A") && map.has("VENDOR B"), "should track both suppliers");
assert(map.get("VENDOR A")[0].branch === "HQ", "VENDOR A should be HQ");
assert(map.get("VENDOR B")[0].branch === "BK", "VENDOR B should be BK");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
