/**
 * Tests for CC manual assign logic (manualAssignCC).
 * Run: node tests/test_cc_manual_assign.js
 */

function doManualAssign(ccTxn, inv) {
  // Replicate manualAssignCC logic (pure function, no DOM/side-effects)
  ccTxn.matched = true;
  ccTxn.matchedInvoiceId = inv.id;
  inv.ccMatched = true;

  const ccAmt = ccTxn.amount;
  const origAmt = parseFloat(String(inv.originalAmount || "").replace(/[^0-9.]/g, "")) || 0;
  const isForeign = inv.originalCurrency && inv.originalCurrency !== "MYR" && origAmt > 0;

  if (isForeign) {
    const actualRate = ccAmt / origAmt;
    inv.ccActualRate = parseFloat(actualRate.toFixed(6));
    inv.amount = ccAmt.toFixed(2);
    const base = inv.description.replace(/\s*\([A-Z]{3}\s+[\d.]+(?:\s*@\s*[\d.]+)?\)$/, "");
    inv.description = `${base} (${inv.originalCurrency} ${origAmt.toFixed(2)} @ ${inv.ccActualRate})`;
  } else {
    inv.amount = ccAmt.toFixed(2);
  }
}

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) passed++;
  else { failed++; console.error("FAIL:", msg); }
}

// Test 1: Basic matched flags
{
  const cc = { id: "wx_0", amount: 67.44, matched: false, matchedInvoiceId: null };
  const inv = { id: "inv_1", amount: "", ccMatched: false, originalAmount: "", originalCurrency: "MYR", description: "test" };
  doManualAssign(cc, inv);
  assert(cc.matched === true, "CC should be marked matched");
  assert(cc.matchedInvoiceId === "inv_1", "CC matchedInvoiceId should be inv_1");
  assert(inv.ccMatched === true, "invoice should be marked ccMatched");
}

// Test 2: MYR CC transaction overwrites amount
{
  const cc = { id: "cc_0", amount: 120.50, matched: false, matchedInvoiceId: null };
  const inv = { id: "inv_2", amount: "119.00", ccMatched: false, originalAmount: "", originalCurrency: "MYR", description: "Some vendor" };
  doManualAssign(cc, inv);
  assert(inv.amount === "120.50", "invoice amount should be overwritten to 120.50");
}

// Test 3: WeChat CNY with no originalAmount (no foreign calc)
{
  const cc = { id: "wx_1", amount: 67.44, matched: false, matchedInvoiceId: null };
  const inv = { id: "inv_3", amount: "", ccMatched: false, originalAmount: "", originalCurrency: "CNY", description: "WeChat vendor" };
  doManualAssign(cc, inv);
  assert(inv.amount === "67.44", "amount should be CC amount");
  assert(inv.ccActualRate === undefined, "no actual rate when originalAmount is empty");
}

// Test 4: Foreign currency with originalAmount — rate calculation
{
  const cc = { id: "cc_1", amount: 445.00, matched: false, matchedInvoiceId: null };
  const inv = { id: "inv_4", amount: "", ccMatched: false, originalAmount: "100.00", originalCurrency: "USD", description: "US vendor" };
  doManualAssign(cc, inv);
  assert(inv.amount === "445.00", "amount should be CC MYR charge");
  assert(inv.ccActualRate === 4.45, "actual rate should be 4.45");
  assert(inv.description === "US vendor (USD 100.00 @ 4.45)", "description should include rate annotation");
}

// Test 5: Foreign currency — description with existing rate annotation gets replaced
{
  const cc = { id: "cc_2", amount: 450.00, matched: false, matchedInvoiceId: null };
  const inv = { id: "inv_5", amount: "440.00", ccMatched: false, originalAmount: "100.00", originalCurrency: "USD", description: "US vendor (USD 100.00 @ 4.40)" };
  doManualAssign(cc, inv);
  assert(inv.amount === "450.00", "amount updated");
  assert(inv.ccActualRate === 4.5, "rate should be 4.5");
  assert(inv.description === "US vendor (USD 100.00 @ 4.5)", "old annotation should be replaced");
}

// Test 6: CNY with originalAmount — actual rate computed
{
  const cc = { id: "wx_2", amount: 43.88, matched: false, matchedInvoiceId: null };
  const inv = { id: "inv_6", amount: "", ccMatched: false, originalAmount: "200.00", originalCurrency: "CNY", description: "CN vendor" };
  doManualAssign(cc, inv);
  assert(inv.amount === "43.88", "amount should be CC charge");
  assert(inv.ccActualRate === parseFloat((43.88 / 200).toFixed(6)), "rate should be computed");
  assert(inv.description.includes("CNY 200.00 @"), "description should have CNY rate annotation");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
