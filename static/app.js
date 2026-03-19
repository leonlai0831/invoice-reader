// ── State ────────────────────────────────────────────────────────
let rows = [];
let rates = {USD:4.45,CNY:0.62,SGD:3.35,EUR:4.85,GBP:5.75,MYR:1};
let ratesLive = false;
let claimsFolder = "";

// CC Statement state (Reconcile removed)

// Duplicate detection
let pendingRow = null;

// Dashboard chart instances
let chartInstances = {};

// Save debounce
let saveTimer = null;

// Batch select
let selectedRows = new Set();

// Sorting
let sortCol = null;
let sortDir = "asc";

// Archive
let archivedClaims = [];
let activeRecordTab = "current";
let archiveSearch = "";

// Smart Memory
let memoryData = { suppliers: {}, customSuppliers: [], customDescriptions: {} };

// Branch History
let branchHistoryMap = new Map();
let activeBranchPopover = null;

// Search & Branch filter
let recordSearch = "";
let filterBranches = new Set();

// CC Ledger
let ccLedgerCC = [];   // persistent CC ledger transactions
let ccLedgerWX = [];   // persistent WeChat ledger transactions
let activeCCTab = "cc";
let portableMode = false;
let pendingCCAssign = null; // {txnId, source} object for ledger assign
let pendingCrossRef = null; // {txnId, source} for manual WX<->CC linking

// Confirm callback
let confirmCallback = null;

// Last archive path for "open folder" feature
let lastArchivePath = "";

const BRANCHES = ["HQ","BK","BT","PK","PJ","KK","KM","QSM","USJ","DPC","OTG"];
const CATEGORIES = ["Advertisement","Design Service","Equipment","Event","HR","Maintenance","Marketing","Operation","Others","Purchasing","Recruitment","Renovation","Sanitary","Service","Shipping","Staff Welfare","Stationary","Subscription","Telco","Welfare"];
const CUR_INFO = {
  USD:{flag:"\u{1F1FA}\u{1F1F8}",color:"#38bdf8"},CNY:{flag:"\u{1F1E8}\u{1F1F3}",color:"#f97316"},
  SGD:{flag:"\u{1F1F8}\u{1F1EC}",color:"#a78bfa"},EUR:{flag:"\u{1F1EA}\u{1F1FA}",color:"#fb7185"},
  GBP:{flag:"\u{1F1EC}\u{1F1E7}",color:"#facc15"},MYR:{flag:"\u{1F1F2}\u{1F1FE}",color:"#10b981"},
};
const DESC_BY_CAT = {
  "Advertisement":["FB ads","Google ads","Gym FB ads","Gym Google ads","Swimming FB ads","Swimming Google ads","Tiktok ads"],
  "Subscription":["FB Verified service","Google Drive","Gym Youtube Premium","Capcut pro subscription","PDF editor","AI agent","FB AI chatbot","Gym FB AI chatbot","Swimming FB AI chatbot"],
  "Telco":["Center internet service","Gym internet service","Center and director phone bill","Center phone bill","Director phone bill","Hostel wifi service","XHS phone data service"],
  "Marketing":["Artwork design service","Branding colour guide","Gym logo design","Gym web design","Marketing service","Tiktok KOC video shooting","XHS KOC video","KOC recruitment service","Booth event flyer printing"],
  "Purchasing":["Gym equipment","Gym pilates equipment","Gym sauna equipment","Gym ice bath machine","Gym lighting","Gym toilet lighting","Gym light bulb","Gym hair dryer bracket","Gym hand soap bottle","Gym toilet paper","Center furniture","Office equipment","Director laptop","Marketing laptop","Gym PC set","keyboard mouse set","A4 paper","Pool decking liner","Swimming pool heater"],
  "Shipping":["Shipping fee","Gym item shipping fee","Gym pilates equipment shipping fee","Gym sauna equipment shipping fee","Gym ice bath machine shipping fee","Office equipment shipping fee","Center furniture shipping","Heater shipping fee","Event booth item shipping fee"],
  "Maintenance":["Gym equipment maintenance","Gym equipment replacement part","Center pc repair","Cleaning service"],
  "Renovation":["Gym internet installation","Lighting part for renovation","BT shoplot TNB deposit"],
  "HR":["Management course","PT training sponsorship for staff","MRI claim","Payroll system renewal"],
  "Recruitment":["KOC recruitment service","JOb hiring ads","recruitment ad"],
  "Staff Welfare":["Hostel wifi service","Dinner","Marketing team lunch treat","Lunch treat for staff after event"],
  "Welfare":["Dinner","Flower stand for Cedric","Lunch treat for staff after event"],
  "Stationary":["A4 paper","Office stationary","Gym attendance card","Gym printer ink","Center printer ink"],
  "Sanitary":["Gym toilet paper","Gym hand soap bottle","Gym shower soap dispenser","Sanitory refill"],
  "Others":["TTPM online registration charge","Competitor SSM report purchase","Gym business trip flight","Gym business trip hotel"],
};
const ALL_DESC = [...new Set(Object.values(DESC_BY_CAT).flat())].sort();
const SUPPLIERS = ["GOOGLE ASIA PACIFIC PTE LTD","META PLATFORMS IRELAND LIMITED","CELCOM MOBILE SDN BHD","CELCOMDIGI TELECOMMUNICATION SDN BHD","TM TECHNOLOGY SERVICES SDN BHD","MAXIS BROADBAND SDN BHD","DIGI TELECOMMUNICATIONS SDN BHD","ADOBE SYSTEMS SOFTWARE IRELAND LTD","APPLE MALAYSIA SDN BHD","ARTSCAPE ADVERTISING DESIGN STUDIO","AGENSI PEKERJAAN JOBSTREET.COM SDN BHD","BUYMALL SERVICES SDN BHD","200 LABS, INC","BEANSTALK SOLUTIONS SDN BHD","C&L LIGHTING M SDN BHD","BECON ENTERPRISE SDN BHD"];

// ── ID Generation ────────────────────────────────────────────────
function generateId(){
  const ts = Date.now();
  const r = Math.random().toString(36).substring(2,8);
  return `inv_${ts}_${r}`;
}

// ── Toast Notifications ─────────────────────────────────────────
function showToast(msg, type='info', duration=4000){
  const icons = {success:'✅',error:'❌',warning:'⚠️',info:'ℹ️'};
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]||'ℹ️'}</span><span class="toast-msg">${esc(msg)}</span><button class="toast-close" onclick="this.parentElement.remove()">✕</button><div class="toast-progress" style="animation:toastProgress ${duration}ms linear forwards"></div>`;
  container.appendChild(el);
  setTimeout(()=>{ el.classList.add('removing'); setTimeout(()=>el.remove(),250); }, duration);
}

function esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Confirm Dialog ──────────────────────────────────────────────
function showConfirm(msg, onYes, title, icon, btnClass){
  document.getElementById('confirm-msg').innerHTML = msg;
  document.getElementById('confirm-title').textContent = title || '确认操作';
  document.getElementById('confirm-icon').textContent = icon || '⚠️';
  const yesBtn = document.getElementById('confirm-yes-btn');
  yesBtn.className = 'btn btn-sm ' + (btnClass || 'btn-pri');
  confirmCallback = onYes;
  document.getElementById('confirm-modal').classList.add('show');
}
function closeConfirm(yes){
  document.getElementById('confirm-modal').classList.remove('show');
  if(yes && confirmCallback) confirmCallback();
  confirmCallback = null;
}

// ── Init ────────────────────────────────────────────────────────
(async function init(){
  await loadFolderSetting();
  await loadRates();
  await loadMemory();
  await loadData();
  await loadArchive();
  buildBranchHistoryMap();
  initBranchFilterDropdown();
  renderTable();  // re-render with branch hints now available
  // Lazy-load CC session only when tab is first opened (saves startup API call)
  checkApiKey();

  // ── Keyboard shortcuts ──────────────────────────────────────
  document.addEventListener("keydown", (e) => {
    // Escape closes modals (priority order: confirm → notes → CC archive → dup → settings → img)
    if(e.key === "Escape"){
      const cm = document.getElementById("confirm-modal");
      if(cm && cm.classList.contains("show")){ closeConfirm(false); return; }
      const nm = document.getElementById("notes-modal");
      if(nm && nm.classList.contains("show")){ closeNotesModal(false); return; }

      const dm = document.getElementById("dup-modal");
      if(dm && dm.classList.contains("show")){ cancelDup(); return; }
      const sm = document.getElementById("modal");
      if(sm && sm.classList.contains("show")){ closeModal(); return; }
      const im = document.getElementById("img-modal");
      if(im && im.style.display !== "none"){ im.style.display="none"; return; }
    }
    // Enter confirms the active confirmation dialog
    if(e.key === "Enter"){
      const cm = document.getElementById("confirm-modal");
      if(cm && cm.classList.contains("show")){
        const tag = document.activeElement.tagName;
        if(tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT"){
          closeConfirm(true);
        }
      }
    }
  });
})();

async function loadFolderSetting(){
  try{
    const r = await fetch("/api/config/folder");
    const d = await r.json();
    if(d.ok) claimsFolder = d.path || "";
    const inp = document.getElementById("folder-input");
    if(inp) inp.value = claimsFolder || "";
    // Update scan bar path display
    const scanPath = document.getElementById("scan-path");
    if(scanPath) scanPath.textContent = claimsFolder ? claimsFolder + "\\New Claim" : "未设置路径 — 请先在设置中选择文件夹";
    const st = document.getElementById("folder-status");
    if(st) st.textContent = claimsFolder ? "✅ 已设置" : "";
  }catch(e){}
}

async function browseFolderPicker(){
  try{
    const r = await fetch("/api/config/browse-folder",{method:"POST"});
    const d = await r.json();
    if(d.ok){
      claimsFolder = d.path;
      const inp = document.getElementById("folder-input");
      if(inp) inp.value = claimsFolder;
      const st = document.getElementById("folder-status");
      if(st) st.textContent = "✅ 已设置";
      const scanPath = document.getElementById("scan-path");
      if(scanPath) scanPath.textContent = claimsFolder + "\\New Claim";
    }
  }catch(e){ showToast("浏览文件夹失败: "+e.message, "error"); }
}

async function loadRates(){
  try{
    const r = await fetch("/api/rates");
    const d = await r.json();
    if(d.ok){ rates = d.rates; ratesLive = d.live; }
  }catch(e){}
  renderRates();
}

function renderRates(){
  const strip = document.getElementById("rate-strip");
  const detail = document.getElementById("rate-detail-row");
  const loading = document.getElementById("rate-loading");
  if(loading) loading.remove();

  let stripHtml = "";
  let detailHtml = "";
  ["USD","CNY","SGD","EUR","GBP"].forEach(c=>{
    const info = CUR_INFO[c];
    stripHtml += `<span class="rate-item"><span style="color:${info.color};font-weight:700">${c}</span><span style="color:#fff;font-weight:600">= RM ${rates[c]?.toFixed(4)}</span></span>`;
    detailHtml += `<div class="rate-item-lg"><span style="font-size:14px">${info.flag}</span><span style="font-weight:600;color:${info.color}">${c}</span><span style="color:var(--muted)">\u2192</span><span style="font-weight:700;color:#fff">RM ${rates[c]?.toFixed(4)}</span></div>`;
  });
  if(!ratesLive) stripHtml += `<span style="color:#f97316;font-size:10px">\u26A0 估算汇率</span>`;
  strip.innerHTML = stripHtml;
  detail.innerHTML = detailHtml;
}

// ── Smart Memory ─────────────────────────────────────────────────
async function loadMemory(){
  try{
    const r = await fetch("/api/memory");
    const d = await r.json();
    if(d.ok){
      memoryData = {
        suppliers: d.suppliers || {},
        customSuppliers: d.customSuppliers || [],
        customDescriptions: d.customDescriptions || {},
      };
    }
  }catch(e){ console.error("loadMemory error:", e); }
}

function getMergedSuppliers(){
  const s = new Set(SUPPLIERS.map(x=>x.toUpperCase()));
  // Add canonical supplier names from memory
  Object.keys(memoryData.suppliers).forEach(k => s.add(k.toUpperCase()));
  // Add custom suppliers learned from submissions
  (memoryData.customSuppliers||[]).forEach(k => s.add(k.toUpperCase()));
  return [...s].sort();
}

function getMergedDescriptions(category){
  const hardcoded = category && DESC_BY_CAT[category] ? DESC_BY_CAT[category] : ALL_DESC;
  const custom = category && memoryData.customDescriptions[category] ? memoryData.customDescriptions[category] : [];
  const merged = new Set([...hardcoded, ...custom]);
  return [...merged].sort();
}

async function checkApiKey(){
  try{
    const r = await fetch("/api/config");
    if(!r.ok) return;
    const d = await r.json();
    if(!d.has_key) setTimeout(showModal, 600);
  }catch(e){ console.warn("checkApiKey failed:", e); }
}

// ── Data Persistence ────────────────────────────────────────────
async function loadData(){
  try{
    const r = await fetch("/api/data");
    const d = await r.json();
    if(d.needsFolder){
      // No folder set — prompt on first use (don't block)
    }
    if(d.rows && d.rows.length){
      rows = d.rows;
      // Migrate old float IDs to string IDs
      rows.forEach(row => {
        if(typeof row.id === "number" || (typeof row.id === "string" && !row.id.startsWith("inv_"))){
          row.id = generateId();
        }
      });
      // Reconstruct preview URLs from serverFilePath
      rows.forEach(row => {
        if(row.serverFilePath && !row.preview){
          const ext = row.serverFilePath.split(".").pop().toLowerCase();
          if(["jpg","jpeg","png","webp"].includes(ext)){
            row.preview = `/api/file/${row.serverFilePath}`;
          }
        }
      });
      // Migrate: add timestamps to old rows
      rows.forEach(row => {
        if(!row.createdAt){
          // Try to extract timestamp from ID (inv_1709901234567_abc)
          const m = (row.id||"").match(/inv_(\d+)_/);
          row.createdAt = m ? new Date(parseInt(m[1])).toISOString() : new Date().toISOString();
          row.modifiedAt = row.createdAt;
        }
        if(!row.notes) row.notes = "";
      });
      updateCounts();
      renderTable();
    }
  }catch(e){ console.error("loadData error:", e); }
}

function scheduleSave(){
  if(!claimsFolder) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(()=>{
    // Strip non-serializable fields before saving
    const clean = rows.map(r => {
      const copy = {...r};
      // Remove blob URLs (preview) — reconstruct from serverFilePath on load
      if(copy.preview && copy.preview.startsWith("blob:")) delete copy.preview;
      return copy;
    });
    fetch("/api/data",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({rows:clean})
    }).catch(e => console.error("save error:", e));
  }, 500);
}

// ── Tabs ────────────────────────────────────────────────────────
function switchTab(t){
  if(pendingCCAssign && t !== "records") cancelCCAssign();
  document.getElementById("pane-upload").style.display = t==="upload"?"block":"none";
  document.getElementById("pane-records").style.display = t==="records"?"block":"none";
  document.getElementById("pane-cc").style.display = t==="cc"?"block":"none";
  document.getElementById("pane-dash").style.display = t==="dash"?"block":"none";
  document.getElementById("tab-upload").className = "tab" + (t==="upload"?" active":"");
  document.getElementById("tab-records").className = "tab" + (t==="records"?" active":"");
  document.getElementById("tab-cc").className = "tab" + (t==="cc"?" active":"");
  document.getElementById("tab-dash").className = "tab" + (t==="dash"?" active":"");

  if(t==="cc"){
    loadFromLedger().then(()=>{
      runLedgerCrossRef().then(()=>{
        if(activeCCTab==="wx") renderCCLedgerWX();
        else renderCCLedgerCC();
      });
    });
  }
  if(t==="dash") renderDashboard();
}

// ── Modal ───────────────────────────────────────────────────────
// ── Portable Mode ────────────────────────────────────────────────
async function loadPortableStatus(){
  try{
    const r = await fetch("/api/config/portable");
    const d = await r.json();
    portableMode = d.portable;
    const tog = document.getElementById("portable-toggle");
    if(tog) tog.checked = portableMode;
    const lbl = document.getElementById("portable-label");
    if(lbl) lbl.textContent = portableMode ? "已开启 — 配置存储在 exe 目录" : "关闭";
  }catch(e){}
}

async function togglePortableMode(enabled){
  try{
    const r = await fetch("/api/config/portable",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({enabled})
    });
    const d = await r.json();
    if(d.ok){
      portableMode = enabled;
      const lbl = document.getElementById("portable-label");
      if(lbl) lbl.textContent = enabled ? "已开启 — 配置存储在 exe 目录" : "关闭";
      showToast(enabled ? "☁️ 便携模式已开启" : "便携模式已关闭", "ok");
      // Reload folder display since path format may have changed
      loadFolderSetting();
    }
  }catch(e){ showToast("切换便携模式失败: "+e.message,"error"); }
}

function showModal(){
  document.getElementById("folder-input").value = claimsFolder || "";
  document.getElementById("modal").classList.add("show");
  loadBranchAddresses();
  renderMemoryStats();
  loadPortableStatus();
  // Focus first interactive element
  setTimeout(() => {
    const first = document.querySelector("#modal.show input, #modal.show select, #modal.show button");
    if(first) first.focus();
  }, 100);
}
function closeModal(){ document.getElementById("modal").classList.remove("show"); }
async function saveSettings(){
  try{
    const key = document.getElementById("api-key-input").value.trim();
    if(key){
      const r = await fetch("/api/config",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({api_key:key})});
      if(!r.ok) showToast("保存 API Key 失败", "error");
    }
    await saveBranchAddresses();
    closeModal();
  }catch(e){ showToast("保存设置失败: "+e.message, "error"); }
}
function openExternal(url){ window.open(url,"_blank"); }
function closeImgModal(){ document.getElementById("img-modal").classList.remove("show"); }
function showImg(src){ document.getElementById("img-preview").src=src; document.getElementById("img-modal").classList.add("show"); }

// ── Duplicate Detection ─────────────────────────────────────────
// Normalize invoice number: strip all non-alphanumeric, lowercase
function normalizeInvNo(s){
  return (s||"").replace(/[^a-zA-Z0-9]/g,"").toLowerCase();
}

function findDuplicate(newRow){
  const newInvNo = normalizeInvNo(newRow.invoiceNo);
  const newSupplier = (newRow.supplierName||"").trim().toLowerCase();
  const newAmt = String(newRow.amount||"").trim();
  const newDate = (newRow.invoiceDate||"").trim();
  // Filename-based check: extract base filename (without timestamp prefix)
  const newFileName = extractBaseFileName(newRow.fileName || newRow.serverFilePath || newRow.localFilePath || "");
  const newLocalPath = (newRow.localFilePath||"").trim().toLowerCase();

  // Check current rows
  for(const r of rows){
    // 1) Invoice number match (normalized)
    if(newInvNo && normalizeInvNo(r.invoiceNo) === newInvNo){
      return { row: r, reason: "invoiceNo", source: "current" };
    }
    // 2) Same source filename match
    const rFileName = extractBaseFileName(r.fileName || r.serverFilePath || r.localFilePath || "");
    if(newFileName && rFileName && newFileName === rFileName){
      return { row: r, reason: "fileName", source: "current" };
    }
    // 3) Same local file path (for New Claim scans)
    const rLocalPath = (r.localFilePath||"").trim().toLowerCase();
    if(newLocalPath && rLocalPath && newLocalPath === rLocalPath){
      return { row: r, reason: "fileName", source: "current" };
    }
    // 4) Supplier + Amount + Date match
    if(newSupplier && newAmt && newDate
      && (r.supplierName||"").trim().toLowerCase() === newSupplier
      && String(r.amount||"").trim() === newAmt
      && (r.invoiceDate||"").trim() === newDate){
      return { row: r, reason: "supplierAmtDate", source: "current" };
    }
  }

  // Check archived claims
  for(const claim of archivedClaims){
    for(const r of (claim.rows||[])){
      // Invoice number match in archive
      if(newInvNo && normalizeInvNo(r.invoiceNo) === newInvNo){
        return { row: r, reason: "invoiceNo", source: "archived" };
      }
      // Filename match in archive
      const rFileName = extractBaseFileName(r.fileName || r.serverFilePath || r.localFilePath || "");
      if(newFileName && rFileName && newFileName === rFileName){
        return { row: r, reason: "fileName", source: "archived" };
      }
      const rLocalPath = (r.localFilePath||"").trim().toLowerCase();
      if(newLocalPath && rLocalPath && newLocalPath === rLocalPath){
        return { row: r, reason: "fileName", source: "archived" };
      }
    }
  }
  return null;
}

// Extract the original filename, stripping the timestamp prefix added by the server
// e.g. "1709901234567_receipt.pdf" → "receipt.pdf"
// e.g. "New Claim/photos/receipt.pdf" → "receipt.pdf"
function extractBaseFileName(path){
  if(!path) return "";
  // Get just the filename part (after last / or \)
  let name = path.split(/[/\\]/).pop() || "";
  // Strip timestamp prefix: digits followed by underscore
  name = name.replace(/^\d{10,}_/, "");
  return name.trim().toLowerCase();
}

function showDupModal(existing, reason){
  const info = document.getElementById("dup-info");
  const isHardBlock = reason === "invoiceNo" || reason === "fileName";
  const sourceLabel = existing._source === "archived" ? "（已归档记录）" : "";
  const reasonLabel = reason === "fileName" ? "🚫 相同文件已录入" + sourceLabel + "："
    : reason === "invoiceNo" ? "🚫 发票号重复，无法添加" + sourceLabel + "："
    : "系统已有相似发票记录：";
  info.innerHTML = `
    <div style="color:${isHardBlock ? "var(--red)" : "var(--orange)"};font-weight:600;margin-bottom:8px">
      ${reasonLabel}
    </div>
    <div style="background:rgba(${isHardBlock?"248,113,113":"249,115,22"},.06);border:1px solid rgba(${isHardBlock?"248,113,113":"249,115,22"},.2);border-radius:8px;padding:12px;font-size:12px;line-height:2">
      <div>📄 <strong>供应商:</strong> ${esc(existing.supplierName)}</div>
      <div>🔢 <strong>发票号:</strong> ${esc(existing.invoiceNo)}</div>
      <div>📅 <strong>日期:</strong> ${esc(existing.invoiceDate)}</div>
      <div>💰 <strong>金额:</strong> RM ${esc(String(existing.amount))}</div>
    </div>
    ${isHardBlock
      ? '<div style="margin-top:10px;font-size:12px;color:var(--red)">相同发票号不允许重复录入。</div>'
      : '<div style="margin-top:10px;font-size:12px;color:var(--muted)">是否仍然添加此发票？</div>'}
  `;
  document.getElementById("dup-add-anyway-btn").style.display = isHardBlock ? "none" : "inline-flex";
  document.getElementById("dup-modal").classList.add("show");
}

function cancelDup(){
  pendingRow = null;
  document.getElementById("dup-modal").classList.remove("show");
}

function addAnyway(){
  document.getElementById("dup-modal").classList.remove("show");
  if(pendingRow){
    rows.unshift(pendingRow);
    pendingRow = null;
    updateCounts();
    renderTable();
    switchTab("records");
    scheduleSave();
  }
}

// ── Drag & Drop ─────────────────────────────────────────────────
function onDragOver(e){ e.preventDefault(); document.getElementById("dropzone").classList.add("over"); }
function onDragLeave(){ document.getElementById("dropzone").classList.remove("over"); }
function onDrop(e){ e.preventDefault(); document.getElementById("dropzone").classList.remove("over"); handleFileSelect(e.dataTransfer.files); }
function handleFileSelect(files){ Array.from(files).forEach(processFile); }

// ── Process file ────────────────────────────────────────────────
async function processFile(file){
  const valid = ["image/jpeg","image/jpg","image/png","image/webp","application/pdf"];
  if(!valid.includes(file.type)){ showToast("不支持的文件格式", "warning"); return; }

  // Pre-API duplicate check by filename (saves API cost)
  const preCheckName = extractBaseFileName(file.name);
  if(preCheckName){
    const existingByFile = rows.find(r => extractBaseFileName(r.fileName || r.serverFilePath || r.localFilePath || "") === preCheckName);
    if(existingByFile){
      pendingRow = null;
      showDupModal(Object.assign({}, existingByFile, {_source:"current"}), "fileName");
      return;
    }
    for(const claim of archivedClaims){
      for(const r of (claim.rows||[])){
        if(extractBaseFileName(r.fileName || r.serverFilePath || r.localFilePath || "") === preCheckName){
          pendingRow = null;
          showDupModal(Object.assign({}, r, {_source:"archived"}), "fileName");
          return;
        }
      }
    }
  }

  document.getElementById("loading").classList.add("show");
  document.getElementById("loading-text").textContent = "AI 正在分析发票...";
  document.getElementById("loading-name").textContent = file.name;

  try{
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch("/api/process",{method:"POST",body:fd});
    const d = await r.json();

    if(!d.ok){ showToast("提取失败: "+d.error, "error"); return; }
    if(d.cached) showToast("使用缓存数据，未消耗 API", "info");

    const p = d.data;
    const detCur = (p.currency||"MYR").toUpperCase();
    const isForeign = detCur !== "MYR";
    const origAmt = p.amount || "";
    const myrAmt = isForeign ? convertToMYR(origAmt, detCur) : (parseFloat(origAmt)||0);
    const baseDesc = p.suggestedDescription || "";
    const desc = (isForeign && origAmt)
      ? `${baseDesc} (${detCur} ${parseFloat(origAmt).toFixed(2)})`
      : baseDesc;

    const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;

    // Smart Memory: use predictions for branch, category, supplier name
    const memBranch = p.memoryBranchFromAddress || p.memoryBranch || "";
    const memCategory = p.memoryCategory || p.suggestedCategory || "";
    const memSupplier = p.memoryCanonicalSupplier || p.supplierName || "";

    const newRow = {
      id: generateId(),
      branch: memBranch, supplierName: memSupplier, invoiceNo: p.invoiceNo||"",
      invoiceDate: p.invoiceDate||"", category: memCategory,
      description: desc, amount: isNaN(myrAmt) ? origAmt : myrAmt.toFixed(2),
      originalAmount: origAmt, originalCurrency: detCur,
      claimDate: todayStr(), preview, fileName: file.name,
      serverFilePath: d.serverFilePath || "",
      ccMatched: false, ccActualRate: null,
      notes: "",
      createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(),
    };

    // Duplicate check
    const dup = findDuplicate(newRow);
    if(dup){
      if(dup.reason === "invoiceNo" || dup.reason === "fileName"){
        if(preview) URL.revokeObjectURL(preview);  // Prevent blob URL leak
        pendingRow = null;  // Hard block — no override
        const dupRow = Object.assign({}, dup.row, {_source: dup.source});
        showDupModal(dupRow, dup.reason);
      } else {
        pendingRow = newRow;  // Soft warn — allow override
        showDupModal(dup.row, "supplierAmtDate");
      }
    } else {
      rows.unshift(newRow);
      updateCounts();
      renderTable();
      switchTab("records");
      scheduleSave();
    }
  }catch(e){ showToast("错误: "+e.message, "error"); }
  finally{ document.getElementById("loading").classList.remove("show"); }
}

function convertToMYR(amount, currency){
  const n = parseFloat(String(amount).replace(/[^0-9.]/g,""));
  if(isNaN(n) || !currency || currency==="MYR") return n;
  return +(n * (rates[currency]||1)).toFixed(2);
}

function todayStr(){
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
}

// ── Scan New Claim folder ────────────────────────────────────────
async function scanNewClaim(){
  if(!claimsFolder){ showToast("请先在设置中选择 Claims Folder", "warning"); showModal(); return; }

  const scanBtn = document.getElementById("scan-btn");
  const progressDiv = document.getElementById("scan-progress");
  const scanFill = document.getElementById("scan-fill");
  const scanText = document.getElementById("scan-text");

  scanBtn.disabled = true;
  scanBtn.textContent = "⏳ 扫描中...";

  try{
    // Step 1: scan folder
    const sr = await fetch("/api/scan-folder",{method:"POST"});
    const sd = await sr.json();
    if(!sd.ok){ showToast(sd.error, "error"); return; }

    const files = sd.files;
    progressDiv.style.display = "block";
    scanText.textContent = `找到 ${files.length} 个文件，开始 AI 识别...`;
    scanFill.style.width = "0%";

    // Helper: delay ms
    const delay = ms => new Promise(r => setTimeout(r, ms));

    // Helper: process one file with retry on rate limit (429)
    async function processWithRetry(filename, maxRetries = 5) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const pr = await fetch("/api/process-local", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify({filename})
        });
        const pd = await pr.json();
        // If rate limited, wait and retry
        if (!pd.ok && pd.error && pd.error.includes("429")) {
          const waitSec = Math.min(10 + attempt * 5, 30);
          scanText.textContent = `⏳ API 限速，等待 ${waitSec}s 后重试 (${attempt+1}/${maxRetries})...`;
          await delay(waitSec * 1000);
          continue;
        }
        return pd;
      }
      return {ok: false, error: "多次重试后仍被限速，请稍后再试"};
    }

    // Step 2: process each file one by one with rate limit handling
    let processed = 0;
    let errors = 0;
    let added = 0;
    let cachedCount = 0;
    let skippedFiles = [];
    for(const file of files){
      const shortName = file.name.includes("/") ? file.name.split("/").pop() : file.name;
      scanText.textContent = `正在识别 (${processed+1}/${files.length}): ${shortName}`;
      scanFill.style.width = `${((processed)/files.length)*100}%`;

      let wasCached = false;
      try{
        const pd = await processWithRetry(file.name);
        wasCached = pd.cached || false;
        if(wasCached) cachedCount++;

        if(pd.ok){
          const p = pd.data;
          const detCur = (p.currency||"MYR").toUpperCase();
          const isForeign = detCur !== "MYR";
          const origAmt = p.amount || "";
          const myrAmt = isForeign ? convertToMYR(origAmt, detCur) : (parseFloat(origAmt)||0);
          const baseDesc = p.suggestedDescription || "";
          const desc = (isForeign && origAmt)
            ? `${baseDesc} (${detCur} ${parseFloat(origAmt).toFixed(2)})`
            : baseDesc;

          // Preview from server file path
          const localPath = pd.localFilePath || "";
          const isImg = /\.(jpg|jpeg|png|webp)$/i.test(file.name);
          const preview = isImg && localPath ? `/api/file/${localPath}` : null;

          // Smart Memory: use predictions for branch, category, supplier name
          const memBranch = p.memoryBranchFromAddress || p.memoryBranch || "";
          const memCategory = p.memoryCategory || p.suggestedCategory || "";
          const memSupplier = p.memoryCanonicalSupplier || p.supplierName || "";

          const newRow = {
            id: generateId(),
            branch: memBranch, supplierName: memSupplier, invoiceNo: p.invoiceNo||"",
            invoiceDate: p.invoiceDate||"", category: memCategory,
            description: desc, amount: isNaN(myrAmt) ? origAmt : myrAmt.toFixed(2),
            originalAmount: origAmt, originalCurrency: detCur,
            claimDate: todayStr(), preview, fileName: pd.fileName || file.name,
            localFilePath: localPath, serverFilePath: "",
            ccMatched: false, ccActualRate: null,
            notes: "",
            createdAt: new Date().toISOString(), modifiedAt: new Date().toISOString(),
          };

          // Duplicate check — skip silently during batch scan
          const dup = findDuplicate(newRow);
          if(!dup){
            rows.unshift(newRow);
            added++;
            updateCounts();
            scheduleSave();
            if(added === 1){ renderTable(); switchTab("records"); }
          } else {
            skippedFiles.push(file.name.includes("/") ? file.name.split("/").pop() : file.name);
            console.log(`Skipped duplicate: ${file.name} (${dup.reason})`);
          }
        } else {
          console.error(`Failed: ${file.name} — ${pd.error}`);
          errors++;
        }
      }catch(e){
        console.error(`Error: ${file.name}`, e);
        errors++;
      }
      processed++;

      // Small delay between API requests to avoid rate limiting (skip delay for cached results)
      if(processed < files.length && !wasCached) await delay(2000);
    }

    // Done
    scanFill.style.width = "100%";
    updateCounts();
    renderTable();

    const skipped = processed - errors - added;
    let msg = errors > 0
      ? `✅ 完成！成功 ${added}/${files.length}，失败 ${errors}，跳过重复 ${skipped}`
      : `✅ 完成！成功识别 ${added} 个发票` + (skipped > 0 ? `，跳过重复 ${skipped}` : "");
    if(cachedCount > 0) msg += `（${cachedCount} 个缓存命中，节省 API）`;
    scanText.textContent = msg;
    if(skippedFiles.length > 0){
      const names = skippedFiles.slice(0, 5).join(", ");
      const more = skippedFiles.length > 5 ? ` 等 ${skippedFiles.length} 个` : "";
      showToast(`跳过重复文件: ${names}${more}`, "warning", 8000);
    }
    setTimeout(()=>{ progressDiv.style.display="none"; }, 6000);
  }catch(e){
    showToast("扫描错误: "+e.message, "error");
  }finally{
    scanBtn.disabled = false;
    scanBtn.textContent = "📂 读取 New Claim";
  }
}

// ── Add manual row ───────────────────────────────────────────────
function addManualRow(){
  rows.unshift({id:generateId(),branch:"",supplierName:"",invoiceNo:"",invoiceDate:"",category:"",description:"",amount:"",originalAmount:"",originalCurrency:"MYR",claimDate:todayStr(),preview:null,fileName:"",localFilePath:"",serverFilePath:"",ccMatched:false,ccActualRate:null,notes:"",createdAt:new Date().toISOString(),modifiedAt:new Date().toISOString()});
  updateCounts(); renderTable(); switchTab("records");
  scheduleSave();
}

// ── Row update helpers ──────────────────────────────────────────
function updateField(id, key, val){
  const row = rows.find(r=>r.id===id);
  if(row){ row[key] = val; row.modifiedAt = new Date().toISOString(); }
  if(key==="category") rerenderDescList(id);
  scheduleSave();
}

function updateCurrency(id, newCur){
  const row = rows.find(r=>r.id===id);
  if(!row) return;
  row.originalCurrency = newCur;
  const isForeign = newCur !== "MYR";
  const src = row.originalAmount || row.amount;
  const myr = isForeign ? convertToMYR(src, newCur) : parseFloat(String(src).replace(/[^0-9.]/g,"")||0);
  const base = row.description.replace(/\s*\([A-Z]{3}\s+[\d.]+(?:\s*@\s*[\d.]+)?\)$/,"");
  row.description = (isForeign && src) ? `${base} (${newCur} ${parseFloat(String(src).replace(/[^0-9.]/g,"")||0).toFixed(2)})` : base;
  row.amount = isNaN(myr) ? row.amount : myr.toFixed(2);

  const amtInp = document.getElementById("amt-"+id);
  const descInp = document.getElementById("desc-"+id);
  const curSel = document.getElementById("cur-"+id);
  if(amtInp) amtInp.value = row.amount;
  if(descInp) descInp.value = row.description;
  if(curSel){
    curSel.className = "cur-select" + (isForeign?" foreign":"");
    curSel.style.color = isForeign ? (CUR_INFO[newCur]?.color||"") : "";
    curSel.style.borderColor = isForeign ? (CUR_INFO[newCur]?.color+"66"||"") : "";
  }
  scheduleSave();
}

function updateOrigAmt(id, val){
  const row = rows.find(r=>r.id===id);
  if(!row) return;
  row.originalAmount = val;
  const isForeign = row.originalCurrency !== "MYR";
  if(isForeign){
    const myr = convertToMYR(val, row.originalCurrency);
    row.amount = isNaN(myr) ? row.amount : myr.toFixed(2);
    const base = row.description.replace(/\s*\([A-Z]{3}\s+[\d.]+(?:\s*@\s*[\d.]+)?\)$/,"");
    row.description = val ? `${base} (${row.originalCurrency} ${parseFloat(String(val).replace(/[^0-9.]/g,"")||0).toFixed(2)})` : base;
    const amtInp = document.getElementById("amt-"+id);
    const descInp = document.getElementById("desc-"+id);
    if(amtInp) amtInp.value = row.amount;
    if(descInp) descInp.value = row.description;
  }
  scheduleSave();
}

function rerenderDescList(id){
  const row = rows.find(r=>r.id===id);
  if(!row) return;
  const dl = document.getElementById("dl-"+id);
  if(!dl) return;
  const opts = getMergedDescriptions(row.category);
  dl.innerHTML = opts.map(d=>`<option value="${d}">`).join("");
}

function deleteRow(id){
  const row = rows.find(r=>r.id===id);
  if(!row) return;
  const label = row.supplierName || row.invoiceNo || row.fileName || "此记录";
  showConfirm(
    `确定删除 <b>${esc(label)}</b>？此操作不可撤销。`,
    () => {
      rows = rows.filter(r=>r.id!==id);
      selectedRows.delete(id);
      updateCounts(); renderTable();
      scheduleSave();
      showToast("已删除", "success", 2000);
    },
    "删除确认", "🗑", "btn-danger"
  );
}

function updateCounts(){
  const n = rows.length;
  document.getElementById("row-count").textContent = n+" 张";
  document.getElementById("tab-cnt").textContent = n;
  document.getElementById("stat-count").textContent = n;
  document.getElementById("export-btn").disabled = n===0;
}

// ── Sorting helpers ──────────────────────────────────────────────
function toggleSort(col){
  if(sortCol === col){ sortDir = sortDir === "asc" ? "desc" : "asc"; }
  else { sortCol = col; sortDir = "asc"; }
  renderTable();
}

function sortRows(arr){
  if(!sortCol) return arr;
  return [...arr].sort((a,b)=>{
    let va, vb;
    if(sortCol === "amount"){
      va = parseFloat(String(a.amount||0).replace(/[^0-9.]/g,"")) || 0;
      vb = parseFloat(String(b.amount||0).replace(/[^0-9.]/g,"")) || 0;
    } else if(sortCol === "invoiceDate" || sortCol === "claimDate"){
      const parse = s => { const p=(s||"").split("/"); return p.length===3?`${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`:s||""; };
      va = parse(a[sortCol]); vb = parse(b[sortCol]);
    } else {
      va = (a[sortCol]||"").toLowerCase(); vb = (b[sortCol]||"").toLowerCase();
    }
    let cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === "desc" ? -cmp : cmp;
  });
}

function sortIcon(col){
  if(sortCol !== col) return '<span class="sort-icon" style="opacity:.3"> ⇅</span>';
  return sortDir === "asc"
    ? '<span class="sort-icon" style="color:var(--acc)"> ▲</span>'
    : '<span class="sort-icon" style="color:var(--acc)"> ▼</span>';
}

// ── Selection helpers ───────────────────────────────────────────
function toggleSelectAll(){
  const fc = document.getElementById("filter-cat").value;
  const filtered = rows.filter(r=>{ if(filterBranches.size>0 && !filterBranches.has(r.branch)) return false; if(fc && r.category!==fc) return false; return true; });
  const allChecked = document.getElementById("select-all-cb").checked;
  if(allChecked){ filtered.forEach(r=>selectedRows.add(r.id)); }
  else { filtered.forEach(r=>selectedRows.delete(r.id)); }
  renderTable();
}

function toggleSelectRow(id){
  if(selectedRows.has(id)) selectedRows.delete(id);
  else selectedRows.add(id);
  updateSelectionUI();
}

function updateSelectionUI(){
  // Update select-all checkbox
  const fc = document.getElementById("filter-cat").value;
  const filtered = rows.filter(r=>{ if(filterBranches.size>0 && !filterBranches.has(r.branch)) return false; if(fc && r.category!==fc) return false; return true; });
  const allCb = document.getElementById("select-all-cb");
  if(allCb) allCb.checked = filtered.length > 0 && filtered.every(r=>selectedRows.has(r.id));

  // Update selection bar
  const bar = document.getElementById("selection-bar");
  if(selectedRows.size > 0){
    const selTotal = rows.filter(r=>selectedRows.has(r.id)).reduce((s,r)=>{
      const n=parseFloat(String(r.amount||0).replace(/[^0-9.]/g,""));return s+(isNaN(n)?0:n);},0);
    document.getElementById("sel-count-text").textContent = `已选 ${selectedRows.size} 张`;
    document.getElementById("sel-total-text").textContent = `RM ${selTotal.toLocaleString("en-MY",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    bar.style.display = "flex";
  } else {
    bar.style.display = "none";
  }

  // Highlight selected rows
  document.querySelectorAll("#tbody tr").forEach(tr=>{
    const cb = tr.querySelector("input[type=checkbox]");
    if(cb) tr.classList.toggle("row-selected", cb.checked);
  });
}

function deleteSelected(){
  if(!selectedRows.size) return;
  const count = selectedRows.size;
  const idsToDelete = new Set(selectedRows);
  showConfirm(`确定要删除选中的 <strong>${count}</strong> 条记录吗？此操作不可撤回。`, ()=>{
    rows = rows.filter(r => !idsToDelete.has(r.id));
    selectedRows.clear();
    updateCounts(); renderTable(); scheduleSave();
    showToast(`已删除 ${count} 条记录`, "success");
  }, "删除确认", "🗑", "btn-danger");
}

// ── Search & Filter Reset ────────────────────────────────────────
function searchRecords(q){
  recordSearch = q.toLowerCase().trim();
  renderTable();
}

function resetFilters(){
  filterBranches.clear();
  updateBranchFilterUI();
  document.getElementById('filter-cat').value = '';
  const searchEl = document.getElementById('search-records');
  if(searchEl) searchEl.value = '';
  recordSearch = '';
  selectedRows.clear();
  renderTable();
}


// ── Branch Multi-Select Filter ──────────────────────────────────
function initBranchFilterDropdown(){
  const dd = document.getElementById("filter-branch-dropdown");
  if(!dd) return;
  let html = '<label class="fb-item"><input type="checkbox" id="fb-all" onchange="toggleAllBranchFilters(this.checked)"> <b>全选 / 取消</b></label>';
  BRANCHES.forEach(b => {
    html += `<label class="fb-item"><input type="checkbox" value="${b}" onchange="toggleBranchFilterItem('${b}',this.checked)"> ${b}</label>`;
  });
  dd.innerHTML = html;
}

function toggleBranchFilter(){
  const dd = document.getElementById("filter-branch-dropdown");
  if(!dd) return;
  const show = dd.style.display === "none";
  dd.style.display = show ? "block" : "none";
  if(show){
    setTimeout(()=> document.addEventListener("click", closeBranchFilterOutside), 0);
  } else {
    document.removeEventListener("click", closeBranchFilterOutside);
  }
}

function closeBranchFilterOutside(e){
  const wrap = document.getElementById("filter-branch-wrap");
  if(wrap && !wrap.contains(e.target)){
    document.getElementById("filter-branch-dropdown").style.display = "none";
    document.removeEventListener("click", closeBranchFilterOutside);
  }
}

function toggleBranchFilterItem(branch, checked){
  if(checked) filterBranches.add(branch);
  else filterBranches.delete(branch);
  updateBranchFilterUI();
  selectedRows.clear();
  renderTable();
}

function toggleAllBranchFilters(checked){
  if(checked) BRANCHES.forEach(b => filterBranches.add(b));
  else filterBranches.clear();
  // sync individual checkboxes
  document.querySelectorAll("#filter-branch-dropdown input[type=checkbox][value]").forEach(cb => { cb.checked = checked; });
  updateBranchFilterUI();
  selectedRows.clear();
  renderTable();
}

function updateBranchFilterUI(){
  const btn = document.getElementById("filter-branch-btn");
  if(!btn) return;
  const n = filterBranches.size;
  if(n === 0 || n === BRANCHES.length){
    btn.textContent = "所有 Branch ▾";
  } else if(n <= 3){
    btn.textContent = [...filterBranches].join(", ") + " ▾";
  } else {
    btn.textContent = `已选 ${n} 个 ▾`;
  }
  // sync checkboxes
  const allCb = document.getElementById("fb-all");
  if(allCb) allCb.checked = n === BRANCHES.length;
  document.querySelectorAll("#filter-branch-dropdown input[type=checkbox][value]").forEach(cb => {
    cb.checked = filterBranches.has(cb.value);
  });
}

// ── Branch History ─────────────────────────────────────────────

function buildBranchHistoryMap() {
  branchHistoryMap = new Map();
  for (const claim of archivedClaims) {
    const claimDate = claim.date || "";
    for (const row of (claim.rows || [])) {
      const supplier = (row.supplierName || "").trim().toUpperCase();
      const branch = (row.branch || "").trim();
      if (!supplier || !branch) continue;
      if (!branchHistoryMap.has(supplier)) branchHistoryMap.set(supplier, []);
      branchHistoryMap.get(supplier).push({ branch, claimDate, invoiceDate: row.invoiceDate || "" });
    }
  }
  for (const [key, entries] of branchHistoryMap) {
    entries.sort((a, b) => b.claimDate.localeCompare(a.claimDate));
    if (entries.length > 5) branchHistoryMap.set(key, entries.slice(0, 5));
  }
}

function findBranchHistory(supplierName) {
  const key = (supplierName || "").trim().toUpperCase();
  if (!key) return null;
  if (branchHistoryMap.has(key)) return branchHistoryMap.get(key);
  // Fuzzy: check memory variants
  for (const [canonical, info] of Object.entries(memoryData.suppliers || {})) {
    const variants = (info.variants || []).map(v => v.trim().toUpperCase());
    if (canonical.toUpperCase() === key || variants.includes(key)) {
      const ck = canonical.toUpperCase();
      if (branchHistoryMap.has(ck)) return branchHistoryMap.get(ck);
      for (const v of variants) { if (branchHistoryMap.has(v)) return branchHistoryMap.get(v); }
    }
  }
  return null;
}

function getBranchHintHtml(supplierName, rowId) {
  const history = findBranchHistory(supplierName);
  if (!history || !history.length) return "";
  const last = history[0];
  const mm = (last.claimDate.match(/^\d{4}-(\d{2})/) || [])[1];
  const monthStr = mm ? mm + "月" : "";
  const key = (supplierName || "").trim().toUpperCase();
  return '<div class="branch-hint" onclick="showBranchHistory(\x27' + esc(rowId) + '\x27,\x27' + esc(key) + '\x27,event)" title="点击查看分店轮换历史">' +
    '<span class="branch-hint-icon">↻</span>' +
    '<span class="branch-hint-text">上次: ' + esc(last.branch) + (monthStr ? ' (' + monthStr + ')' : '') + '</span></div>';
}

function showBranchHistory(rowId, supplierKey, evt) {
  evt.stopPropagation();
  closeBranchPopover();
  const history = branchHistoryMap.get(supplierKey) || findBranchHistory(supplierKey);
  if (!history || !history.length) return;
  const pop = document.createElement("div");
  pop.className = "branch-hint-popover";
  let html = '<div class="branch-hint-popover-title">' + esc(supplierKey) + ' 分店历史</div>';
  history.forEach(h => {
    const ds = h.claimDate ? h.claimDate.substring(0, 10) : h.invoiceDate;
    html += '<div class="branch-hint-entry">' +
      '<span class="branch-hint-branch">' + esc(h.branch) + '</span>' +
      '<span class="branch-hint-date">' + esc(ds) + '</span>' +
      '<button class="branch-hint-apply" onclick="applyBranchFromHistory(\x27' + esc(rowId) + '\x27,\x27' + esc(h.branch) + '\x27)">使用</button></div>';
  });
  pop.innerHTML = html;
  document.body.appendChild(pop);
  const rect = evt.currentTarget.getBoundingClientRect();
  pop.style.left = rect.left + "px";
  pop.style.top = (rect.bottom + 4) + "px";
  const pr = pop.getBoundingClientRect();
  if (pr.right > window.innerWidth - 10) pop.style.left = (window.innerWidth - pr.width - 10) + "px";
  if (pr.bottom > window.innerHeight - 10) pop.style.top = (rect.top - pr.height - 4) + "px";
  activeBranchPopover = pop;
  setTimeout(() => document.addEventListener("click", closeBranchPopoverOutside), 0);
}

function closeBranchPopover() {
  if (activeBranchPopover) { activeBranchPopover.remove(); activeBranchPopover = null; }
  document.removeEventListener("click", closeBranchPopoverOutside);
}
function closeBranchPopoverOutside(e) {
  if (activeBranchPopover && !activeBranchPopover.contains(e.target)) closeBranchPopover();
}

function applyBranchFromHistory(rowId, branch) {
  updateField(rowId, "branch", branch);
  const tr = document.querySelector('tr[data-id="' + rowId + '"]');
  if (tr) { const sel = tr.querySelector("select"); if (sel) sel.value = branch; }
  closeBranchPopover();
  showToast("已设置 Branch: " + branch, "success", 2000);
}

// ── Render table ────────────────────────────────────────────────
function renderTable(){
  closeBranchPopover();
  const fc = document.getElementById("filter-cat").value;
  let filtered = rows.filter(r=>{
    if(filterBranches.size > 0 && !filterBranches.has(r.branch)) return false;
    if(fc && r.category!==fc) return false;
    return true;
  });
  // Search filter
  if(recordSearch){
    filtered = filtered.filter(r =>
      (r.supplierName||"").toLowerCase().includes(recordSearch) ||
      (r.invoiceNo||"").toLowerCase().includes(recordSearch) ||
      (r.description||"").toLowerCase().includes(recordSearch) ||
      (r.invoiceDate||"").toLowerCase().includes(recordSearch) ||
      (r.branch||"").toLowerCase().includes(recordSearch) ||
      (r.category||"").toLowerCase().includes(recordSearch) ||
      String(r.amount||"").includes(recordSearch)
    );
  }
  const sorted = sortRows(filtered);

  const total = sorted.reduce((s,r)=>{const n=parseFloat(String(r.amount||0).replace(/[^0-9.]/g,""));return s+(isNaN(n)?0:n);},0);
  document.getElementById("stat-total").textContent = "RM "+total.toLocaleString("en-MY",{minimumFractionDigits:2,maximumFractionDigits:2});

  // Foreign currency stats
  const fsDiv = document.getElementById("foreign-stats");
  let fsHtml = "";
  ["USD","CNY","SGD"].forEach(cur=>{
    const sub = sorted.filter(r=>r.originalCurrency===cur);
    if(!sub.length) return;
    const ot = sub.reduce((s,r)=>s+(parseFloat(String(r.originalAmount||0).replace(/[^0-9.]/g,""))||0),0);
    const info = CUR_INFO[cur];
    fsHtml += `<div class="stat-card" style="border-color:${info.color}33"><div class="stat-val" style="color:${info.color};font-size:16px">${cur} ${ot.toFixed(2)}</div><div class="stat-label">${sub.length} 张 ${info.flag}</div></div>`;
  });
  fsDiv.innerHTML = fsHtml;

  if(sorted.length===0){
    document.getElementById("table-wrap").style.display = "none";
    const fe = document.getElementById("filter-empty-state");
    if(rows.length === 0){
      document.getElementById("empty-state").style.display = "block";
      if(fe) fe.style.display = "none";
    } else {
      document.getElementById("empty-state").style.display = "none";
      if(fe) fe.style.display = "block";
    }
    updateSelectionUI();
    return;
  }

  document.getElementById("empty-state").style.display = "none";
  const fe2 = document.getElementById("filter-empty-state");
  if(fe2) fe2.style.display = "none";
  document.getElementById("table-wrap").style.display = "block";

  const tbody = document.getElementById("tbody");
  tbody.innerHTML = sorted.map(row => {
    const isForeign = row.originalCurrency && row.originalCurrency !== "MYR";
    const curInfo = CUR_INFO[row.originalCurrency] || CUR_INFO.MYR;
    const curColor = curInfo.color;
    const descOpts = getMergedDescriptions(row.category);
    const mergedSuppliers = getMergedSuppliers();
    const rid = row.id;
    const isChecked = selectedRows.has(rid);

    // Build file URL for opening source file
    const filePath = row.localFilePath || (row.serverFilePath ? `working/${row.serverFilePath}` : "");
    const fileUrl = filePath ? `/api/file/${filePath}` : "";
    const previewSrc = row.preview || (fileUrl || "");
    const isImage = previewSrc && /\.(jpg|jpeg|png|webp)$/i.test(previewSrc) || (row.preview && row.preview.startsWith("blob:"));
    const isPdf = /\.pdf$/i.test(row.fileName || filePath || "");
    const openUrl = fileUrl || previewSrc;

    const assignClick = pendingCCAssign ? ` onclick="manualAssignCC('${rid}')"` : "";
    const assignClass = pendingCCAssign ? " cc-assign-target" : "";
    return `<tr class="${isChecked?"row-selected":""}${assignClass}" data-id="${rid}"${assignClick}>
      <td style="width:28px;text-align:center;padding:0">
        <input type="checkbox" ${isChecked?"checked":""} onchange="toggleSelectRow('${rid}')" style="cursor:pointer;accent-color:var(--acc)">
      </td>
      <td style="width:34px;text-align:center">
        ${isImage && previewSrc
          ? `<img src="${previewSrc}" onclick="window.open('${openUrl}','_blank')" style="width:26px;height:26px;object-fit:cover;border-radius:4px;cursor:pointer;border:1px solid var(--bdr)">`
          : isPdf && openUrl
            ? `<span onclick="window.open('${openUrl}','_blank')" style="font-size:16px;cursor:pointer" title="打开 PDF">📄</span>`
            : `<span style="opacity:.3;font-size:16px">\u{1F4C4}</span>`}
      </td>
      <td style="width:100px">
        <select onchange="updateField('${rid}','branch',this.value)">
          <option value="">-</option>
          ${BRANCHES.map(b=>`<option ${row.branch===b?"selected":""}>${b}</option>`).join("")}
        </select>
        ${getBranchHintHtml(row.supplierName, rid)}
      </td>
      <td style="min-width:220px">
        <input value="${esc(row.supplierName)}" onchange="updateField('${rid}','supplierName',this.value)" list="sl-${rid}" placeholder="Supplier name">
        <datalist id="sl-${rid}">${mergedSuppliers.map(s=>`<option value="${s}">`).join("")}</datalist>
      </td>
      <td style="min-width:150px">
        <input value="${esc(row.invoiceNo)}" onchange="updateField('${rid}','invoiceNo',this.value)" placeholder="INV-0001">
      </td>
      <td style="width:106px">
        <input value="${esc(row.invoiceDate)}" onchange="updateField('${rid}','invoiceDate',this.value)" onblur="validateDateField('${rid}','invoiceDate',this)" placeholder="DD/MM/YYYY">
      </td>
      <td style="width:140px">
        <select id="cat-${rid}" onchange="updateField('${rid}','category',this.value)">
          <option value="">Select...</option>
          ${CATEGORIES.map(c=>`<option ${row.category===c?"selected":""}>${c}</option>`).join("")}
        </select>
      </td>
      <td style="min-width:260px">
        <input id="desc-${rid}" value="${esc(row.description)}" onchange="updateField('${rid}','description',this.value)" list="dl-${rid}" placeholder="Description">
        <datalist id="dl-${rid}">${descOpts.map(d=>`<option value="${d}">`).join("")}</datalist>
      </td>
      <td style="width:96px">
        <select id="cur-${rid}"
          class="cur-select${isForeign?" foreign":""}"
          style="color:${isForeign?curColor:""};border-color:${isForeign?curColor+"66":""}"
          onchange="updateCurrency('${rid}',this.value)">
          ${Object.entries(CUR_INFO).map(([c,i])=>`<option value="${c}" ${row.originalCurrency===c?"selected":""}>${i.flag} ${c}</option>`).join("")}
        </select>
      </td>
      <td style="width:100px">
        ${isForeign
          ? `<input style="text-align:right;color:${curColor}" value="${esc(row.originalAmount)}" onchange="updateOrigAmt('${rid}',this.value)" placeholder="0.00">`
          : `<span style="font-size:11px;color:var(--muted);padding:5px 8px;display:block">\u2014</span>`}
      </td>
      <td style="width:106px">
        <input id="amt-${rid}" class="amt-input" value="${esc(row.amount)}" onchange="updateField('${rid}','amount',this.value)" onblur="validateAmountField('${rid}',this)" placeholder="0.00"
          style="text-align:right;color:var(--green)${isForeign?";padding-right:18px":""}">
      </td>
      <td style="width:106px">
        <input value="${esc(row.claimDate)}" onchange="updateField('${rid}','claimDate',this.value)" onblur="validateDateField('${rid}','claimDate',this)" placeholder="DD/MM/YYYY">
      </td>
      <td style="width:50px;text-align:center;white-space:nowrap">
        <button class="notes-btn ${row.notes?'has-notes':''}" onclick="event.stopPropagation();toggleNotes('${rid}')" title="${row.notes ? esc(row.notes) : '添加备注'}">📝</button>
        <button class="del-btn" onclick="deleteRow('${rid}')" title="删除">\u2715</button>
      </td>
    </tr>`;
  }).join("");

  // Update sort indicators
  ["branch","supplierName","invoiceNo","invoiceDate","category","amount","claimDate"].forEach(col=>{
    const el = document.getElementById("sort-"+col);
    if(el) el.innerHTML = sortIcon(col);
  });

  // Update selection UI
  updateSelectionUI();

  // Legend
  const hasForeign = sorted.some(r=>r.originalCurrency&&r.originalCurrency!=="MYR");
  document.getElementById("legend").innerHTML = hasForeign
    ? `<span>\u{1F4B1} 当前汇率：</span>${Object.entries(CUR_INFO).filter(([c])=>c!=="MYR").map(([c,i])=>`<span>${i.flag} <span style="color:${i.color};font-weight:600">${c}</span> = RM ${rates[c]?.toFixed(4)}</span>`).join("")}${!ratesLive?` <span style="color:#f97316">\u26A0 使用估算汇率</span>`:""}`
    : "";
}

// ── Export Excel ────────────────────────────────────────────────
async function exportExcel(){
  if(!rows.length) return;
  try{
    const r = await fetch("/api/export",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({rows})
    });
    if(!r.ok){ const d=await r.json(); showToast("导出失败: "+(d.error||r.status), "error"); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Claim_Master_Sheet_${new Date().toISOString().slice(0,10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  }catch(e){ showToast("导出错误: "+e.message, "error"); }
}

// ── Complete Claim ──────────────────────────────────────────────
async function completeClaim(){
  if(!rows.length){ showToast("没有发票可以提交", "warning"); return; }
  if(!claimsFolder){ showToast("请先在设置中选择 Claims Folder", "warning"); showModal(); return; }

  // Partial claim: if rows are selected, archive only selected; otherwise archive all
  const isPartial = selectedRows.size > 0;
  const claimRows = isPartial ? rows.filter(r => selectedRows.has(r.id)) : rows;
  const remainingRows = isPartial ? rows.filter(r => !selectedRows.has(r.id)) : [];

  // Required field validation
  const missing = [];
  claimRows.forEach((r, i) => {
    const errs = [];
    if(!r.branch) errs.push("Branch");
    if(!(r.supplierName||"").trim()) errs.push("Supplier");
    const amt = parseFloat(String(r.amount||0).replace(/[^0-9.]/g,""));
    if(isNaN(amt) || amt <= 0) errs.push("Amount");
    if(errs.length) missing.push({supplier: r.supplierName || `第${i+1}行`, errors: errs});
  });
  if(missing.length > 0){
    const detail = missing.slice(0,5).map(m => `• ${esc(m.supplier)}: 缺少 ${m.errors.join(", ")}`).join("<br>");
    showToast("有 " + missing.length + " 条记录信息不完整，请补全后再提交", "error", 6000);
    // Flash the incomplete rows
    missing.forEach(m => {
      const row = claimRows.find(r => (r.supplierName || `第${claimRows.indexOf(r)+1}行`) === m.supplier);
      if(row){
        const el = document.querySelector(`tr[data-id="${row.id}"]`);
        if(el) el.classList.add("row-flash-error");
        setTimeout(()=>{ if(el) el.classList.remove("row-flash-error"); }, 2500);
      }
    });
    return;
  }

  const claimTotal = claimRows.reduce((s,r)=>{
    const n=parseFloat(String(r.amount||0).replace(/[^0-9.]/g,""));return s+(isNaN(n)?0:n);},0);
  const totalStr = "RM " + claimTotal.toLocaleString("en-MY",{minimumFractionDigits:2,maximumFractionDigits:2});

  const msg = isPartial
    ? `确定要提交选中的 <strong>${claimRows.length}</strong> 张发票吗？<br><br>总金额: <strong>${totalStr}</strong><br>剩余 ${remainingRows.length} 张将保留。`
    : `确定要提交全部 <strong>${claimRows.length}</strong> 张发票吗？<br><br>总金额: <strong>${totalStr}</strong><br>提交后当前记录将被清空。`;

  showConfirm(msg, async ()=>{
    try{
      // Strip blob: URLs before sending
      const cleanRows = claimRows.map(r => {
        const c = Object.assign({}, r);
        if(c.preview && c.preview.startsWith("blob:")) c.preview = "";
        return c;
      });
      const cleanRemaining = remainingRows.map(r => {
        const c = Object.assign({}, r);
        if(c.preview && c.preview.startsWith("blob:")) c.preview = "";
        return c;
      });

      const r = await fetch("/api/complete-claim",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({rows: cleanRows, remainingRows: cleanRemaining})
      });
      const d = await r.json();
      if(!d.ok){ showToast("提交失败: "+d.error, "error"); return; }

      lastArchivePath = d.archivePath || "";

      // Show success modal
      document.getElementById("complete-info").innerHTML = `
        <div>📁 存储路径: <strong style="color:#fff">${esc(d.archivePath)}</strong></div>
        <div>📊 Excel: <strong style="color:#fff">${esc(d.excelFile)}</strong></div>
        <div>📄 文件数: <strong style="color:#fff">${d.fileCount} 个</strong></div>
        <div>💰 总金额: <strong style="color:var(--green)">${totalStr}</strong></div>
        ${remainingRows.length > 0 ? `<div>📋 剩余: <strong style="color:#fff">${remainingRows.length} 张待处理</strong></div>` : ""}
      `;
      document.getElementById("complete-modal").classList.add("show");

      // Update local state
      rows = remainingRows;
      selectedRows.clear();
      updateCounts();
      renderTable();
      scheduleSave();

      // Refresh archive and memory data
      await loadArchive();
      buildBranchHistoryMap();
      await loadMemory();
    }catch(e){ showToast("提交错误: "+e.message, "error"); }
  }, "提交确认", "📋", "btn-pri");
}

function closeCompleteModal(){
  document.getElementById("complete-modal").classList.remove("show");
  if(rows.length === 0) switchTab("upload");
}


// ── Archive ─────────────────────────────────────────────────────
async function loadArchive(){
  try{
    const r = await fetch("/api/archive");
    const d = await r.json();
    if(d.claims) archivedClaims = d.claims;
  }catch(e){ console.error("loadArchive error:", e); }
}

function switchRecordTab(tab){
  activeRecordTab = tab;
  document.getElementById("subtab-current").className = "subtab" + (tab==="current"?" active":"");
  document.getElementById("subtab-archived").className = "subtab" + (tab==="archived"?" active":"");
  document.getElementById("current-records-pane").style.display = tab==="current" ? "block" : "none";
  document.getElementById("archived-records-pane").style.display = tab==="archived" ? "block" : "none";
  if(tab==="archived") renderArchive();
}

function renderArchive(){
  const container = document.getElementById("archive-body");
  const countEl = document.getElementById("archive-count-text");
  if(!archivedClaims.length){
    container.innerHTML = '<div class="empty"><div class="icon">📦</div><h3>暂无归档记录</h3><p style="font-size:12px;color:var(--muted)">提交 Claim 后记录会显示在这里</p></div>';
    countEl.textContent = "";
    return;
  }

  const q = archiveSearch.toLowerCase();
  const filtered = q ? archivedClaims.filter(c =>
    c.rows.some(r =>
      (r.supplierName||"").toLowerCase().includes(q) ||
      (r.invoiceNo||"").toLowerCase().includes(q) ||
      (r.description||"").toLowerCase().includes(q)
    )
  ) : archivedClaims;

  countEl.textContent = `共 ${archivedClaims.length} 次归档`;

  container.innerHTML = filtered.slice().reverse().map(claim => {
    const total = claim.rows.reduce((s,r) => {
      const n = parseFloat(String(r.amount||0).replace(/[^0-9.]/g,""));
      return s + (isNaN(n)?0:n);
    }, 0);

    return `<div class="archive-claim-card">
      <div class="archive-claim-header">
        <div>
          <span style="font-weight:700;color:#fff">📅 ${esc(claim.date)}</span>
          <span style="color:var(--muted);font-size:12px;margin-left:12px">${claim.invoiceCount} 张发票</span>
        </div>
        <div style="font-weight:700;color:var(--green)">RM ${total.toLocaleString("en-MY",{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin:4px 0">📁 ${esc(claim.archivePath||"")} &nbsp;|&nbsp; 📊 ${esc(claim.excelFile||"")}</div>
      <table class="archive-table">
        <thead><tr>
          <th>BRANCH</th><th>SUPPLIER</th><th>INVOICE NO.</th><th>DATE</th><th>CATEGORY</th><th>DESCRIPTION</th><th style="text-align:right">AMOUNT (RM)</th>
        </tr></thead>
        <tbody>${claim.rows.map(r => `<tr>
          <td>${esc(r.branch||"-")}</td>
          <td>${esc(r.supplierName)}</td>
          <td>${esc(r.invoiceNo)}</td>
          <td>${esc(r.invoiceDate)}</td>
          <td>${esc(r.category)}</td>
          <td>${esc(r.description)}</td>
          <td style="text-align:right;color:var(--green)">${esc(String(r.amount))}</td>
        </tr>`).join("")}</tbody>
      </table>
    </div>`;
  }).join("");
}


// ═══════════════════════════════════════════════════════════════
//  CC Reconcile
// ═══════════════════════════════════════════════════════════════

function ccDragOver(e,src){ e.preventDefault(); document.getElementById("cc-upload-zone-"+src).classList.add("over"); }
function ccDragLeave(src){ document.getElementById("cc-upload-zone-"+src).classList.remove("over"); }
function ccDrop(e,src){ e.preventDefault(); document.getElementById("cc-upload-zone-"+src).classList.remove("over"); handleCCFile(e.dataTransfer.files[0], src==="wx"?"wechat":"cc"); }

async function handleCCFile(file, source){
  if(!file) return;
  source = source || "cc";
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isImage = file.name.match(/\.(jpg|jpeg|png|webp)$/i);
  const validTypes = ["text/csv","application/pdf","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","image/jpeg","image/png","image/webp"];
  if(!validTypes.includes(file.type) && !file.name.match(/\.(csv|xlsx|xls|pdf|jpg|jpeg|png|webp)$/i)){
    showToast("请上传 CSV、XLSX、PDF 或图片文件", "warning"); return;
  }

  if(isPdf || isImage){
    document.getElementById("loading").classList.add("show");
    document.getElementById("loading-name").textContent = file.name;
    document.getElementById("loading-text").textContent = isPdf
      ? "正在解析 PDF 账单..." : (source === "wechat" ? "AI 正在解析微信支付账单..." : "AI 正在解析信用卡账单...");
  }

  const fd = new FormData();
  fd.append("file", file);
  fd.append("source", source);
  try{
    const r = await fetch("/api/cc/parse",{method:"POST",body:fd});
    const d = await r.json();
    if(!d.ok){ showToast("解析失败: "+d.error, "error"); return; }
    const newTxns = d.transactions;
    const newSource = d.source || source || "cc";
    const srcLabel = newSource === "wechat" ? "微信支付" : "信用卡";
    const methodLabel = d.method === "local" ? " (本地解析，未用 API)" : "";

    try{
      const mr = await fetch("/api/cc/ledger/merge", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ transactions: newTxns, source: newSource })
      });
      const md = await mr.json();
      if(!md.ok){ showToast("合并失败: "+(md.error||""), "error"); return; }
      showToast(`${srcLabel}: 新增 ${md.added} 条，重复 ${md.duplicates} 条${methodLabel}`, "success");
    }catch(e){ showToast("合并错误: "+e.message, "error"); return; }

    await loadFromLedger();
    await runLedgerCrossRef();
    if(newSource === "wechat") renderCCLedgerWX();
    else renderCCLedgerCC();
  }catch(e){ showToast("错误: "+e.message, "error"); }
  finally{
    if(isPdf || isImage){
      document.getElementById("loading").classList.remove("show");
      document.getElementById("loading-text").textContent = "AI 正在分析发票...";
    }
  }
}



// Bank label helper
function _bankLabel(bank){
  const map = {
    "maybank":"Maybank","mbb":"MBB","cimb":"CIMB","publicbank":"Public Bank",
    "public_bank":"Public Bank","rhb":"RHB","hongleong":"Hong Leong",
    "hong_leong":"Hong Leong","ambank":"AmBank","ocbc":"OCBC","hsbc":"HSBC",
    "uob":"UOB","bsn":"BSN","wechat_pay":"WeChat Pay","generic":"CC","pdf_text":"CC",
  };
  if(!bank) return "CC";
  return map[bank.toLowerCase()] || bank;
}

// Show WeChat transaction detail popup
function showWxDetail(wxId){
  const wx = ccLedgerWX.find(t=>t.id===wxId);
  if(!wx) return;
  const linkedCc = wx.crossRefId ? ccLedgerCC.find(t=>t.id===wx.crossRefId) : null;
  let html = `<div style="padding:18px;max-width:100%;overflow:hidden">
    <h4 style="margin:0 0 14px;color:var(--fg);font-size:15px">💬 微信支付交易明细</h4>
    <div style="display:grid;grid-template-columns:80px 1fr;gap:6px 12px;font-size:13px">
      <span style="color:var(--muted)">交易时间</span><span style="color:var(--fg)">${esc(wx.date||wx.dateISO||"")}</span>
      <span style="color:var(--muted)">描述</span><span style="color:var(--fg);word-break:break-all;overflow-wrap:break-word">${esc(wx.description)}</span>
      <span style="color:var(--muted)">金额</span><span style="color:var(--green);font-weight:700">¥ ${wx.amount.toFixed(2)}</span>
      ${wx.paymentMethod ? `<span style="color:var(--muted)">支付方式</span><span style="color:var(--fg)">${esc(wx.paymentMethod)}</span>` : ""}
    </div>`;
  if(linkedCc || wx.crossRefRate){
    html += `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bdr)">
      <h5 style="margin:0 0 10px;font-size:12px;color:var(--blue)">🔗 对应信用卡扣款</h5>
      <div style="display:grid;grid-template-columns:80px 1fr;gap:6px 12px;font-size:13px">`;
    if(linkedCc){
      html += `<span style="color:var(--muted)">银行</span><span style="color:var(--fg)">${esc(_bankLabel(linkedCc.detectedBank))}</span>
        <span style="color:var(--muted)">日期</span><span style="color:var(--fg)">${esc(linkedCc.date||linkedCc.dateISO||"")}</span>
        <span style="color:var(--muted)">描述</span><span style="color:var(--fg);word-break:break-all;overflow-wrap:break-word">${esc(linkedCc.description)}</span>
        <span style="color:var(--muted)">金额</span><span style="color:var(--green);font-weight:700">RM ${linkedCc.amount.toFixed(2)}</span>`;
    }
    if(wx.crossRefRate){
      html += `<span style="color:var(--muted)">汇率</span><span style="color:var(--blue);font-weight:600">¥ 1 = RM ${wx.crossRefRate.toFixed(4)}</span>`;
    }
    html += '</div></div>';
  }
  html += `<div style="text-align:right;margin-top:14px"><button class="btn btn-ghost btn-sm" onclick="this.closest('.modal').classList.remove('show')">关闭</button></div></div>`;
  let modal = document.getElementById("wx-detail-modal");
  if(!modal){
    modal = document.createElement("div");
    modal.id = "wx-detail-modal";
    modal.className = "modal";
    modal.innerHTML = '<div class="modal-box" style="width:480px;max-width:90vw;overflow:hidden"></div>';
    modal.onclick = e => { if(e.target===modal) modal.classList.remove("show"); };
    document.body.appendChild(modal);
  }
  modal.querySelector(".modal-box").innerHTML = html;
  modal.classList.add("show");
}

// ── Ledger Assign (assign ledger transaction to claim record) ──
function startLedgerAssign(txnId, source){
  const ledger = source === "wx" ? ccLedgerWX : ccLedgerCC;
  const txn = ledger.find(t => t.id === txnId);
  if(!txn) return;
  pendingCCAssign = { txnId, source };
  const cur = source === "wx" ? "\u00a5" : "RM";
  const banner = document.getElementById("cc-assign-banner");
  if(banner){
    banner.querySelector(".cc-assign-desc").textContent =
      `正在为 ${txn.description} (${cur} ${txn.amount.toFixed(2)}) 指定发票… 请在记录中点击要关联的行`;
    banner.style.display = "flex";
  }
  switchTab("records");
  renderTable();
  document.addEventListener("keydown", ccAssignEscHandler);
}

function ccAssignEscHandler(e){
  if(e.key === "Escape") cancelCCAssign();
}

function cancelCCAssign(){
  pendingCCAssign = null;
  const banner = document.getElementById("cc-assign-banner");
  if(banner) banner.style.display = "none";
  document.removeEventListener("keydown", ccAssignEscHandler);
  renderTable();
}

function manualAssignCC(invoiceId){
  if(!pendingCCAssign) return;
  const { txnId, source } = pendingCCAssign;
  const ledger = source === "wx" ? ccLedgerWX : ccLedgerCC;
  const txn = ledger.find(t => t.id === txnId);
  const inv = rows.find(r => r.id === invoiceId);
  if(!txn || !inv) return;

  inv.ccMatched = true;
  inv.ccAssignedTxnId = txnId;
  inv.ccAssignedSource = source === "wx" ? "wechat" : "cc";

  if(source === "wx"){
    // WX: CNY amount, convert if cross-ref rate available
    if(txn.crossRefRate){
      inv.amount = (txn.amount * txn.crossRefRate).toFixed(2);
      inv.ccActualRate = txn.crossRefRate;
    } else {
      // Just record the assignment without changing amount
      inv.ccActualRate = null;
    }
  } else {
    // CC: MYR amount, direct assign
    const origAmt = parseFloat(String(inv.originalAmount || "").replace(/[^0-9.]/g, "")) || 0;
    const isForeign = inv.originalCurrency && inv.originalCurrency !== "MYR" && origAmt > 0;
    if(isForeign){
      const actualRate = txn.amount / origAmt;
      inv.ccActualRate = parseFloat(actualRate.toFixed(6));
      inv.amount = txn.amount.toFixed(2);
      const base = inv.description.replace(/\s*\([A-Z]{3}\s+[\d.]+(?:\s*@\s*[\d.]+)?\)$/, "");
      inv.description = `${base} (${inv.originalCurrency} ${origAmt.toFixed(2)} @ ${inv.ccActualRate})`;
    } else {
      inv.amount = txn.amount.toFixed(2);
    }
  }

  inv.modifiedAt = new Date().toISOString();
  txn.assignedToInvoiceId = invoiceId;

  pendingCCAssign = null;
  const banner = document.getElementById("cc-assign-banner");
  if(banner) banner.style.display = "none";
  document.removeEventListener("keydown", ccAssignEscHandler);

  showToast(`已将交易关联到 ${inv.supplierName || "发票"}`, "success");
  renderTable();
  switchTab("cc");
  if(activeCCTab === "wx") renderCCLedgerWX();
  else renderCCLedgerCC();
  scheduleSave();
  saveLedger();
}


// ═══════════════════════════════════════════════════════════════
//  Dashboard / Analytics
// ═══════════════════════════════════════════════════════════════

const CHART_COLORS = [
  "#4f6ef7","#10b981","#f97316","#38bdf8","#a78bfa",
  "#fb7185","#facc15","#34d399","#818cf8","#f87171",
  "#06b6d4","#8b5cf6","#ec4899","#14b8a6","#f59e0b",
];

function resetDashDates(){
  document.getElementById("dash-from").value = "";
  document.getElementById("dash-to").value = "";
  renderDashboard();
}

function getFilteredDashRows(){
  const from = document.getElementById("dash-from").value;
  const to = document.getElementById("dash-to").value;

  return rows.filter(r => {
    if(!from && !to) return true;
    // Parse DD/MM/YYYY to comparable date
    const parts = (r.invoiceDate||"").split("/");
    if(parts.length !== 3) return !from && !to;
    const d = `${parts[2]}-${parts[1].padStart(2,"0")}-${parts[0].padStart(2,"0")}`;
    if(from && d < from) return false;
    if(to && d > to) return false;
    return true;
  });
}

function renderDashboard(){
  const data = getFilteredDashRows();

  // Stats cards
  const totalAmt = data.reduce((s,r)=>{const n=parseFloat(String(r.amount||0).replace(/[^0-9.]/g,""));return s+(isNaN(n)?0:n);},0);
  const cats = new Set(data.map(r=>r.category).filter(Boolean));
  const avg = data.length ? totalAmt / data.length : 0;

  document.getElementById("dash-stats").innerHTML = data.length === 0
    ? `<div class="dash-empty" style="width:100%"><div class="icon">📊</div><h3>暂无数据</h3><p>上传发票后即可查看统计</p></div>`
    : `
    <div class="dash-stat-card accent"><div class="dash-stat-val">${data.length}</div><div class="dash-stat-label">张发票</div></div>
    <div class="dash-stat-card green"><div class="dash-stat-val">RM ${totalAmt.toLocaleString("en-MY",{minimumFractionDigits:2,maximumFractionDigits:2})}</div><div class="dash-stat-label">总金额</div></div>
    <div class="dash-stat-card blue"><div class="dash-stat-val">RM ${avg.toLocaleString("en-MY",{minimumFractionDigits:2,maximumFractionDigits:2})}</div><div class="dash-stat-label">平均每张</div></div>
    <div class="dash-stat-card purple"><div class="dash-stat-val">${cats.size}</div><div class="dash-stat-label">类别数</div></div>
  `;

  if(data.length === 0){
    // Hide charts
    ["chart-category","chart-branch","chart-monthly","chart-suppliers"].forEach(id=>{
      const c = document.getElementById(id);
      if(c) c.parentElement.parentElement.style.display = "none";
    });
    return;
  }

  // Show chart cards
  ["chart-category","chart-branch","chart-monthly","chart-suppliers"].forEach(id=>{
    const c = document.getElementById(id);
    if(c) c.parentElement.parentElement.style.display = "";
  });

  renderCategoryChart(data);
  renderBranchChart(data);
  renderMonthlyChart(data);
  renderSuppliersChart(data);
}

function destroyChart(id){
  if(chartInstances[id]){ chartInstances[id].destroy(); delete chartInstances[id]; }
}

function parseAmt(r){
  const n = parseFloat(String(r.amount||0).replace(/[^0-9.]/g,""));
  return isNaN(n) ? 0 : n;
}

function renderCategoryChart(data){
  destroyChart("category");
  const agg = {};
  data.forEach(r=>{
    const cat = r.category || "未分类";
    agg[cat] = (agg[cat]||0) + parseAmt(r);
  });
  const sorted = Object.entries(agg).sort((a,b)=>b[1]-a[1]);
  const ctx = document.getElementById("chart-category").getContext("2d");
  chartInstances["category"] = new Chart(ctx, {
    type:"bar",
    data:{
      labels: sorted.map(e=>e[0]),
      datasets:[{data: sorted.map(e=>e[1]),backgroundColor:CHART_COLORS.slice(0,sorted.length),borderRadius:4}]
    },
    options:{
      indexAxis:"y",responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>"RM "+c.raw.toLocaleString("en-MY",{minimumFractionDigits:2})}}},
      scales:{x:{ticks:{callback:v=>"RM "+v.toLocaleString(),color:"#64748b",font:{size:10}},grid:{color:"rgba(255,255,255,.05)"}},y:{ticks:{color:"#e2e8f0",font:{size:11}},grid:{display:false}}}
    }
  });
}

function renderBranchChart(data){
  destroyChart("branch");
  const agg = {};
  data.forEach(r=>{
    const br = r.branch || "未分配";
    agg[br] = (agg[br]||0) + parseAmt(r);
  });
  const sorted = Object.entries(agg).sort((a,b)=>b[1]-a[1]);
  const ctx = document.getElementById("chart-branch").getContext("2d");
  chartInstances["branch"] = new Chart(ctx, {
    type:"bar",
    data:{
      labels: sorted.map(e=>e[0]),
      datasets:[{data: sorted.map(e=>e[1]),backgroundColor:CHART_COLORS.slice(0,sorted.length),borderRadius:4}]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>"RM "+c.raw.toLocaleString("en-MY",{minimumFractionDigits:2})}}},
      scales:{y:{ticks:{callback:v=>"RM "+v.toLocaleString(),color:"#64748b",font:{size:10}},grid:{color:"rgba(255,255,255,.05)"}},x:{ticks:{color:"#e2e8f0",font:{size:11}},grid:{display:false}}}
    }
  });
}

function renderMonthlyChart(data){
  destroyChart("monthly");
  const agg = {};
  data.forEach(r=>{
    const parts = (r.invoiceDate||"").split("/");
    if(parts.length!==3) return;
    const key = `${parts[2]}-${parts[1].padStart(2,"0")}`;
    agg[key] = (agg[key]||0) + parseAmt(r);
  });
  const sorted = Object.entries(agg).sort((a,b)=>a[0].localeCompare(b[0]));
  const ctx = document.getElementById("chart-monthly").getContext("2d");
  chartInstances["monthly"] = new Chart(ctx, {
    type:"line",
    data:{
      labels: sorted.map(e=>e[0]),
      datasets:[{
        data: sorted.map(e=>e[1]),
        borderColor:"#4f6ef7",backgroundColor:"rgba(79,110,247,.15)",
        fill:true,tension:.3,pointRadius:4,pointBackgroundColor:"#4f6ef7"
      }]
    },
    options:{
      responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>"RM "+c.raw.toLocaleString("en-MY",{minimumFractionDigits:2})}}},
      scales:{y:{ticks:{callback:v=>"RM "+v.toLocaleString(),color:"#64748b",font:{size:10}},grid:{color:"rgba(255,255,255,.05)"}},x:{ticks:{color:"#e2e8f0",font:{size:10}},grid:{display:false}}}
    }
  });
}

function renderSuppliersChart(data){
  destroyChart("suppliers");
  const agg = {};
  data.forEach(r=>{
    const s = r.supplierName || "未知";
    agg[s] = (agg[s]||0) + parseAmt(r);
  });
  const sorted = Object.entries(agg).sort((a,b)=>b[1]-a[1]).slice(0,10);
  const ctx = document.getElementById("chart-suppliers").getContext("2d");
  chartInstances["suppliers"] = new Chart(ctx, {
    type:"bar",
    data:{
      labels: sorted.map(e=> e[0].length > 25 ? e[0].substring(0,25)+"…" : e[0]),
      datasets:[{data: sorted.map(e=>e[1]),backgroundColor:CHART_COLORS.slice(0,sorted.length),borderRadius:4}]
    },
    options:{
      indexAxis:"y",responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>"RM "+c.raw.toLocaleString("en-MY",{minimumFractionDigits:2})}}},
      scales:{x:{ticks:{callback:v=>"RM "+v.toLocaleString(),color:"#64748b",font:{size:10}},grid:{color:"rgba(255,255,255,.05)"}},y:{ticks:{color:"#e2e8f0",font:{size:10}},grid:{display:false}}}
    }
  });
}


// ═══════════════════════════════════════════════════════════════
//  Smart Memory — Branch Address Settings
// ═══════════════════════════════════════════════════════════════

let branchAddresses = {};

async function loadBranchAddresses(){
  try{
    const r = await fetch("/api/memory/branches");
    const d = await r.json();
    if(d.ok) branchAddresses = d.branchAddresses || {};
  }catch(e){ console.error("loadBranchAddresses error:", e); }
  renderBranchAddresses();
}

function renderBranchAddresses(){
  const container = document.getElementById("branch-addr-list");
  if(!container) return;

  const entries = Object.entries(branchAddresses);
  if(entries.length === 0){
    container.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:8px 0">尚未设置。点击下方按钮添加分店地址。</div>';
    return;
  }

  container.innerHTML = entries.map(([code, addr]) => `
    <div class="branch-addr-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <select class="branch-addr-code" style="width:80px;flex-shrink:0" onchange="updateBranchAddr(this,'${esc(code)}')">
        ${BRANCHES.map(b=>`<option ${b===code?"selected":""}>${b}</option>`).join("")}
      </select>
      <input class="branch-addr-val" value="${esc(addr)}" placeholder="分店物理地址..." style="flex:1" onchange="updateBranchAddrVal('${esc(code)}',this.value)">
      <button class="btn btn-danger btn-sm" onclick="removeBranchAddr('${esc(code)}')" style="padding:4px 8px;font-size:11px">\u2715</button>
    </div>
  `).join("");
}

function addBranchAddressRow(){
  // Find first branch not yet configured
  const used = new Set(Object.keys(branchAddresses));
  const available = BRANCHES.find(b => !used.has(b)) || BRANCHES[0];
  branchAddresses[available] = "";
  renderBranchAddresses();
}

function updateBranchAddr(selectEl, oldCode){
  const newCode = selectEl.value;
  if(newCode === oldCode) return;
  const addr = branchAddresses[oldCode] || "";
  delete branchAddresses[oldCode];
  branchAddresses[newCode] = addr;
  renderBranchAddresses();
}

function updateBranchAddrVal(code, val){
  branchAddresses[code] = val;
}

function removeBranchAddr(code){
  delete branchAddresses[code];
  renderBranchAddresses();
}

async function saveBranchAddresses(){
  try{
    await fetch("/api/memory/branches",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({branchAddresses})
    });
  }catch(e){ console.error("saveBranchAddresses error:", e); }
}

async function rebuildMemory(){
  const btn = document.getElementById("rebuild-memory-btn");
  const status = document.getElementById("memory-status");
  if(btn) btn.disabled = true;
  if(status) status.textContent = "正在重建...";

  try{
    const r = await fetch("/api/memory/rebuild",{method:"POST"});
    const d = await r.json();
    if(d.ok){
      if(status) status.textContent = `✅ 重建完成！处理了 ${d.rowsProcessed} 条记录。`;
      await loadMemory();
    } else {
      if(status) status.textContent = "❌ " + (d.error || "重建失败");
    }
  }catch(e){
    if(status) status.textContent = "❌ 错误: " + e.message;
  }
  if(btn) btn.disabled = false;
}


// ═══════════════════════════════════════════════════════════════
//  Bulk Edit Functions
// ═══════════════════════════════════════════════════════════════

function applyBulkBranch(){
  const val = document.getElementById("bulk-branch").value;
  if(!val || !selectedRows.size) return;
  const count = selectedRows.size;
  rows.filter(r => selectedRows.has(r.id)).forEach(r => {
    r.branch = val;
    r.modifiedAt = new Date().toISOString();
  });
  document.getElementById("bulk-branch").value = "";
  renderTable(); scheduleSave();
  showToast(`已将 ${count} 条记录的 Branch 设为 ${val}`, "success");
}

function applyBulkCategory(){
  const val = document.getElementById("bulk-category").value;
  if(!val || !selectedRows.size) return;
  const count = selectedRows.size;
  rows.filter(r => selectedRows.has(r.id)).forEach(r => {
    r.category = val;
    r.modifiedAt = new Date().toISOString();
  });
  document.getElementById("bulk-category").value = "";
  renderTable(); scheduleSave();
  showToast(`已将 ${count} 条记录的 Category 设为 ${val}`, "success");
}


function applyBulkClaimDate(){
  if(!selectedRows.size) return;
  const today = new Date();
  const dd = String(today.getDate()).padStart(2,"0");
  const mm = String(today.getMonth()+1).padStart(2,"0");
  const yyyy = today.getFullYear();
  const dateStr = `${dd}/${mm}/${yyyy}`;
  const count = selectedRows.size;
  rows.filter(r => selectedRows.has(r.id)).forEach(r => {
    r.claimDate = dateStr;
    r.modifiedAt = new Date().toISOString();
  });
  renderTable(); scheduleSave();
  showToast(`已将 ${count} 条记录的 Claim Date 设为 ${dateStr}`, "success");
}

function setAllClaimDateToday(){
  if(!rows.length) return;
  const today = new Date();
  const dd = String(today.getDate()).padStart(2,"0");
  const mm = String(today.getMonth()+1).padStart(2,"0");
  const yyyy = today.getFullYear();
  const dateStr = `${dd}/${mm}/${yyyy}`;
  const empty = rows.filter(r => !r.claimDate);
  const target = empty.length > 0 ? empty : rows;
  target.forEach(r => {
    r.claimDate = dateStr;
    r.modifiedAt = new Date().toISOString();
  });
  renderTable(); scheduleSave();
  showToast(`已将 ${target.length} 条记录的 Claim Date 设为 ${dateStr}`, "success");
}

// ═══════════════════════════════════════════════════════════════
//  Notes
// ═══════════════════════════════════════════════════════════════

let notesTargetId = null;
function toggleNotes(id){
  const row = rows.find(r=>r.id===id);
  if(!row) return;
  notesTargetId = id;
  const inp = document.getElementById("notes-input");
  inp.value = row.notes || "";
  document.getElementById("notes-modal").classList.add("show");
  setTimeout(()=>inp.focus(), 50);
}
function closeNotesModal(save){
  document.getElementById("notes-modal").classList.remove("show");
  if(save && notesTargetId){
    const row = rows.find(r=>r.id===notesTargetId);
    if(row){
      row.notes = document.getElementById("notes-input").value;
      row.modifiedAt = new Date().toISOString();
      renderTable(); scheduleSave();
      if(row.notes) showToast("备注已保存", "success", 2000);
    }
  }
  notesTargetId = null;
}


// ═══════════════════════════════════════════════════════════════
//  Validation
// ═══════════════════════════════════════════════════════════════

function validateAmount(val){
  const cleaned = String(val||"").replace(/,/g,"").trim();
  const n = parseFloat(cleaned);
  if(cleaned === "" || cleaned === "-") return {valid:true, cleaned:""};
  if(isNaN(n) || n < 0) return {valid:false, cleaned};
  return {valid:true, cleaned:n.toFixed(2)};
}

function validateDate(val){
  const s = (val||"").trim();
  if(!s) return {valid:true, normalized:""};
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m) return {valid:false, normalized:s};
  const d = parseInt(m[1]), mo = parseInt(m[2]), y = parseInt(m[3]);
  if(mo<1||mo>12||d<1||d>31||y<2000||y>2099) return {valid:false, normalized:s};
  const dt = new Date(y, mo-1, d);
  if(dt.getDate()!==d||dt.getMonth()!==mo-1) return {valid:false, normalized:s};
  return {valid:true, normalized:`${String(d).padStart(2,"0")}/${String(mo).padStart(2,"0")}/${y}`};
}

function validateAmountField(id, el){
  const v = validateAmount(el.value);
  if(!v.valid){
    el.classList.add("input-error");
    showToast("金额格式无效，请输入正数", "warning", 3000);
    return;
  }
  el.classList.remove("input-error");
  const row = rows.find(r=>r.id===id);
  if(row){
    row.amount = v.cleaned;
    row.modifiedAt = new Date().toISOString();
    scheduleSave();
  }
}

function validateDateField(id, field, el){
  const v = validateDate(el.value);
  if(!v.valid){
    el.classList.add("input-error");
    showToast("日期格式无效，请使用 DD/MM/YYYY", "warning", 3000);
    return;
  }
  el.classList.remove("input-error");
  const row = rows.find(r=>r.id===id);
  if(row){
    row[field] = v.normalized;
    row.modifiedAt = new Date().toISOString();
    el.value = v.normalized;
    scheduleSave();
  }
}


// ═══════════════════════════════════════════════════════════════
//  Open Archive Folder
// ═══════════════════════════════════════════════════════════════

async function openArchiveFolder(){
  if(!lastArchivePath) return;
  try{
    await fetch("/api/open-folder", {
      method: "POST",
      headers:{"Content-Type":"application/json"},
      body: JSON.stringify({path: lastArchivePath})
    });
  }catch(e){}
}


// ═══════════════════════════════════════════════════════════
//  CC Ledger (unified record)
// ═══════════════════════════════════════════════════════════

function switchCCTab(tab){
  activeCCTab = tab;
  document.getElementById("cc-subtab-cc").className = "subtab" + (tab==="cc"?" active":"");
  document.getElementById("cc-subtab-wx").className = "subtab" + (tab==="wx"?" active":"");
  document.getElementById("cc-pane-cc").style.display = tab==="cc" ? "block" : "none";
  document.getElementById("cc-pane-wx").style.display = tab==="wx" ? "block" : "none";
  if(tab === "cc") renderCCLedgerCC();
  if(tab === "wx") renderCCLedgerWX();
}


function startManualCrossRef(txnId, source){
  const list = source === "cc" ? ccLedgerCC : ccLedgerWX;
  const txn = list.find(t => t.id === txnId);
  if(!txn) return;
  pendingCrossRef = {txnId, source, description: txn.description, amount: txn.amount};
  const targetTab = source === "cc" ? "wx" : "cc";
  const banner = document.getElementById("crossref-banner");
  if(banner){
    const label = source === "cc" ? "💳 信用卡" : "💬 微信";
    const cur = source === "cc" ? "RM" : "¥";
    banner.innerHTML = `<span>🔗 已选择 ${label}: <b>${esc(txn.description)}</b> (${cur} ${txn.amount.toFixed(2)}) — 请在下方选择要关联的交易</span>
      <button class="btn btn-ghost btn-sm" onclick="cancelManualCrossRef()" style="margin-left:8px;font-size:11px">✕ 取消</button>`;
    banner.style.display = "flex";
  }
  switchCCTab(targetTab);
}

function confirmManualCrossRef(targetTxnId){
  if(!pendingCrossRef) return;
  const {txnId, source} = pendingCrossRef;
  const srcList = source === "cc" ? ccLedgerCC : ccLedgerWX;
  const tgtList = source === "cc" ? ccLedgerWX : ccLedgerCC;
  const srcTxn = srcList.find(t => t.id === txnId);
  const tgtTxn = tgtList.find(t => t.id === targetTxnId);
  if(!srcTxn || !tgtTxn) return;
  srcTxn.crossRefId = targetTxnId;
  tgtTxn.crossRefId = txnId;
  srcTxn.manualCrossRef = true;
  tgtTxn.manualCrossRef = true;
  const ccTxn = source === "cc" ? srcTxn : tgtTxn;
  const wxTxn = source === "cc" ? tgtTxn : srcTxn;
  if(wxTxn.amount > 0){
    const rate = ccTxn.amount / wxTxn.amount;
    srcTxn.crossRefRate = rate;
    tgtTxn.crossRefRate = rate;
  }
  saveLedger();
  cancelManualCrossRef();
  showToast("✅ 手动关联成功");
  renderCCLedgerCC();
  renderCCLedgerWX();
}

function cancelManualCrossRef(){
  pendingCrossRef = null;
  const banner = document.getElementById("crossref-banner");
  if(banner) banner.style.display = "none";
  renderCCLedgerCC();
  renderCCLedgerWX();
}

function unlinkCrossRef(txnId, source){
  const srcList = source === "cc" ? ccLedgerCC : ccLedgerWX;
  const tgtList = source === "cc" ? ccLedgerWX : ccLedgerCC;
  const srcTxn = srcList.find(t => t.id === txnId);
  if(!srcTxn || !srcTxn.crossRefId) return;
  const tgtTxn = tgtList.find(t => t.id === srcTxn.crossRefId);
  if(tgtTxn){
    delete tgtTxn.crossRefId;
    delete tgtTxn.crossRefRate;
    delete tgtTxn.manualCrossRef;
  }
  delete srcTxn.crossRefId;
  delete srcTxn.crossRefRate;
  delete srcTxn.manualCrossRef;
  saveLedger();
  showToast("已取消关联");
  renderCCLedgerCC();
  renderCCLedgerWX();
}

function _backfillDateISO(txns){
  let changed = 0;
  for(const t of txns){
    if(!t.dateISO && t.date){
      // Try DD/MM/YYYY
      let m = t.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if(m){
        t.dateISO = `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
        changed++; continue;
      }
      // Try DD/MM/YY (2-digit year)
      m = t.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s|$)/);
      if(m){
        const yr = parseInt(m[3]) > 50 ? "19"+m[3] : "20"+m[3];
        t.dateISO = `${yr}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
        changed++; continue;
      }
      // Try YYYY-MM-DD (possibly with time)
      m = t.date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if(m){
        t.dateISO = `${m[1]}-${m[2]}-${m[3]}`;
        changed++; continue;
      }
      // Try DD-MM-YYYY
      m = t.date.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
      if(m){
        t.dateISO = `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
        changed++; continue;
      }
    }
  }
  return changed;
}

async function loadFromLedger(){
  try{
    const r = await fetch("/api/cc/ledger");
    const d = await r.json();
    if(!d.ok) return;
    ccLedgerCC = d.cc || [];
    ccLedgerWX = d.wx || [];
    // Backfill missing dateISO from date field
    const c1 = _backfillDateISO(ccLedgerCC);
    const c2 = _backfillDateISO(ccLedgerWX);
    if(c1 || c2) await saveLedger();
  }catch(e){ console.error("loadFromLedger:", e); }
}

async function saveLedger(){
  try{
    await fetch("/api/cc/ledger/save", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ cc: ccLedgerCC, wx: ccLedgerWX })
    });
  }catch(e){ console.error("saveLedger:", e); }
}

function _groupByMonth(txns){
  const groups = {};
  for(const t of txns){
    let key = (t.dateISO||"").slice(0,7);
    if(!key && t.date){
      // Fallback: parse DD/MM/YYYY or DD/MM/YY from date field
      let m = t.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if(m){ key = m[3] + "-" + m[2].padStart(2,"0"); }
      else{
        m = t.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})(?:\s|$)/);
        if(m) key = (parseInt(m[3])>50?"19":"20") + m[3] + "-" + m[2].padStart(2,"0");
      }
      if(!key){
        m = t.date.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if(m) key = m[1] + "-" + m[2];
      }
    }
    if(!key) key = "unknown";
    if(!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  // Sort each group by date desc, return entries sorted by month desc
  return Object.entries(groups)
    .sort((a,b) => b[0].localeCompare(a[0]))
    .map(([k, arr]) => [k, arr.sort((a,b)=>(b.dateISO||"").localeCompare(a.dateISO||""))]);
}

function _formatMonth(key){
  if(!key || key==="unknown") return "未知月份";
  const [y, m] = key.split("-");
  return `${y}年${parseInt(m)}月`;
}

function showCcDetail(ccId){
  const cc = ccLedgerCC.find(t=>t.id===ccId);
  if(!cc) return;
  const bk = _bankLabel(cc.detectedBank);
  // Find linked WX transaction
  const linkedWx = cc.crossRefId ? ccLedgerWX.find(t=>t.id===cc.crossRefId) : null;
  const wxAmt = linkedWx ? linkedWx.amount : (cc.crossRefRate ? (cc.amount / cc.crossRefRate) : null);
  let html = `<div style="padding:18px">
    <h4 style="margin:0 0 14px;color:var(--fg);font-size:15px">💳 信用卡交易明细</h4>
    <div style="display:grid;grid-template-columns:90px 1fr;gap:6px 12px;font-size:13px">
      <span style="color:var(--muted)">交易日期</span><span style="color:var(--fg)">${esc(cc.date||cc.dateISO||"")}</span>
      <span style="color:var(--muted)">银行</span><span style="color:var(--fg)">${esc(bk)}</span>
      <span style="color:var(--muted)">描述</span><span style="color:var(--fg);word-break:break-all">${esc(cc.description)}</span>
      <span style="color:var(--muted)">金额</span><span style="color:var(--green);font-weight:700">RM ${cc.amount.toFixed(2)}</span>
    </div>`;
  // Cross-reference section
  if(linkedWx || cc.crossRefRate){
    html += `<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--bdr)">
      <h5 style="margin:0 0 10px;font-size:12px;color:#07c160">🔗 关联微信支付交易</h5>
      <div style="display:grid;grid-template-columns:90px 1fr;gap:6px 12px;font-size:13px">`;
    if(linkedWx){
      html += `<span style="color:var(--muted)">交易时间</span><span style="color:var(--fg)">${esc(linkedWx.date||linkedWx.dateISO||"")}</span>
        <span style="color:var(--muted)">描述</span><span style="color:var(--fg);word-break:break-all">${esc(linkedWx.description)}</span>
        <span style="color:var(--muted)">金额</span><span style="color:var(--green);font-weight:700">¥ ${linkedWx.amount.toFixed(2)}</span>
        ${linkedWx.paymentMethod ? `<span style="color:var(--muted)">支付方式</span><span style="color:var(--fg)">${esc(linkedWx.paymentMethod)}</span>` : ""}`;
    } else if(wxAmt){
      html += `<span style="color:var(--muted)">微信金额</span><span style="color:var(--green);font-weight:700">¥ ${wxAmt.toFixed(2)}</span>`;
    }
    if(cc.crossRefRate){
      html += `<span style="color:var(--muted)">汇率</span><span style="color:var(--blue);font-weight:600">¥ 1 = RM ${cc.crossRefRate.toFixed(4)}</span>`;
    }
    html += '</div></div>';
  }
  html += `<div style="text-align:right;margin-top:14px"><button class="btn btn-ghost btn-sm" onclick="this.closest('.modal').classList.remove('show')">关闭</button></div></div>`;
  let modal = document.getElementById("cc-detail-modal");
  if(!modal){
    modal = document.createElement("div");
    modal.id = "cc-detail-modal";
    modal.className = "modal";
    modal.innerHTML = '<div class="modal-box" style="width:480px"></div>';
    modal.onclick = e => { if(e.target===modal) modal.classList.remove("show"); };
    document.body.appendChild(modal);
  }
  modal.querySelector(".modal-box").innerHTML = html;
  modal.classList.add("show");
}

async function runLedgerCrossRef(){
  if(!ccLedgerCC.length || !ccLedgerWX.length) return;
  try{
    const r = await fetch("/api/cc/cross-reference",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({wechatTransactions: ccLedgerWX, ccTransactions: ccLedgerCC})
    });
    const d = await r.json();
    if(!d.ok) return;
    // Clear old auto cross-refs (preserve manual ones)
    for(const t of ccLedgerCC){ if(!t.manualCrossRef){ delete t.crossRefId; delete t.crossRefRate; } }
    for(const t of ccLedgerWX){ if(!t.manualCrossRef){ delete t.crossRefId; delete t.crossRefRate; } }
    // Apply new cross-refs (skip if already manually linked)
    for(const pair of (d.pairs||[])){
      const wx = ccLedgerWX.find(t=>t.id===pair.wxId);
      const cc = ccLedgerCC.find(t=>t.id===pair.ccId);
      if(wx && !wx.manualCrossRef){ wx.crossRefId = pair.ccId; wx.crossRefRate = pair.impliedRate; }
      if(cc && !cc.manualCrossRef){ cc.crossRefId = pair.wxId; cc.crossRefRate = pair.impliedRate; }
    }
  }catch(e){ console.error("runLedgerCrossRef:", e); }
}



let autoLinkProposals = []; // [{wxTxn, ccTxn, rate, accepted:true}, ...]

async function _fetchHistoricalRates(dates){
  // Fetch historical CNY->MYR rates for a set of dates from the server
  if(!dates.length) return {};
  const sorted = [...dates].sort();
  const start = sorted[0], end = sorted[sorted.length - 1];
  try{
    const r = await fetch(`/api/rates/history?start=${start}&end=${end}&base=CNY&target=MYR`);
    const d = await r.json();
    if(!d.ok || !d.rates) return {};
    return d.rates; // {"YYYY-MM-DD": rate, ...}
  }catch(e){ return {}; }
}

function _lookupDailyRate(historicalRates, dateISO){
  // Look up the rate for a specific date; if missing (weekend/holiday),
  // use the closest previous date's rate
  if(historicalRates[dateISO]) return historicalRates[dateISO];
  const allDates = Object.keys(historicalRates).sort();
  let best = null;
  for(const d of allDates){
    if(d <= dateISO) best = d;
    else break;
  }
  return best ? historicalRates[best] : null;
}

async function autoLinkWxCc(){
  const MAX_DAY_DIFF = 2; // CC date must be within 0-2 days of WX date
  const RATE_TOLERANCE_UP = 0.02;
  const RATE_TOLERANCE_DOWN = 0.01;
  const unlinkedWx = ccLedgerWX.filter(t => !t.crossRefId);
  const unlinkedCc = ccLedgerCC.filter(t => !t.crossRefId && _isWechatRelated(t.description));
  if(!unlinkedWx.length || !unlinkedCc.length){
    showToast("没有可匹配的未关联交易");
    return;
  }
  // Collect unique dates and fetch historical rates
  const allDates = new Set();
  for(const t of [...unlinkedWx, ...unlinkedCc]){
    if(t.dateISO) allDates.add(t.dateISO.slice(0,10));
  }
  showToast("正在获取历史汇率...", "info");
  const historicalRates = await _fetchHistoricalRates([...allDates]);
  const hasRates = Object.keys(historicalRates).length > 0;
  if(!hasRates){
    showToast("无法获取历史汇率，请检查网络连接", "error");
    return;
  }
  const usedCcIds = new Set();
  const proposals = [];
  let globalRateMin = Infinity, globalRateMax = -Infinity;
  const sortedWx = [...unlinkedWx].sort((a,b) => b.amount - a.amount);
  for(const wx of sortedWx){
    if(wx.amount <= 0) continue;
    const wxDate = wx.dateISO || "";
    if(!wxDate) continue;
    // Look up the historical rate for this transaction date
    const refRate = _lookupDailyRate(historicalRates, wxDate.slice(0,10));
    if(!refRate) continue;
    const rMin = refRate - RATE_TOLERANCE_DOWN, rMax = refRate + RATE_TOLERANCE_UP;
    let bestCc = null, bestScore = Infinity;
    for(const cc of unlinkedCc){
      if(usedCcIds.has(cc.id)) continue;
      if(cc.amount <= 0) continue;
      const ccDate = cc.dateISO || "";
      if(!ccDate) continue;
      // Date check: must be within 0-2 days
      const daysDiff = Math.abs((new Date(ccDate) - new Date(wxDate)) / 86400000);
      if(daysDiff > MAX_DAY_DIFF) continue;
      // Rate check: must be within daily rate -0.01 to +0.02
      const rate = cc.amount / wx.amount;
      if(rate < rMin || rate > rMax) continue;
      // Score: prefer closest rate to ref + closest date
      const score = Math.abs(rate - refRate) + daysDiff * 0.01;
      if(score < bestScore){
        bestScore = score;
        bestCc = cc;
      }
    }
    if(bestCc){
      const rate = bestCc.amount / wx.amount;
      proposals.push({ wx, cc: bestCc, rate, accepted: true, refRate });
      usedCcIds.add(bestCc.id);
      if(rate < globalRateMin) globalRateMin = rate;
      if(rate > globalRateMax) globalRateMax = rate;
    }
  }
  if(!proposals.length){
    const sampleDate = sortedWx[0]?.dateISO?.slice(0,10) || "";
    const sampleRate = _lookupDailyRate(historicalRates, sampleDate);
    const rateStr = sampleRate ? `${(sampleRate-RATE_TOLERANCE_DOWN).toFixed(4)}-${(sampleRate+RATE_TOLERANCE_UP).toFixed(4)}` : "N/A";
    showToast(`未找到符合条件的匹配（日期±2天，汇率${rateStr}）`);
    return;
  }
  autoLinkProposals = proposals;
  autoLinkProposals._rateMin = globalRateMin;
  autoLinkProposals._rateMax = globalRateMax;
  autoLinkProposals._rateTolerance = RATE_TOLERANCE_UP;
  showAutoLinkReview();
}

function showAutoLinkReview(){
  const proposals = autoLinkProposals;
  const RATE_MIN = proposals._rateMin || 0.60, RATE_MAX = proposals._rateMax || 0.64;
  let rows = "";
  for(let i = 0; i < proposals.length; i++){
    const p = proposals[i];
    const rr = p.refRate || ((RATE_MIN+RATE_MAX)/2); const rTol = proposals._rateTolerance || 0.02; const rateColor = p.rate >= (rr-rTol) && p.rate <= (rr+rTol) ? "var(--blue)" : "var(--orange)";
    rows += `<tr class="autolink-row ${p.accepted ? '' : 'autolink-rejected'}" id="autolink-row-${i}">
      <td style="width:30px;text-align:center">
        <input type="checkbox" ${p.accepted ? 'checked' : ''} onchange="toggleAutoLinkRow(${i}, this.checked)"
          style="accent-color:var(--blue);width:16px;height:16px;cursor:pointer">
      </td>
      <td>
        <div style="font-size:12px;color:var(--fg)">${esc(p.wx.description)}</div>
        <div style="font-size:10px;color:var(--muted)">${esc(p.wx.date)} · ${esc(p.wx.paymentMethod||"")}</div>
      </td>
      <td style="text-align:right;white-space:nowrap;font-weight:600;color:var(--green)">` + "\u00a5" + ` ${p.wx.amount.toFixed(2)}</td>
      <td style="text-align:center;font-size:16px">` + "\u2194" + `</td>
      <td>
        <div style="font-size:12px;color:var(--fg)">${esc(p.cc.description)}</div>
        <div style="font-size:10px;color:var(--muted)">${esc(p.cc.date)} · ${esc(_bankLabel(p.cc.detectedBank))} · 参考汇率:${(p.refRate||0).toFixed(3)}</div>
      </td>
      <td style="text-align:right;white-space:nowrap;font-weight:600;color:var(--green)">RM ${p.cc.amount.toFixed(2)}</td>
      <td style="text-align:center;font-weight:600;color:${rateColor};font-size:12px">${p.rate.toFixed(4)}</td>
    </tr>`;
  }
  const acceptedCount = proposals.filter(p => p.accepted).length;
  const html = `<div style="padding:24px;max-width:100%">
    <h3 style="margin:0 0 6px;font-size:16px;color:#fff">` + "\U0001f517 " + `一键关联预览</h3>
    <p style="margin:0 0 16px;font-size:12px;color:var(--muted)">
      找到 <b style="color:var(--blue)">${proposals.length}</b> 组匹配（日期±2天，汇率范围 ` + "\u00a5" + `1 = RM ${(proposals._rateMin||0).toFixed(2)}-${(proposals._rateMax||0).toFixed(2)}）。请逐条检查，取消不正确的关联。
    </p>
    <div style="max-height:55vh;overflow-y:auto;border:1px solid var(--bdr);border-radius:8px">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:rgba(255,255,255,.05);position:sticky;top:0">
          <th style="padding:8px 4px;width:30px">
            <input type="checkbox" checked onchange="toggleAllAutoLink(this.checked)"
              style="accent-color:var(--blue);width:16px;height:16px;cursor:pointer" title="全选/取消全选">
          </th>
          <th style="padding:8px;text-align:left">微信交易</th>
          <th style="padding:8px;text-align:right">微信金额</th>
          <th style="padding:8px;width:30px"></th>
          <th style="padding:8px;text-align:left">信用卡交易</th>
          <th style="padding:8px;text-align:right">CC金额</th>
          <th style="padding:8px;text-align:center">汇率</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px">
      <span style="font-size:12px;color:var(--muted)" id="autolink-count">已选 ${acceptedCount} / ${proposals.length} 条</span>
      <div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm" onclick="closeAutoLinkReview()">取消</button>
        <button class="btn btn-pri btn-sm" onclick="confirmAutoLink()" id="autolink-confirm-btn">` + "\u2705 " + `确认关联 (${acceptedCount})</button>
      </div>
    </div>
  </div>`;

  let modal = document.getElementById("autolink-modal");
  if(!modal){
    modal = document.createElement("div");
    modal.id = "autolink-modal";
    modal.className = "modal";
    modal.innerHTML = '<div class="modal-box" style="width:900px;max-width:95vw;padding:0;overflow:hidden"></div>';
    modal.onclick = e => { if(e.target === modal) closeAutoLinkReview(); };
    document.body.appendChild(modal);
  }
  modal.querySelector(".modal-box").innerHTML = html;
  modal.classList.add("show");
}

function toggleAutoLinkRow(idx, checked){
  autoLinkProposals[idx].accepted = checked;
  const row = document.getElementById("autolink-row-" + idx);
  if(row) row.className = "autolink-row " + (checked ? "" : "autolink-rejected");
  _updateAutoLinkCount();
}

function toggleAllAutoLink(checked){
  for(let i = 0; i < autoLinkProposals.length; i++){
    autoLinkProposals[i].accepted = checked;
    const row = document.getElementById("autolink-row-" + i);
    if(row){
      row.className = "autolink-row " + (checked ? "" : "autolink-rejected");
      const cb = row.querySelector("input[type=checkbox]");
      if(cb) cb.checked = checked;
    }
  }
  _updateAutoLinkCount();
}

function _updateAutoLinkCount(){
  const accepted = autoLinkProposals.filter(p => p.accepted).length;
  const total = autoLinkProposals.length;
  const countEl = document.getElementById("autolink-count");
  if(countEl) countEl.textContent = `已选 ${accepted} / ${total} 条`;
  const btn = document.getElementById("autolink-confirm-btn");
  if(btn) btn.textContent = "\u2705 确认关联 (" + accepted + ")";
}

function confirmAutoLink(){
  const accepted = autoLinkProposals.filter(p => p.accepted);
  if(!accepted.length){
    showToast("没有选择任何关联");
    return;
  }
  for(const p of accepted){
    const wx = ccLedgerWX.find(t => t.id === p.wx.id);
    const cc = ccLedgerCC.find(t => t.id === p.cc.id);
    if(!wx || !cc) continue;
    wx.crossRefId = cc.id;
    cc.crossRefId = wx.id;
    wx.manualCrossRef = true;
    cc.manualCrossRef = true;
    wx.crossRefRate = p.rate;
    cc.crossRefRate = p.rate;
  }
  saveLedger();
  closeAutoLinkReview();
  showToast(`\u2705 已关联 ${accepted.length} 条交易`);
  renderCCLedgerCC();
  renderCCLedgerWX();
}

function closeAutoLinkReview(){
  autoLinkProposals = [];
  const modal = document.getElementById("autolink-modal");
  if(modal) modal.classList.remove("show");
}

function unlinkAllCrossRef(){
  const linked = ccLedgerWX.filter(t => t.crossRefId);
  if(!linked.length){
    showToast("没有已关联的微信交易");
    return;
  }
  showConfirm(`确定要取消全部 <b>${linked.length}</b> 条微信↔信用卡关联吗？`, ()=>{
    for(const wx of linked){
      const cc = ccLedgerCC.find(t => t.id === wx.crossRefId);
      if(cc){
        delete cc.crossRefId;
        delete cc.crossRefRate;
        delete cc.manualCrossRef;
      }
      delete wx.crossRefId;
      delete wx.crossRefRate;
      delete wx.manualCrossRef;
    }
    saveLedger();
    showToast(`✅ 已取消 ${linked.length} 条关联`);
    renderCCLedgerCC();
    renderCCLedgerWX();
  }, "取消关联确认", "⚠️", "btn-danger");
}

function _isWechatRelated(desc){
  if(!desc) return false;
  const d = desc.toLowerCase();
  return d.includes("wechat") || d.includes("weixin") || d.includes("wei xin")
      || d.includes("wx") || d.includes("tenpay") || d.includes("微信");
}

function renderCCLedgerCC(){
  const container = document.getElementById("cc-ledger-body-cc");
  if(!container) return;
  if(!ccLedgerCC.length){
    container.innerHTML = '<div class="empty"><div class="icon">💳</div><h3>账本为空</h3><p style="font-size:12px;color:var(--muted)">上传信用卡账单，数据会自动保存到账本</p></div>';
    return;
  }
  const ccMonths = _groupByMonth(ccLedgerCC);
  const ccTotal = ccLedgerCC.reduce((s,t)=>s+t.amount, 0);
  const ccLinked = ccLedgerCC.filter(t=>t.crossRefId).length;

  // Bank breakdown
  const banks = {};
  for(const t of ccLedgerCC){
    const b = _bankLabel(t.detectedBank);
    if(!banks[b]) banks[b] = {count:0, total:0};
    banks[b].count++;
    banks[b].total += t.amount;
  }
  const bankEntries = Object.entries(banks).sort((a,b)=>b[1].count-a[1].count);

  let html = `<div class="ledger-section">
    <div class="ledger-section-head">
      <div>
        <span style="font-size:15px;font-weight:700;color:#fff">💳 信用卡交易</span>
        <span style="font-size:12px;color:var(--muted);margin-left:8px">${ccMonths.length} 个月 / ${ccLedgerCC.length} 条</span>
        ${ccLinked ? `<span style="font-size:11px;color:var(--blue);margin-left:8px">🔗 ${ccLinked} 条已关联微信</span>` : ""}
      </div>
      <span style="font-weight:700;color:var(--green)">RM ${ccTotal.toLocaleString("en-MY",{minimumFractionDigits:2})}</span>
    </div>`;

  if(bankEntries.length > 0){
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 12px">';
    for(const [bk, bv] of bankEntries){
      html += `<span class="bank-chip">💳 ${esc(bk)}: ${bv.count} 条 (RM ${bv.total.toFixed(2)})</span>`;
    }
    html += '</div>';
  }

  for(const [monthKey, txns] of ccMonths){
    const mTotal = txns.reduce((s,t)=>s+t.amount, 0);
    html += `<div class="ledger-month">
      <div class="ledger-month-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <span>📅 ${_formatMonth(monthKey)}</span>
        <span class="ledger-month-meta">${txns.length} 条 · RM ${mTotal.toFixed(2)} <span class="ledger-chevron">▼</span></span>
      </div>
      <div class="ledger-month-body">
      <table class="ledger-txn-table"><thead><tr><th>日期</th><th>银行</th><th>描述</th><th style="text-align:right">金额</th><th style="width:120px"></th></tr></thead><tbody>`;
    for(const t of txns){
      // When linking from WX, only show WeChat-related CC transactions
      if(pendingCrossRef && pendingCrossRef.source==="wx" && (t.crossRefId || !_isWechatRelated(t.description))) continue;
      const bk = _bankLabel(t.detectedBank);
      let wxLink = "";
      if(t.crossRefId){
        wxLink = `<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px" onclick="showWxDetail('${t.crossRefId}')" title="查看关联微信交易">💬🔗</button><button class="btn btn-ghost" style="font-size:9px;padding:1px 4px;color:var(--orange)" onclick="unlinkCrossRef('${t.id}','cc')" title="取消关联">⛓‍💥</button>`;
      } else if(pendingCrossRef && pendingCrossRef.source==="wx"){
        wxLink = `<button class="btn" style="font-size:10px;padding:2px 8px;background:var(--blue);color:#fff;border:none;border-radius:4px" onclick="confirmManualCrossRef('${t.id}')" title="选择关联">✓ 关联</button>`;
      } else {
        wxLink = `<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px;color:var(--blue)" onclick="startManualCrossRef('${t.id}','cc')" title="手动关联微信">🔗</button>`;
      }
      const assignBtn = `<button class="cc-assign-btn" style="font-size:10px;padding:2px 6px" onclick="startLedgerAssign('${t.id}','cc')" title="指定到发票">📌</button>`;
      const assigned = t.assignedToInvoiceId ? `<span style="font-size:10px;color:var(--green)">✅</span>` : assignBtn;
      html += `<tr class="${pendingCrossRef && pendingCrossRef.source==='wx' && !t.crossRefId ? 'crossref-selectable' : ''}">
        <td style="white-space:nowrap">${esc(t.date)}</td>
        <td><span class="bank-chip" style="font-size:9px;padding:1px 6px">${esc(bk)}</span></td>
        <td>${esc(t.description)}${t.crossRefRate ? `<div style="font-size:10px;color:var(--muted)">🔗 ¥${(t.amount/t.crossRefRate).toFixed(2)}</div>` : ""}</td>
        <td style="text-align:right;font-weight:600;color:var(--green)">RM ${t.amount.toFixed(2)}</td>
        <td style="text-align:right">${assigned}${wxLink}<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px;color:var(--orange)" onclick="deleteLedgerTxn('${t.id}')" title="删除">✕</button></td>
      </tr>`;
    }
    html += '</tbody></table></div></div>';
  }
  html += `<div style="margin-top:10px"><button class="btn btn-danger btn-sm" style="font-size:11px" onclick="clearLedgerSource('cc')">🗑 清空信用卡账本</button></div></div>`;
  container.innerHTML = html;
}

function renderCCLedgerWX(){
  const container = document.getElementById("cc-ledger-body-wx");
  if(!container) return;
  if(!ccLedgerWX.length){
    container.innerHTML = '<div class="empty"><div class="icon">💬</div><h3>账本为空</h3><p style="font-size:12px;color:var(--muted)">上传微信支付账单，数据会自动保存到账本</p></div>';
    return;
  }
  const wxMonths = _groupByMonth(ccLedgerWX);
  const wxTotal = ccLedgerWX.reduce((s,t)=>s+t.amount, 0);
  const wxLinked = ccLedgerWX.filter(t=>t.crossRefId).length;

  let html = `<div class="ledger-section">
    <div class="ledger-section-head">
      <div>
        <span style="font-size:15px;font-weight:700;color:#fff">💬 微信支付交易</span>
        <span style="font-size:12px;color:var(--muted);margin-left:8px">${wxMonths.length} 个月 / ${ccLedgerWX.length} 条</span>
        ${wxLinked ? `<span style="font-size:11px;color:var(--blue);margin-left:8px">🔗 ${wxLinked} 条已关联信用卡</span>` : ""}
        <button class="btn btn-sm" onclick="autoLinkWxCc()" style="margin-left:10px;font-size:11px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;padding:3px 10px;border-radius:6px">🔗 一键关联</button>
        <button class="btn btn-sm" onclick="unlinkAllCrossRef()" style="margin-left:6px;font-size:11px;background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3);padding:3px 10px;border-radius:6px">⛓️ 一键取消</button>
      </div>
      <span style="font-weight:700;color:var(--green)">¥ ${wxTotal.toLocaleString("en-MY",{minimumFractionDigits:2})}</span>
    </div>`;

  for(const [monthKey, txns] of wxMonths){
    const mTotal = txns.reduce((s,t)=>s+t.amount, 0);
    html += `<div class="ledger-month">
      <div class="ledger-month-header" onclick="this.parentElement.classList.toggle('collapsed')">
        <span>📅 ${_formatMonth(monthKey)}</span>
        <span class="ledger-month-meta">${txns.length} 条 · ¥ ${mTotal.toFixed(2)} <span class="ledger-chevron">▼</span></span>
      </div>
      <div class="ledger-month-body">
      <table class="ledger-txn-table"><thead><tr><th>日期</th><th>描述</th><th>支付方式</th><th style="text-align:right">金额</th><th style="width:120px"></th></tr></thead><tbody>`;
    for(const t of txns){
      let ccLink = "";
      if(t.crossRefId){
        ccLink = `<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px" onclick="showCcDetail('${t.crossRefId}')" title="查看关联信用卡交易">💳🔗</button><button class="btn btn-ghost" style="font-size:9px;padding:1px 4px;color:var(--orange)" onclick="unlinkCrossRef('${t.id}','wx')" title="取消关联">⛓‍💥</button>`;
      } else if(pendingCrossRef && pendingCrossRef.source==="cc"){
        ccLink = `<button class="btn" style="font-size:10px;padding:2px 8px;background:var(--blue);color:#fff;border:none;border-radius:4px" onclick="confirmManualCrossRef('${t.id}')" title="选择关联">✓ 关联</button>`;
      } else {
        ccLink = `<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px;color:var(--blue)" onclick="startManualCrossRef('${t.id}','wx')" title="手动关联信用卡">🔗</button>`;
      }
      const assignBtn = `<button class="cc-assign-btn" style="font-size:10px;padding:2px 6px" onclick="startLedgerAssign('${t.id}','wx')" title="指定到发票">📌</button>`;
      const assigned = t.assignedToInvoiceId ? `<span style="font-size:10px;color:var(--green)">✅</span>` : assignBtn;
      html += `<tr class="${pendingCrossRef && pendingCrossRef.source==='cc' && !t.crossRefId ? 'crossref-selectable' : ''}">
        <td style="white-space:nowrap">${esc(t.date)}</td>
        <td>${esc(t.description)}${t.crossRefRate ? `<div style="font-size:10px;color:var(--muted)">🔗 RM ${(t.amount*t.crossRefRate).toFixed(2)}</div>` : ""}</td>
        <td style="font-size:11px;color:var(--muted)">${esc(t.paymentMethod||"")}</td>
        <td style="text-align:right;font-weight:600;color:var(--green)">¥ ${t.amount.toFixed(2)}</td>
        <td style="text-align:right">${assigned}${ccLink}<button class="btn btn-ghost" style="font-size:10px;padding:2px 6px;color:var(--orange)" onclick="deleteLedgerTxn('${t.id}')" title="删除">✕</button></td>
      </tr>`;
    }
    html += '</tbody></table></div></div>';
  }
  html += `<div style="margin-top:10px"><button class="btn btn-danger btn-sm" style="font-size:11px" onclick="clearLedgerSource('wx')">🗑 清空微信支付账本</button></div></div>`;
  container.innerHTML = html;
}

function clearLedgerSource(source){
  const label = source === "wx" ? "微信支付" : "信用卡";
  showConfirm(`确定要清空${label}账本吗？此操作不可恢复。`, async()=>{
    try{
      const r = await fetch(`/api/cc/ledger/${source}`, {method:"DELETE"});
      const d = await r.json();
      if(d.ok){
        showToast(`已清空${label}账本`, "success");
        await loadFromLedger();
        if(activeCCTab==='wx') renderCCLedgerWX(); else renderCCLedgerCC();
      }
    }catch(e){ showToast("清空失败: "+e.message, "error"); }
  }, "清空确认", "🗑", "btn-danger");
}

async function deleteLedgerTxn(txnId){
  showConfirm("确定要删除此交易记录吗？", async()=>{
    try{
      const r = await fetch(`/api/cc/ledger/transaction/${txnId}`, {method:"DELETE"});
      const d = await r.json();
      if(d.ok){
        showToast("交易已删除", "success");
        await loadFromLedger();
        if(activeCCTab==='wx') renderCCLedgerWX(); else renderCCLedgerCC();
      }
    }catch(e){ showToast("删除失败: "+e.message, "error"); }
  });
}


// ═══════════════════════════════════════════════════════════════
//  CC Session — Load ledger on init
// ═══════════════════════════════════════════════════════════════

async function loadCCSession(){
  await loadFromLedger();
  await runLedgerCrossRef();
}


// ═══════════════════════════════════════════════════════════════
//  Memory Stats
// ═══════════════════════════════════════════════════════════════

function renderMemoryStats(){
  const el = document.getElementById("memory-stats");
  if(!el) return;
  const s = memoryData.suppliers || {};
  const supplierCount = Object.keys(s).length;
  const customCount = (memoryData.customSuppliers||[]).length;
  const descCount = Object.values(memoryData.customDescriptions||{}).reduce((sum,arr)=>sum+arr.length,0);
  if(supplierCount === 0){
    el.innerHTML = '<div style="font-size:12px;color:var(--muted)">暂无学习数据。提交 Claim 后系统将自动学习。</div>';
    return;
  }
  // Show top suppliers
  const sorted = Object.entries(s).sort((a,b)=>(b[1].count||0)-(a[1].count||0)).slice(0,8);
  let html = `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">已学习 <strong style="color:#fff">${supplierCount}</strong> 个供应商 · <strong style="color:#fff">${customCount}</strong> 个自定义供应商 · <strong style="color:#fff">${descCount}</strong> 个自定义描述</div>`;
  html += '<div style="max-height:200px;overflow-y:auto;border:1px solid var(--bdr);border-radius:8px;padding:8px">';
  sorted.forEach(([name, data])=>{
    const cats = data.categories||{};
    const topCat = Object.entries(cats).sort((a,b)=>b[1]-a[1])[0];
    const branches = data.branches||{};
    const topBranch = Object.entries(branches).sort((a,b)=>b[1]-a[1])[0];
    html += `<div style="padding:4px 0;border-bottom:1px solid var(--bdr);font-size:11px">`;
    html += `<span style="color:#fff;font-weight:600">${esc(name)}</span> <span style="color:var(--muted)">×${data.count||0}</span>`;
    if(topCat) html += ` → <span style="color:var(--acc)">${esc(topCat[0])}</span>`;
    if(topBranch) html += ` @ <span style="color:var(--green)">${esc(topBranch[0])}</span>`;
    html += `</div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}
