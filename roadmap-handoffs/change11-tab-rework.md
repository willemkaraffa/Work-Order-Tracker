# CHANGE #11 — Tab/phase rework: deprecate Paid/Invoiced, add Complete, hardcode Cancelled

Scope: collapse the billing pipeline to a single Sent state living inside the Invoices module; eliminate Paid + Invoiced tabs (QuickBooks now tracks those); add a new Complete tab in the WO list module for tech-done WOs awaiting invoicing; hardcode a Cancelled status for everything in Trash; deprecate the per-phase `complete:true` flag (all phases are now active workflow); migrate existing data on load.

Repo: `C:\dev\Work-Order-Tracker`. App version 3.2.x.

## Rules (from CLAUDE.md — obey)
- Read files before editing.
- No emojis or em-dashes.
- Surgical edits matching existing style.
- Backup user data before migration.
- Verify migration logic with a code-trace before claiming done.

## Confirmed user decisions (do not re-litigate)

1. **Tab model**: `active`, `complete`, `sent`, `trash`. Sent is a tab BUT not shown in the WO list module — it only appears in the Invoices module.
2. **Phase configurability**: Phases stay user-editable in Settings for ACTIVE workflow. All phases are active (no more `complete:true` toggle).
3. **WO module pills**: `[Active, Complete, Trash]`. No Sent pill.
4. **Sidebar**: already trimmed to inboxes-only post-slice 3.4. No further change.
5. **Existing tab='paid' / tab='invoiced' WOs**: migrate to `tab='sent'` (re-queue into Invoices module).
6. **Existing tab='active' WOs with status in a phase that has `complete:true`**: migrate to `tab='complete'`.
7. **Existing WOs with status containing 'Cancel'**: leave status alone; ensure `deleted: true` so they land in Trash.
8. **Cancelled status hex**: `#6b7280` (mute gray, gray-500). Added to DEFAULT_STATUSES + DEFAULT_STATUS_COLORS.
9. **Complete tab entry trigger**: Auto via status change. Status `Pending-Complete` and `Closed` map to `tab='complete'` (auto-flip).
10. **Status reordering**: `Bid Approved - Complete` moves OUT of the 'approved' phase and to the END of the 'In progress' (`progress`) phase's status list. Per user, this status is "not really Complete yet on my end".
11. **softDelete**: sets `deleted: true` AND `status='Cancelled'`. Original status preserved in a new field `prevStatus` so Restore can put it back.
12. **Restore from trash**: sets `deleted: false` AND `status = prevStatus` (falls back to 'Open' if missing).
13. **Mark Invoiced / Mark Paid actions**: deleted everywhere (context menus, DetailPane button, bulk bar, nextAction map).
14. **Active tab "Send to Invoice"**: REMOVED. Active WOs cannot be invoiced. Active tab's primary action is `Mark Complete`.
15. **Complete tab "Send to Invoice"**: KEPT. Primary action on Complete tab DetailPane.
16. **Sent tab (Invoices module) actions**: `Reopen` (move back to Complete). Safety net for mistakes.
17. **Auto-unschedule**: when a WO moves to `tab='complete'` or `tab='trash'`, clear its `schedule` field.
18. **Aging buckets in Invoices module**: kept (useful for throughput). Use sent-date (days since the most recent 'sent to billing' history entry). No date color coding in the row itself.
19. **Invoices module bid total**: when `o.invoice` is null, show red text "No Bid!" if `o.bidAmount` is empty, otherwise show `o.bidAmount` as plain text. A sidebar summary tile sums all `o.bidAmount` values for sent WOs.
20. **Complete tab aging color coding**: Complete WOs get aging color (since not yet paid). Same chip palette as alerts.
21. **Overview throughput chart**: change series from "Created / Invoiced / Paid" to "Created / Dispatched / Completed". Dispatched = transition to scheduled (history action 'scheduled'); Completed = transition to tab='complete'.
22. **History entries**: stop emitting Sent→Invoiced and Invoiced→Paid transitions. Add `markComplete`, `sentToInvoice`, `reopen` history entries.
23. **backToInvoiced / backToSent context-menu items**: deleted.

## Open assumption (verify with user if wrong)

The status user calls "Enter Bid - Job Complete" is interpreted as the existing default status `Bid Approved - Complete`. This is the status that moves from the 'approved' phase to the end of the 'progress' phase. If wrong, the migration block in slice 1 must change.

## Data migration (one-shot, on next app load)

Guarded by a new `MIGRATION_VERSION = '3.0'` bump. Backup taken to storage key `wo_data_pre_change11_backup` before mutating.

For each WO:
```
if (o.tab === 'paid' || o.tab === 'invoiced') {
  o.tab = 'sent';
}
if (o.tab === 'active') {
  const phase = phaseForOrder(o, storedPhases);
  const p = storedPhases.find(x => x.name === phase);
  if (p && p.complete) {
    o.tab = 'complete';
  }
}
if (o.deleted && !o.status) o.status = 'Cancelled';
```

For stored phases:
```
phases = phases.map(p => {
  const next = { ...p };
  delete next.complete;
  return next;
});
// Move "Bid Approved - Complete" from 'approved' to end of 'progress'.
const approvedP = phases.find(p => p.id === 'approved');
const progressP = phases.find(p => p.id === 'progress');
if (approvedP && approvedP.statuses.includes('Bid Approved - Complete')) {
  approvedP.statuses = approvedP.statuses.filter(s => s !== 'Bid Approved - Complete');
}
if (progressP && !progressP.statuses.includes('Bid Approved - Complete')) {
  progressP.statuses.push('Bid Approved - Complete');
}
```

For stored statuses:
```
if (!statuses.includes('Cancelled')) statuses.push('Cancelled');
```

For stored statusColors:
```
if (!statusColors['Cancelled']) statusColors['Cancelled'] = '#6b7280';
```

## Slice plan

1. **Constants + migration**
   - DEFAULT_STATUSES: append 'Cancelled'.
   - DEFAULT_STATUS_COLORS: add Cancelled → `#6b7280`.
   - DEFAULT_PHASES: drop `complete: true` flag from wrap/done/billing; move 'Bid Approved - Complete' to end of progress; KEEP wrap/done/billing as ACTIVE phases (they exist so user can categorize workflow stages, but no longer auto-flip tab).
   - MIGRATION_VERSION bump.
   - Migration block on data load: backup + transform per above.

2. **Tab + handler logic**
   - WO_TAB_VIEWS: `[Active, Complete, Trash]`.
   - phaseForOrder: keep for active WOs; treat sent/complete/trash as own buckets.
   - sendToInvoice: gate to `tab === 'complete'`. Sets `tab='sent'`. Auto-unschedule.
   - markComplete: NEW handler. Sets `tab='complete'`. Auto-unschedule.
   - reopen: NEW handler. From sent → complete, from complete → active.
   - softDelete: set `tab='trash'` (or leave as-is and rely on `deleted:true`?) + `prevStatus = current status` + `status = 'Cancelled'` + `deleted = true`. Auto-unschedule.
   - restore: `deleted = false`, `status = prevStatus || 'Open'`, clear `prevStatus`.
   - DELETE: markInvoiced, markPaid, backToInvoiced, backToSent, bulk actions referencing them.
   - Auto-tab-flip on status change: if new status is `Pending-Complete` or `Closed`, also set `tab='complete'`.

3. **DetailPane rework**
   - nextAction map: `active → Mark Complete`, `complete → Send to Invoice`, `sent → Reopen`, others → none.
   - nextActionKind: dispatch the new handlers.
   - Remove "Mark Paid" / "Mark Invoiced" cases from `handlePrimary`.
   - ageDays display: drop sent/invoiced branches; ADD complete display (`Nd in completion queue`) with aging color.
   - Status pill rendering: keep hidden for sent (Invoices module shows it); show for complete + active + trash (with Cancelled red-gray).

4. **Context menus** (ListPane, DetailPane, ItineraryModule)
   - Tab='active': add "Mark Complete" item; remove "Send to Invoice".
   - Tab='complete' (NEW menu set): "Send to Invoice", "Reopen → Active", "Send to Trash".
   - Tab='sent' (in Invoices DetailPane only): "Reopen → Complete", "Send to Trash".
   - REMOVE: "Mark Invoiced", "Mark Paid", "Move back to Sent", "Move back to Active" (replaced by Reopen).

5. **Sidebar counts**
   - Drop sent/invoiced/paid count fields.
   - Add `complete` count.
   - Tray badge logic: include complete in attention-source choices.

6. **InvoicesModule rework**
   - Drop section split (no more Invoiced section).
   - Drop status filter pills in sidebar (only Sent exists).
   - Aging buckets stay; based on sent-date (`ageDaysFor` sent branch).
   - Add "Bid totals" tile in sidebar showing sum of `o.bidAmount` across all sent WOs.
   - Row "Total" column: if invoice → grandTotal. Else if bidAmount → bidAmount plain. Else red "No Bid!".
   - selectedId scroll-into-view stays.

7. **Overview throughput chart**
   - Compute Created (from `dateCreated`), Dispatched (history action includes 'scheduled'), Completed (history action includes 'markComplete' OR tab transition to complete).
   - Update bucket legend labels.

8. **ageDaysFor rework**
   - Drop tab='paid' (returns null) and tab='sent'/'invoiced' branches.
   - Add tab='complete' branch: days since most recent 'markComplete' or status change to a completing status.
   - Keep tab='sent' calc for aging buckets in Invoices module ONLY (factor into a helper inside InvoicesModule rather than the global ageDaysFor).

9. **Sent tab UI presence**
   - Verify `data?.tab === 'sent'` rendering is only invoked via Invoices module's DetailPane (i.e. when user clicks a row in Invoices, the editor opens — separate from the WO module DetailPane). Confirm InvoicesModule never selects into the WO module DetailPane.

10. **Cleanup**
    - Remove dead helpers, unused constants, dead context-menu branches.
    - Smoke-test all migration paths via static-trace.

## Risks

- **Migration data loss**: backup MUST happen before first mutation. Use `wo_data_pre_change11_backup` key. Verify via Settings → Restore backup row.
- **Stale phase data with complete flag**: if migration ran but stored phases still have `complete:true`, sent/complete tab logic would double-fire. Migration removes flag and bumps MIGRATION_VERSION so it only runs once.
- **Sent WOs without bidAmount**: appear in Invoices module with red "No Bid!" — user might import a batch where bidAmount is missing. Risk: many red rows on first run. Mitigation: this is informational; doesn't block.
- **'Bid Approved - Complete' rename ambiguity**: confirmed user calls it informally "Enter Bid - Job Complete". If wrong, slice 1 needs adjustment.
- **Itinerary**: change filter to `tab === 'active'` (currently uses `phase.complete` exclusion). Verify Complete tab WOs disappear from itinerary.
- **Tray badge**: currently chooses source from `attention/active/sent/invoiced/paid`. Drop the sent/invoiced/paid options; add `complete`. Existing user setting may name a removed source — fall back to `attention`.

## Test plan

After each slice ends:
- Slice 1: launch app, confirm backup written, data file shows transformed tabs/phases, no errors.
- Slice 2: right-click an Active WO → menu shows "Mark Complete", not "Send to Invoice". Mark it → tab flips to complete + schedule cleared. Right-click → "Send to Invoice" → tab='sent'.
- Slice 3: DetailPane primary button shows correct label per tab. Click flows through correct handler.
- Slice 4: Context menus on each tab show only valid actions.
- Slice 5: Sidebar counts add up. Tray badge correct.
- Slice 6: Invoices module shows only Sent list. Aging filters work. Bid totals tile sums correctly. Red "No Bid!" shows on WO with empty bidAmount.
- Slice 7: Overview throughput shows new series. Manually mark a WO complete, confirm bucket increments.
- Slice 8: ageDays on Complete tab DetailPane shows "Nd in completion queue" with aging color.
