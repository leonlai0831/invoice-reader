import type { UndoEntry } from './types';
import { showToast } from './utils';

// ── Undo/Redo Stack ─────────────────────────────────────────────

const MAX_UNDO = 50;
let undoStack: UndoEntry[] = [];
let redoStack: UndoEntry[] = [];

export function pushUndo(entry: UndoEntry): void {
  undoStack.push(entry);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack = []; // new action clears redo
  updateUndoButtons();
}

export function undo(): void {
  const entry = undoStack.pop();
  if (!entry) return;
  entry.undo();
  redoStack.push(entry);
  updateUndoButtons();
  showToast(`↩ 撤销: ${entry.description}`, 'info', 2000);
}

export function redo(): void {
  const entry = redoStack.pop();
  if (!entry) return;
  entry.redo();
  undoStack.push(entry);
  updateUndoButtons();
  showToast(`↪ 重做: ${entry.description}`, 'info', 2000);
}

export function canUndo(): boolean {
  return undoStack.length > 0;
}

export function canRedo(): boolean {
  return redoStack.length > 0;
}

function updateUndoButtons(): void {
  // Update shortcut bar hints
  const bar = document.getElementById('shortcut-bar');
  if (bar) {
    const undoHint = bar.querySelector('.undo-hint');
    if (undoHint) {
      undoHint.textContent = canUndo() ? `Ctrl+Z 撤销 (${undoStack.length})` : 'Ctrl+Z 撤销';
    }
  }
}

export function clearUndoHistory(): void {
  undoStack = [];
  redoStack = [];
  updateUndoButtons();
}
