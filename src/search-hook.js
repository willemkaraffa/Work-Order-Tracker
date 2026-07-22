// search-ux Part 2/3: type-to-search + configurable clear key. Generalized from
// the WorkOrders '/'-to-focus handler. React-only. Two hooks:
//
// useModalOpenFlag(active): while `active`, bumps a window-level ref-count so
//   useTypeToSearch stays quiet behind full-screen overlays (Modal, CommandCenter,
//   InvoiceEditor, QuickJump, FullScreenLanding call this).
//
// useTypeToSearch({ setValue, inputRef, disabled }): when the module is on screen
//   and the user is NOT already typing in a field or behind a modal, a printable
//   keystroke focuses the module's search input and appends the char; the
//   configurable clear key (default Backspace, from ClearSearchKeyContext) clears
//   it. Once focus moves into the input, later keys edit natively (this global
//   handler only acts when NOT already in a field), so the clear key doubles as a
//   normal Backspace while editing.
import React from 'react';
import { useClearSearchKey } from './contexts.js';

export function useModalOpenFlag(active) {
  React.useEffect(() => {
    if (!active) return undefined;
    if (typeof window === 'undefined') return undefined;
    window.__modalOpen = (window.__modalOpen || 0) + 1;
    return () => { window.__modalOpen = Math.max(0, (window.__modalOpen || 1) - 1); };
  }, [active]);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useTypeToSearch({ setValue, inputRef, disabled = false }) {
  const clearKey = useClearSearchKey();
  // Read mutable config via refs so the listener binds once (stable handler).
  const clearRef = React.useRef(clearKey);
  clearRef.current = clearKey;
  const disabledRef = React.useRef(disabled);
  disabledRef.current = disabled;
  React.useEffect(() => {
    const onKey = (e) => {
      if (disabledRef.current) return;
      if (typeof window !== 'undefined' && window.__modalOpen > 0) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;
      // No mounted search input to receive the char -> do NOT preventDefault it into the
      // void (that eats keystrokes when focus is on <body>, e.g. just after a note-card
      // edit unmounts its textarea). Let the key through natively. (QA Q1 hardening.)
      if (!(inputRef && inputRef.current)) return;
      if (e.key === clearRef.current) {
        e.preventDefault();
        if (setValue) setValue('');
        return;
      }
      if (e.key && e.key.length === 1) {
        e.preventDefault();
        if (inputRef && inputRef.current) inputRef.current.focus();
        if (setValue) setValue((v) => (v || '') + e.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setValue, inputRef]);
}

// QA Q1 diagnostic for the persistent text lock-out. When typing "freezes", open the
// devtools console and run `__lockDebug()` -- it reports what actually holds focus and
// whether the modal ref-count leaked, which pins the mechanism (memory: capture
// activeElement, don't blind-patch). Defined once at import; zero runtime cost otherwise.
if (typeof window !== 'undefined' && !window.__lockDebug) {
  window.__lockDebug = () => {
    const el = document.activeElement;
    const info = {
      tag: el && el.tagName, id: (el && el.id) || null, cls: (el && el.className) || null,
      isTyping: isTypingTarget(el), modalOpen: window.__modalOpen || 0,
      rootChildren: (() => { const r = document.getElementById('root'); return r ? r.children.length : -1; })(),
      inputs: document.querySelectorAll('input, textarea').length,
    };
    // eslint-disable-next-line no-console
    console.log('[lockDebug]', info);
    return info;
  };

  // Passive watchdog + rescue for the text lock-out (bug_note_card_input_lock). Runs once.
  // The rescue hotkey (Ctrl+Alt+U, registered in main) both UNSTICKS focus and captures
  // state; the watchdog auto-captures when the renderer is alive but focus is stuck.
  // Last uncaught error, kept for the snapshot. A render throw unmounts the React tree,
  // which takes the search input (and every other focusable node) with it: keys then go
  // nowhere and focus sits on BODY, which is indistinguishable from a "focus lock" in the
  // old snapshot. Recording the error plus the root's child count separates those two.
  let lastErr = null;
  window.addEventListener('error', (e) => {
    lastErr = { msg: String((e && e.message) || e), at: Date.now() };
  });
  window.addEventListener('unhandledrejection', (e) => {
    lastErr = { msg: 'unhandledrejection: ' + String((e && e.reason && e.reason.message) || (e && e.reason) || e), at: Date.now() };
  });

  const snap = (when, extra) => {
    const el = document.activeElement;
    const root = document.getElementById('root');
    return { when, tag: el && el.tagName, id: (el && el.id) || null,
      isTyping: isTypingTarget(el), modalOpen: window.__modalOpen || 0,
      // 0 = the tree is GONE (render threw). >0 = the tree is alive and this really is
      // a focus problem. The single fact the old capture could not supply.
      rootChildren: root ? root.children.length : -1,
      inputs: document.querySelectorAll('input, textarea').length,
      lastErr,
      ...(extra || {}) };
  };
  // Main -> renderer rescue: reset any leaked modal ref-count, blur the stuck node, and
  // log what was focused at the moment of the lock. webContents.focus() was already
  // re-asserted main-side before this fires.
  if (window.lockDiag && window.lockDiag.onRescue) {
    window.lockDiag.onRescue(() => {
      const info = snap('rescue');
      // eslint-disable-next-line no-console
      console.log('[lockRescue]', info);
      if (window.lockDiag.log) window.lockDiag.log(info);
      window.__modalOpen = 0;
      try { const el = document.activeElement; if (el && el.blur) el.blur(); } catch (_) {}
      try { const r = document.getElementById('root'); if (r && r.focus) r.focus(); } catch (_) {}
    });
  }
  // Watchdog: >=5 printable keys within 3s while NOTHING editable is focused = user typing
  // into the void (the lock signature). Log once per burst; never preventDefault (observe only).
  let recent = [];
  let logged = false;
  window.addEventListener('keydown', (e) => {
    if (!(e.key && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Enter'))) return;
    const now = Date.now();
    recent.push({ t: now, bad: !isTypingTarget(document.activeElement) });
    recent = recent.filter(r => now - r.t < 3000);
    if (!logged && recent.filter(r => r.bad).length >= 5) {
      logged = true;
      const info = snap('watchdog', { badKeys: recent.filter(r => r.bad).length });
      // eslint-disable-next-line no-console
      console.warn('[lockWatchdog] suspected input lock', info, '-- press Ctrl+Alt+U to rescue');
      if (window.lockDiag && window.lockDiag.log) window.lockDiag.log(info);
      setTimeout(() => { logged = false; }, 10000);
    }
  });
}
