# CHANGE #2 - Status change without edit form + scroll preservation

You are continuing a roadmap on the Work Order Tracker (Electron + React-via-Babel desktop app). Work in this repo:

```
C:\dev\Work-Order-Tracker
```

Branch: `claude/roadmap-v3.1`. App version 3.0.1. User runs dev build with `npm start` from this directory (quit installed-app tray instance first - single-instance lock). Reload with Ctrl+R. JSX compiled at runtime by Babel standalone (index.html:28); no local build step. Verify syntax by reading; user reloads to test.

## Rules (from CLAUDE.md - obey exactly)
- Read existing files before writing. Don't re-read unless changed.
- No emojis or em-dashes.
- Do not guess APIs, versions, flags, SHAs, or package names. Verify by reading code/docs.
- Work silently; chat only after the task is complete; minimal wording.
- Before implementing, search for existing working code and prefer wrapping it.
- When you flag a risk in static review, either mitigate it or design a live test for it before proceeding.
- On the second failed attempt at the same problem, stop and re-examine the approach before a third try.
- Commit each discrete change separately. Do NOT push. Do NOT publish.

## Roadmap line (ROADMAP.md line 11)
"CHANGE: Allow the status of WOs to be changed without having to go into the edit form. detail pane dropdown and right click context menu"

## Bundled fix (scroll preservation - user reported alongside line 11)
The asc/desc direction toggle (and sort key changes) snap the list scrollbar to the top. The scroll position must be preserved.

---

## Current state (all verified - read before coding)

### Status change infrastructure already present
- `detailAction` in App (`index.html:4557`) handles `kind === 'setStatus'` (`index.html:4562`): calls `updateOrder(selectedWO, cur => ({ ...cur, status: payload, history: [...] }))` and toasts. Works correctly.
- `DetailOverflow` (three-dot menu, `index.html:2018`) already has "Change status..." for `tab === 'active'` WOs (`index.html:2071`) opening a status sub-menu (`index.html:2096-2102`) that calls `onAction('setStatus', s)`. The mechanism exists; Tasks 1 and 2 provide faster/additional access paths.
- `statuses` flat list (`data?.statuses || DEFAULT_STATUSES`, App `index.html:3890`) is already passed to `DetailPane` via prop (`index.html:4720`) and to `DetailOverflow` (`index.html:2159`).
- `DetailPane` signature: `index.html:2117`. Props: `data, onSendToInvoice, onMarkInvoiced, onMarkPaid, onSyncWO, onAddNote, onEditNote, onDeleteNote, onPinNote, onEdit, onAction, statuses`.

### Status display in detail pane
`<StatusPill status={data.status} />` at `index.html:2173`, inside a flex row that also shows age. A static pill; not interactive.

### List row rendering
`ListRow` at `index.html:1934`: `{ row, selected, onClick, hideAge, view, density, checked, onCheck }`. No context menu support yet.
Rendered in `ListPane` at `index.html:1880-1892`. `ListPane` does NOT currently receive `statuses` as a prop.

### Scroll container
`index.html:1855`: `<div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>` — the scrollable list div. No ref, no onScroll handler currently. The browser resets its scrollTop when React re-orders list children on sort change.

---

## Task 0 - preserve scroll position on sort/filter change (bundled fix)
No changes to App needed.

In `ListPane` (`index.html:1684`):
1. Add two refs near the top of the function body (after existing `useRef`/`useState`):
   ```js
   const scrollRef = React.useRef(null);
   const savedScrollTop = React.useRef(0);
   ```
2. Add a `useLayoutEffect` that restores scroll after sort changes. Depend on `sort.key` and `sort.dir` only (not the full object reference, which is new every render):
   ```js
   React.useLayoutEffect(() => {
     if (scrollRef.current) scrollRef.current.scrollTop = savedScrollTop.current;
   }, [sort && sort.key, sort && sort.dir]);
   ```
3. Attach `ref` and `onScroll` to the scroll container div at `index.html:1855`:
   ```jsx
   <div
     ref={scrollRef}
     onScroll={(e) => { savedScrollTop.current = e.currentTarget.scrollTop; }}
     style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
   >
   ```
Commit alone. Live-test: scroll partway down the Active list, toggle sort direction or change sort key; verify the scroll position stays put.

---

## Task 1 - clickable status dropdown on the detail pane status pill
Faster path to status change: click the `<StatusPill>` to get a status picker, without opening the three-dot menu.

Only applies when `data.tab === 'active'` (same condition as the three-dot "Change status..." at `index.html:2071`). Leave the pill as static display on other tabs.

In `DetailPane` (`index.html:2117`):
1. Add local state near the top of the function body:
   ```js
   const [statusMenuOpen, setStatusMenuOpen] = React.useState(false);
   const statusRef = React.useRef(null);
   ```
2. Add a click-outside/Escape effect (same pattern as `SortDropdown`/`DetailOverflow`):
   ```js
   React.useEffect(() => {
     if (!statusMenuOpen) return;
     const close = () => setStatusMenuOpen(false);
     const onKey = (e) => { if (e.key === 'Escape') close(); };
     setTimeout(() => document.addEventListener('click', close), 0);
     document.addEventListener('keydown', onKey);
     return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey); };
   }, [statusMenuOpen]);
   ```
3. Replace `<StatusPill status={data.status} />` at `index.html:2173` with a conditionally interactive wrapper:
   ```jsx
   {data.tab === 'active' ? (
     <div
       ref={statusRef}
       style={{ position: 'relative', display: 'inline-block', cursor: 'pointer' }}
       onClick={(e) => { e.stopPropagation(); setStatusMenuOpen(o => !o); }}
     >
       <StatusPill status={data.status} />
       {statusMenuOpen && (
         <div style={{
           position: 'absolute', top: '100%', left: 0, marginTop: 4,
           minWidth: 200, background: 'var(--bg-surface)',
           border: '1px solid var(--border-2)', borderRadius: 8,
           boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
           padding: '4px 0', zIndex: 60,
         }}>
           <MenuCaption>Set status</MenuCaption>
           {(statuses || DEFAULT_STATUSES).map(s => (
             <MenuItem key={s} onClick={(e) => {
               e.stopPropagation();
               setStatusMenuOpen(false);
               onAction && onAction('setStatus', s);
             }}>{s}</MenuItem>
           ))}
         </div>
       )}
     </div>
   ) : (
     <StatusPill status={data.status} />
   )}
   ```
Note: `StatusPill` (`index.html:315`) only accepts `{ status, size }` — it does NOT forward `style`. The `cursor: 'pointer'` therefore lives on the wrapper `<div>` (as shown), not on the pill itself.

Commit alone. Live-test: open an active-tab WO in the detail pane; click the status pill; a dropdown appears; pick a status; pill updates and a toast fires.

---

## Task 2 - right-click context menu on list rows
Right-clicking a row opens a floating menu with quick actions including status change. Works on the right-clicked WO regardless of which WO is currently selected/open in the detail pane.

### New callback in App
`detailAction` uses `selectedWO` as the implicit target. Add `onWoAction(id, kind, payload)` in App beside `detailAction` (`index.html:4557`) that accepts an explicit `id`:
```js
const woAction = React.useCallback((id, kind, payload) => {
  if (!id) return;
  const histEntry = (action, detail) => ({ ts: Date.now(), action, detail: detail || '' });
  switch (kind) {
    case 'setStatus':
      updateOrder(id, cur => ({
        ...cur, status: payload,
        history: [...(cur.history || []), histEntry('status', (cur.status || '') + ' → ' + payload)],
      }));
      toast('Status: ' + payload);
      break;
    case 'backToActive':   // sent -> active (mirrors detailAction case at index.html:4579)
      updateOrder(id, cur => ({
        ...cur, tab: 'active',
        history: [...(cur.history || []), histEntry('back to Active')],
      }));
      toast('Moved to Active');
      break;
    case 'backToSent':     // invoiced -> sent to invoice (mirrors detailAction case at index.html:4587)
      updateOrder(id, cur => ({
        ...cur, tab: 'sent',
        history: [...(cur.history || []), histEntry('back to Sent to invoice')],
      }));
      toast('Moved to Sent to invoice');
      break;
    case 'softDelete':
      updateOrder(id, cur => ({
        ...cur, deleted: true,
        history: [...(cur.history || []), histEntry('sent to Trash')],
      }));
      toast('Sent to Trash');
      break;
    default: break;
  }
}, [updateOrder, toast]);
```
The four cases above (`setStatus`, `backToActive`, `backToSent`, `softDelete`) are byte-for-byte copies of existing `detailAction` cases (`index.html:4562`, `:4579`, `:4587`, `:4603`) with `id` substituted for `selectedWO`. To avoid two divergent copies, prefer the consolidation refactor: keep one implementation in `woAction(id, kind, payload)` and rewrite `detailAction` as `(kind, payload) => woAction(selectedWO, kind, payload)`. Only skip the refactor if `detailAction` has cases that genuinely need `selectedWO`-specific behavior beyond the id (it does not, per the read).

### Thread to ListPane
- Add `statuses` and `onWoAction` props to `ListPane` signature and the call site (`index.html:4755`).
- At the call site, pass `statuses={statuses}` and `onWoAction={woAction}`.

### Context menu state in ListPane
Add state and handler near the top of `ListPane`:
```js
const [ctxMenu, setCtxMenu] = React.useState(null); // { woId, x, y, tab } | null
const closeCtx = () => setCtxMenu(null);
```
Add a document dismiss handler when the menu is open (click-outside + Escape, plus a `contextmenu` listener so a right-click elsewhere also dismisses). The row's own `onContextMenu` calls `e.stopPropagation()` (see below) so opening on one row does not immediately fire this document handler and close itself:
```js
React.useEffect(() => {
  if (!ctxMenu) return;
  const onKey = (e) => { if (e.key === 'Escape') closeCtx(); };
  setTimeout(() => {
    document.addEventListener('click', closeCtx);
    document.addEventListener('contextmenu', closeCtx);
  }, 0);
  document.addEventListener('keydown', onKey);
  return () => {
    document.removeEventListener('click', closeCtx);
    document.removeEventListener('contextmenu', closeCtx);
    document.removeEventListener('keydown', onKey);
  };
}, [ctxMenu]);
```
Important interaction: with the `contextmenu` document listener active, a right-click on a DIFFERENT row must reposition the menu rather than just close it. Make the row handler call `e.stopPropagation()` (so the document `contextmenu` listener does not fire for right-clicks that land on a row) in addition to `e.preventDefault()`. Right-clicks on empty space (not a row) will bubble to the document and dismiss, which is the desired behavior.

### ListRow: add onContextMenu prop
Add `onContextMenu` to `ListRow`'s props and wire it to `onContextMenu` on the row root element:
```jsx
<div ... onContextMenu={onContextMenu ? (e) => { e.preventDefault(); e.stopPropagation(); onContextMenu(e, row.wo, row.tab); } : undefined}>
```
Pass it from ListPane at the `<ListRow>` call site (`index.html:1881`):
```jsx
onContextMenu={(e, woId, tab) => setCtxMenu({ woId, x: e.clientX, y: e.clientY, tab })}
```

### Context menu render in ListPane
Add the floating context menu just before the closing `</section>` tag in ListPane's return (`index.html:1897`):
```jsx
{ctxMenu && (
  <div
    style={{
      position: 'fixed', top: ctxMenu.y, left: ctxMenu.x,
      minWidth: 200, background: 'var(--bg-surface)',
      border: '1px solid var(--border-2)', borderRadius: 8,
      boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
      padding: '4px 0', zIndex: 200,
    }}
    onClick={(e) => e.stopPropagation()}
  >
    {ctxMenu.tab === 'active' && (<>
      <MenuCaption>Set status</MenuCaption>
      {(statuses || DEFAULT_STATUSES).map(s => (
        <MenuItem key={s} onClick={() => { onWoAction && onWoAction(ctxMenu.woId, 'setStatus', s); closeCtx(); }}>{s}</MenuItem>
      ))}
      <MenuDivider />
    </>)}
    {ctxMenu.tab === 'sent' && (<>
      <MenuItem onClick={() => { onWoAction && onWoAction(ctxMenu.woId, 'backToActive'); closeCtx(); }}>Move back to Active</MenuItem>
      <MenuDivider />
    </>)}
    {ctxMenu.tab === 'invoiced' && (<>
      <MenuItem onClick={() => { onWoAction && onWoAction(ctxMenu.woId, 'backToSent'); closeCtx(); }}>Move back to Sent to invoice</MenuItem>
      <MenuDivider />
    </>)}
    <MenuItem onClick={() => { onSelectWO(ctxMenu.woId); closeCtx(); }}>Open</MenuItem>
    {ctxMenu.tab !== 'trash' && (<>
      <MenuDivider />
      <MenuItem danger onClick={() => { onWoAction && onWoAction(ctxMenu.woId, 'softDelete'); closeCtx(); }}>Send to Trash</MenuItem>
    </>)}
  </div>
)}
```
The move actions mirror the destinations already offered in the detail-pane three-dot menu (`DetailOverflow`, `index.html:2079-2089`): `sent` rows offer "Move back to Active", `invoiced` rows offer "Move back to Sent to invoice". `paid` rows (`backToInvoiced`, `index.html:2090-2091`) and `trash` rows can be added the same way if the user wants parity later; not requested now.

Position clamping: if the menu would overflow the right/bottom edge of the window, clamp `x`/`y` before setting state. Check `window.innerWidth - x < 220` and `window.innerHeight - y < estimated_height` and adjust. Use a rough estimated menu height (status list can be long: estimate `60 + statuses.length * 30` px for active-tab menus).

### Deferred: "Add to custom filter" (depends on roadmap line 15)
ROADMAP.md line 15 ("FEATURE: Introduce the custom filters and pages in the left panel...") is NOT yet implemented; there is no custom-filter/saved-view membership model to attach a WO to today. Saved views currently exist as query+filter+sort presets (see `addPreset`/`activePreset`, search `addPreset` in index.html), not as explicit WO-membership lists. So an "Add to filter" action has no backing store yet.
Do NOT build this in Change #2. When line 15 is implemented and a per-filter WO-membership concept exists, add an "Add to filter ▸" submenu here that lists user filters and calls a new `woAction(id, 'addToFilter', filterId)`. Leave a one-line `// TODO(line 15): Add to custom filter submenu` comment at this spot so the future implementer finds it.

Commit alone. Live-test: right-click an active-tab row -> status list + Open + Send to Trash; pick a status, toast fires, menu closes. Right-click a `sent` row -> "Move back to Active". Right-click an `invoiced` row -> "Move back to Sent to invoice". Right-click empty space or press Escape -> menu dismisses. Right-click a different row while open -> menu repositions.

---

## File map (verified, current HEAD 0935f22)
- `index.html:1684` ListPane (scroll container `:1855`; ListRow render `:1880-1892`; ListRow signature `:1934`).
- `index.html:2018` DetailOverflow (existing status sub-menu `:2096-2102`).
- `index.html:2117` DetailPane (StatusPill at `:2173`; statuses prop).
- `index.html:4557` detailAction (setStatus case `:4562`).
- `index.html:3890` statuses derivation; `:4720` passed to DetailPane; `:4755` ListPane call site.
- `MenuCaption`, `MenuItem`, `MenuDivider` components: already defined, used in DetailOverflow/SortDropdown — reuse as-is.
- `DEFAULT_STATUSES`: already imported/defined — use as fallback same as existing code.

## Notes / gotchas
- Order store `%APPDATA%\work-order-tracker\wo-data.json` (parse twice via `wo_data` key).
- The installed app at `%LOCALAPPDATA%\Programs\Work Order Tracker\resources\` is a SEPARATE frozen copy; edits here do not touch it. Test only via `npm start`.
- Prior work on this branch (do not disturb): all FIX items, sort keys, lastNoteTs bug fix, Status (reverse) lock, direction toggle, scroll fix is new.
