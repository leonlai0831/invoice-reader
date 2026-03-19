// Separated to avoid circular imports — switchTab is needed by many modules

import * as state from './state';

let _switchTabImpl: ((tab: string) => void) | null = null;

export function registerSwitchTab(fn: (tab: string) => void): void {
  _switchTabImpl = fn;
}

export function switchTab(tab: string): void {
  if (_switchTabImpl) _switchTabImpl(tab);
}
