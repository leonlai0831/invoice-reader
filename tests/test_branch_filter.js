/**
 * Tests for branch multi-select filter logic.
 * Run: node tests/test_branch_filter.js
 */

const BRANCHES = ["HQ","BK","BT","PK","PJ","KK","KM","QSM","USJ","DPC","OTG"];

function filterRows(rows, filterBranches, filterCat, search) {
  let filtered = rows.filter(r => {
    if (filterBranches.size > 0 && !filterBranches.has(r.branch)) return false;
    if (filterCat && r.category !== filterCat) return false;
    return true;
  });
  if (search) {
    const q = search.toLowerCase().trim();
    filtered = filtered.filter(r =>
      (r.supplierName || "").toLowerCase().includes(q) ||
      (r.branch || "").toLowerCase().includes(q)
    );
  }
  return filtered;
}

function getBtnText(filterBranches) {
  const n = filterBranches.size;
  if (n === 0 || n === BRANCHES.length) return "所有 Branch ▾";
  if (n <= 3) return [...filterBranches].join(", ") + " ▾";
  return `已选 ${n} 个 ▾`;
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error("FAIL:", msg); }
}

const testRows = [
  { id: "1", branch: "HQ", category: "Telco", supplierName: "Maxis" },
  { id: "2", branch: "BK", category: "Telco", supplierName: "TM" },
  { id: "3", branch: "BT", category: "Marketing", supplierName: "Google" },
  { id: "4", branch: "HQ", category: "Marketing", supplierName: "Meta" },
  { id: "5", branch: "PJ", category: "Others", supplierName: "Adobe" },
  { id: "6", branch: "", category: "Telco", supplierName: "Digi" },
];

// Test 1: Empty filter = show all
let result = filterRows(testRows, new Set(), "", "");
assert(result.length === 6, "empty filter should return all rows");

// Test 2: Single branch selected
result = filterRows(testRows, new Set(["HQ"]), "", "");
assert(result.length === 2, "HQ filter should return 2 rows");
assert(result.every(r => r.branch === "HQ"), "all results should be HQ");

// Test 3: Multiple branches selected
result = filterRows(testRows, new Set(["HQ", "BK"]), "", "");
assert(result.length === 3, "HQ+BK filter should return 3 rows");

// Test 4: All branches selected = show all (including empty branch rows)
result = filterRows(testRows, new Set(BRANCHES), "", "");
assert(result.length === 5, "all branches selected should return 5 (excludes empty branch)");

// Test 5: Multi-branch + category filter combined
result = filterRows(testRows, new Set(["HQ", "BK"]), "Telco", "");
assert(result.length === 2, "HQ+BK with Telco category should return 2");
assert(result[0].supplierName === "Maxis" && result[1].supplierName === "TM", "should be Maxis and TM");

// Test 6: Multi-branch + search combined
result = filterRows(testRows, new Set(["HQ", "BT"]), "", "goo");
assert(result.length === 1, "HQ+BT with search 'goo' should return 1");
assert(result[0].supplierName === "Google", "should be Google");

// Test 7: Empty branch rows excluded when any branch selected
result = filterRows(testRows, new Set(["HQ"]), "", "");
assert(!result.some(r => r.branch === ""), "empty branch rows should be excluded");

// Test 8: Button text - none selected
assert(getBtnText(new Set()) === "所有 Branch ▾", "0 selected = '所有 Branch ▾'");

// Test 9: Button text - 1-3 selected
assert(getBtnText(new Set(["HQ"])) === "HQ ▾", "1 selected = 'HQ ▾'");
assert(getBtnText(new Set(["HQ", "BK"])) === "HQ, BK ▾", "2 selected = comma joined");
assert(getBtnText(new Set(["HQ", "BK", "BT"])) === "HQ, BK, BT ▾", "3 selected = comma joined");

// Test 10: Button text - 4+ selected
assert(getBtnText(new Set(["HQ", "BK", "BT", "PK"])) === "已选 4 个 ▾", "4 selected = count");

// Test 11: Button text - all selected
assert(getBtnText(new Set(BRANCHES)) === "所有 Branch ▾", "all selected = '所有 Branch ▾'");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
