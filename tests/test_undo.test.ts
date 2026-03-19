// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { pushUndo, undo, redo, canUndo, canRedo, clearUndoHistory } from '../src/undo';

// Mock DOM for updateUndoButtons
beforeEach(() => {
  document.body.innerHTML = '<div id="shortcut-bar"><span class="undo-hint">Ctrl+Z 撤销</span></div>';
  clearUndoHistory();
});

describe('undo/redo stack', () => {
  it('starts empty', () => {
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  it('can push and undo', () => {
    let value = 'new';
    pushUndo({
      description: 'test change',
      undo: () => { value = 'old'; },
      redo: () => { value = 'new'; },
    });
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);

    undo();
    expect(value).toBe('old');
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(true);
  });

  it('can redo after undo', () => {
    let value = 'new';
    pushUndo({
      description: 'test',
      undo: () => { value = 'old'; },
      redo: () => { value = 'new'; },
    });
    undo();
    expect(value).toBe('old');

    redo();
    expect(value).toBe('new');
    expect(canUndo()).toBe(true);
    expect(canRedo()).toBe(false);
  });

  it('clears redo stack on new push', () => {
    pushUndo({ description: 'a', undo: () => {}, redo: () => {} });
    undo();
    expect(canRedo()).toBe(true);

    pushUndo({ description: 'b', undo: () => {}, redo: () => {} });
    expect(canRedo()).toBe(false);
  });

  it('respects 50-entry limit', () => {
    for (let i = 0; i < 60; i++) {
      pushUndo({ description: `entry ${i}`, undo: () => {}, redo: () => {} });
    }
    // Should only keep 50
    let count = 0;
    while (canUndo()) { undo(); count++; }
    expect(count).toBe(50);
  });

  it('clearUndoHistory resets everything', () => {
    pushUndo({ description: 'test', undo: () => {}, redo: () => {} });
    clearUndoHistory();
    expect(canUndo()).toBe(false);
    expect(canRedo()).toBe(false);
  });

  it('undo with no entries does nothing', () => {
    expect(() => undo()).not.toThrow();
  });

  it('redo with no entries does nothing', () => {
    expect(() => redo()).not.toThrow();
  });
});
