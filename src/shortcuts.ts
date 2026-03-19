import { undo, redo } from './undo';
import { closeConfirm } from './utils';

// ── Keyboard Shortcuts ──────────────────────────────────────────

interface ShortcutDef {
  key: string;
  ctrl?: boolean;
  context: string;
  description: string;
  action: (e: KeyboardEvent) => void;
}

// Dynamically registered shortcuts — modules register via registerShortcut
const dynamicShortcuts: Array<{ key: string; ctrl?: boolean; action: (e: KeyboardEvent) => void }> = [];

export function registerShortcut(key: string, ctrl: boolean, action: (e: KeyboardEvent) => void): void {
  dynamicShortcuts.push({ key, ctrl, action });
}

// All shortcut definitions
function getShortcuts(): ShortcutDef[] {
  return [
    { key: 'z', ctrl: true, context: '全局', description: '撤销', action: () => undo() },
    { key: 'y', ctrl: true, context: '全局', description: '重做', action: () => redo() },
    { key: 's', ctrl: true, context: '全局', description: '保存', action: (e) => { e.preventDefault(); /* auto-save is already active */ } },
    { key: 'e', ctrl: true, context: '记录', description: '导出 Excel', action: (e) => { e.preventDefault(); } },
    { key: 'a', ctrl: true, context: '记录', description: '全选', action: () => {} },
    { key: 'Delete', context: '记录', description: '删除选中', action: () => {} },
    { key: '?', context: '全局', description: '快捷键帮助', action: () => toggleShortcutPanel() },
  ];
}

export function initShortcuts(): void {
  document.addEventListener('keydown', handleKeyDown);
}

function handleKeyDown(e: KeyboardEvent): void {
  const tag = (document.activeElement?.tagName || '').toUpperCase();
  const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Escape: close modals (priority order)
  if (e.key === 'Escape') {
    const cm = document.getElementById('confirm-modal');
    if (cm?.classList.contains('show')) { closeConfirm(false); return; }
    const nm = document.getElementById('notes-modal');
    if (nm?.classList.contains('show')) {
      // closeNotesModal imported dynamically to avoid circular deps
      nm.classList.remove('show');
      return;
    }
    const dm = document.getElementById('dup-modal');
    if (dm?.classList.contains('show')) { dm.classList.remove('show'); return; }
    const sm = document.getElementById('modal');
    if (sm?.classList.contains('show')) { sm.classList.remove('show'); return; }
    const sp = document.getElementById('shortcut-panel');
    if (sp?.classList.contains('show')) { sp.classList.remove('show'); return; }
    const im = document.getElementById('img-modal');
    if (im?.classList.contains('show')) { im.classList.remove('show'); return; }
    return;
  }

  // Enter confirms active confirmation dialog
  if (e.key === 'Enter') {
    const cm = document.getElementById('confirm-modal');
    if (cm?.classList.contains('show') && !isEditing) {
      closeConfirm(true);
      return;
    }
  }

  // Ctrl shortcuts
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z' || e.key === 'Z') {
      if (!isEditing) { e.preventDefault(); undo(); return; }
    }
    if (e.key === 'y' || e.key === 'Y') {
      if (!isEditing) { e.preventDefault(); redo(); return; }
    }
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault(); // prevent browser save dialog
      return;
    }
    // Check dynamic shortcuts
    for (const s of dynamicShortcuts) {
      if (s.ctrl && (e.key === s.key || e.key === s.key.toUpperCase())) {
        e.preventDefault();
        s.action(e);
        return;
      }
    }
  }

  // Non-ctrl shortcuts (only when not editing)
  if (!isEditing && !e.ctrlKey && !e.metaKey) {
    if (e.key === '?') {
      toggleShortcutPanel();
      return;
    }
    // Check dynamic shortcuts
    for (const s of dynamicShortcuts) {
      if (!s.ctrl && e.key === s.key) {
        s.action(e);
        return;
      }
    }
  }
}

// ── Shortcut Help Panel ─────────────────────────────────────────

function toggleShortcutPanel(): void {
  let panel = document.getElementById('shortcut-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'shortcut-panel';
    panel.className = 'modal';
    panel.onclick = (e) => { if (e.target === panel) panel!.classList.remove('show'); };

    const shortcuts = getShortcuts();
    const grouped: Record<string, ShortcutDef[]> = {};
    for (const s of shortcuts) {
      if (!grouped[s.context]) grouped[s.context] = [];
      grouped[s.context].push(s);
    }

    let html = '<div class="modal-box" style="width:480px"><h3>⌨️ 快捷键</h3>';
    html += '<div style="margin-top:16px">';
    for (const [ctx, list] of Object.entries(grouped)) {
      html += `<div style="margin-bottom:16px"><div style="font-size:11px;font-weight:700;color:var(--acc);text-transform:uppercase;margin-bottom:8px">${ctx}</div>`;
      for (const s of list) {
        const keyLabel = (s.ctrl ? 'Ctrl+' : '') + s.key.toUpperCase();
        html += `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:13px">
          <span style="color:var(--txt)">${s.description}</span>
          <kbd style="background:var(--surf2);border:1px solid var(--bdr);border-radius:4px;padding:2px 8px;font-size:11px;font-family:monospace;color:var(--muted)">${keyLabel}</kbd>
        </div>`;
      }
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="modal-actions"><button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'shortcut-panel\').classList.remove(\'show\')">关闭</button></div>';
    html += '</div>';
    panel.innerHTML = html;
    document.body.appendChild(panel);
  }

  panel.classList.toggle('show');
}

// ── Shortcut Bar (bottom hints) ─────────────────────────────────

export function createShortcutBar(): void {
  const bar = document.createElement('div');
  bar.id = 'shortcut-bar';
  bar.innerHTML = `
    <span class="undo-hint">Ctrl+Z 撤销</span>
    <span>·</span>
    <span>Ctrl+S 保存</span>
    <span>·</span>
    <span>? 快捷键</span>
  `;
  document.body.appendChild(bar);
}
