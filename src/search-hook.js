// search-ux Part 2/3: type-to-search + configurable clear key. Generalized from
// the WorkOrders '/'-to-focus handler. React-only. Two hooks:
//
// useModalOpenFlag(active): while `active`, registers a live token so
//   useTypeToSearch stays quiet behind full-screen overlays (Modal, CommandCenter,
//   SettingsOverlay, QuickJump, ScheduleModal, InvoiceEditor call this). Tokens
//   replace the old hand-kept window.__modalOpen ref-count, which locked typing
//   app-wide whenever a decrement was missed -- see the LOCK INVARIANT below.
//
// useTypeToSearch({ setValue, inputRef, disabled }): when the module is on screen
//   and the user is NOT already typing in a field or behind a modal, a printable
//   keystroke focuses the module's search input and appends the char; the
//   configurable clear key (default Backspace, from ClearSearchKeyContext) clears
//   it. Once focus moves into the input, later keys edit natively (this global
//   handler only acts when NOT already in a field), so the clear key doubles as a
//   normal Backspace while editing.
import React from 'react';
import { flushSync } from 'react-dom';
import { useClearSearchKey } from './contexts.js';

// LOCK INVARIANT: if no modal component is actually mounted, typing MUST work,
// whatever the counter says. window.__modalOpen is now only a MIRROR (the lock
// diagnostics below read it, and anything outside this file may still peek at
// it); the gate is this token set. A token counts only while the component that
// registered it can still be re-rendered by React, so an unmount whose cleanup
// never ran heals on the next keystroke instead of swallowing type-to-search
// app-wide until restart. Not a timed reset: a token is dropped only after it is
// PROVEN dead, and every prune is counted for the diagnostics.
const modalTokens = new Set();
function syncModalCount() {
  if (typeof window !== 'undefined') window.__modalOpen = modalTokens.size;
}

export function useModalOpenFlag(active) {
  const [, bump] = React.useState(0);
  // One token per hook instance. `ping` re-renders the owner; only a mounted
  // component can answer, which is what makes a stale token detectable.
  const tokenRef = React.useRef(null);
  if (!tokenRef.current) tokenRef.current = { alive: true, ping: () => bump(n => n + 1) };
  // Proof of life. No dep array on purpose: this runs on EVERY commit, and it is
  // a LAYOUT effect so a flushSync'd ping is answered before isModalOpen() reads
  // the answer back in the same keydown.
  React.useLayoutEffect(() => { tokenRef.current.alive = true; });
  React.useEffect(() => {
    if (!active) return undefined;
    if (typeof window === 'undefined') return undefined;
    const tok = tokenRef.current;
    modalTokens.add(tok);
    syncModalCount();
    return () => { modalTokens.delete(tok); syncModalCount(); };
  }, [active]);
}

// True only while a modal that can still render is on screen. Revalidates first:
// clear every token's proof, ping all owners synchronously, drop whoever did not
// answer (their cleanup never ran = leak).
export function isModalOpen() {
  if (!modalTokens.size) {
    // No modal is mounted, so nothing may gate typing. A mirror still holding a
    // count here IS the old leak (or an outside writer); re-sync it to the truth
    // and count it, rather than letting it read back as evidence later.
    if (typeof window !== 'undefined' && window.__modalOpen) {
      window.__modalLeaksHealed = (window.__modalLeaksHealed || 0) + 1;
      syncModalCount();
    }
    return false;
  }
  modalTokens.forEach(t => { t.alive = false; });
  let pinged = true;
  try {
    flushSync(() => { modalTokens.forEach(t => t.ping()); });
  } catch (_) {
    pinged = false;   // flushSync refuses mid-render; do NOT prune on no answer
  }
  if (!pinged) {
    modalTokens.forEach(t => { t.alive = true; });
    return modalTokens.size > 0;
  }
  modalTokens.forEach(t => {
    if (t.alive) return;
    modalTokens.delete(t);
    if (typeof window !== 'undefined') window.__modalLeaksHealed = (window.__modalLeaksHealed || 0) + 1;
    // eslint-disable-next-line no-console
    console.warn('[modalFlag] pruned a leaked modal flag (its cleanup never ran)');
  });
  syncModalCount();
  return modalTokens.size > 0;
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
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(document.activeElement)) return;
      // No mounted search input to receive the char -> do NOT preventDefault it into the
      // void (that eats keystrokes when focus is on <body>, e.g. just after a note-card
      // edit unmounts its textarea). Let the key through natively. (QA Q1 hardening.)
      if (!(inputRef && inputRef.current)) return;
      // Modal gate LAST: it revalidates the live modals (a synchronous re-render
      // per open modal), so it must not run for keys the checks above already
      // dropped -- notably every keystroke typed INSIDE a modal's own field.
      if (isModalOpen()) return;
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
      // modalOpen = the mirrored counter, modalLive = the token set that actually
      // gates typing. A gap between them IS the leak, so both are reported.
      isTyping: isTypingTarget(el), modalOpen: window.__modalOpen || 0,
      modalLive: modalTokens.size, leaksHealed: window.__modalLeaksHealed || 0,
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
      modalLive: modalTokens.size, leaksHealed: window.__modalLeaksHealed || 0,
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
      modalTokens.clear();   // the tokens are the gate now; the counter mirrors them
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
