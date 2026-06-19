/model claude-sonnet-4-6



PHASE 9 — Complete the Workflow editor (PMs, Types, Techs, status-to-phase mapping, phase colors)



Single file: index.html

All edits use the Edit tool against the same path you've been touching. No emojis or em-dashes in any string you add. No mid-task chat. Read the relevant ranges before each edit.



Background: Phase 8 added editable Phases + a basic StatusesEditor (rename, color, delete, add). Three gaps remain in Settings > Workflow:

&#x20; A. StatusesEditor doesn't propagate renames/deletes into each phase's statuses\[] array, and there's no UI to reassign a status to a different phase. Result: phase grouping breaks when a status is renamed.

&#x20; B. WorkflowSection has no phase color picker. New phases land on var(--text-3) with no way to change.

&#x20; C. PMs / Types / Techs have no editor UI at all. Phase 8 removed the "Manage PMs..." and "Manage techs..." buttons.



Additionally, PM chip rendering currently reads TT\_PM (a hard-coded constant) instead of data.pms. The editor is cosmetic until that's rewired. Same risk applies to types/techs filter dropdowns if they read from DEFAULT\_\* constants instead of data.



================================================================

TASK 0 — Verify consumers (read-only investigation, no edits)

================================================================



Before editing, grep for these and report (in your final summary, not mid-task) which file regions consume each constant:

&#x20; - TT\_PM

&#x20; - DEFAULT\_PMS

&#x20; - DEFAULT\_TYPES

&#x20; - DEFAULT\_TECHS



You need this to know which consumers to rewire in Task 5. Do NOT skip this step.



================================================================

TASK 1 — Phase color picker

================================================================



In WorkflowSection (the editable one added in Phase 8), add a color swatch BETWEEN the up/down stack and the phase name. Replace the existing read-only color dot:



&#x20; <span style={{ width: 10, height: 10, borderRadius: 5, background: p.fg, flexShrink: 0 }} />



with a clickable color input:



&#x20; <input

&#x20;   type="color"

&#x20;   value={normalizeHex(p.fg)}

&#x20;   onChange={e => setPhaseColor(uid, e.target.value)}

&#x20;   style={{ width: 22, height: 22, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent', flexShrink: 0 }}

&#x20;   title="Phase color"

&#x20; />



Add a helper above WorkflowSection (alongside miniBtnStyle):



&#x20; function normalizeHex(c) {

&#x20;   if (typeof c !== 'string') return '#888888';

&#x20;   if (c.startsWith('#') \&\& c.length === 7) return c;

&#x20;   // CSS var or oklch fallback — return a neutral so input doesn't error

&#x20;   return '#888888';

&#x20; }



Add setPhaseColor inside WorkflowSection (next to addPhase, moveUp, etc.):



&#x20; const setPhaseColor = (targetId, hex) => {

&#x20;   setPhases(phases.map(p => (p.id || p.name) === targetId

&#x20;     ? { ...p, fg: hex, bg: hexToRgba(hex, 0.18) }

&#x20;     : p));

&#x20; };



hexToRgba already exists at top of file (line \~167) so just call it.



Default newly added phase color: in addPhase, change the literal:



&#x20; setPhases(\[...phases, { id, name: 'New phase', fg: 'var(--text-3)', bg: 'var(--bg-surface-2)', statuses: \[] }]);



to:



&#x20; setPhases(\[...phases, { id, name: 'New phase', fg: '#6b7280', bg: hexToRgba('#6b7280', 0.18), statuses: \[] }]);



================================================================

TASK 2 — Status-to-phase mapping + rename/delete propagation

================================================================



Extend StatusesEditor signature to also accept phases + setPhases:



&#x20; function StatusesEditor({ statuses, setStatuses, statusColors, setStatusColors, phases, setPhases, onClose }) {



Fix commitRename to also update phase membership:



&#x20; const commitRename = (idx) => {

&#x20;   const trimmed = editingName.trim();

&#x20;   if (trimmed \&\& trimmed !== statuses\[idx]) {

&#x20;     const oldName = statuses\[idx];

&#x20;     const next = \[...statuses];

&#x20;     next\[idx] = trimmed;

&#x20;     setStatuses(next);

&#x20;     const sc = { ...statusColors };

&#x20;     if (sc\[oldName] !== undefined) { sc\[trimmed] = sc\[oldName]; delete sc\[oldName]; }

&#x20;     setStatusColors(sc);

&#x20;     // Propagate rename into every phase's statuses\[] array.

&#x20;     setPhases(phases.map(p => ({

&#x20;       ...p,

&#x20;       statuses: (p.statuses || \[]).map(s => s === oldName ? trimmed : s),

&#x20;     })));

&#x20;   }

&#x20;   setEditingIdx(null);

&#x20; };



Fix deleteStatus to remove from phases too:



&#x20; const deleteStatus = (idx) => {

&#x20;   if (!window.confirm('Remove this status?')) return;

&#x20;   const name = statuses\[idx];

&#x20;   setStatuses(statuses.filter((\_, i) => i !== idx));

&#x20;   const sc = { ...statusColors };

&#x20;   delete sc\[name];

&#x20;   setStatusColors(sc);

&#x20;   setPhases(phases.map(p => ({

&#x20;     ...p,

&#x20;     statuses: (p.statuses || \[]).filter(s => s !== name),

&#x20;   })));

&#x20; };



Add a phase-assignment helper:



&#x20; const phaseOf = (status) => {

&#x20;   const p = phases.find(ph => (ph.statuses || \[]).includes(status));

&#x20;   return p ? (p.id || p.name) : '';

&#x20; };



&#x20; const assignStatusToPhase = (status, targetPid) => {

&#x20;   setPhases(phases.map(p => {

&#x20;     const uid = p.id || p.name;

&#x20;     const without = (p.statuses || \[]).filter(s => s !== status);

&#x20;     if (uid === targetPid) return { ...p, statuses: \[...without, status] };

&#x20;     return { ...p, statuses: without };

&#x20;   }));

&#x20; };



Inside the per-status row (just before the delete button), add a phase dropdown:



&#x20; <select

&#x20;   value={phaseOf(s)}

&#x20;   onChange={e => assignStatusToPhase(s, e.target.value)}

&#x20;   style={{

&#x20;     height: 26, padding: '0 6px',

&#x20;     border: '1px solid var(--border-2)', borderRadius: 4,

&#x20;     background: 'var(--bg-surface)', color: 'var(--text-1)',

&#x20;     fontFamily: 'inherit', fontSize: 12,

&#x20;   }}

&#x20; >

&#x20;   <option value="">(unassigned)</option>

&#x20;   {phases.map(p => {

&#x20;     const uid = p.id || p.name;

&#x20;     return <option key={uid} value={uid}>{p.name}</option>;

&#x20;   })}

&#x20; </select>



Forward phases + setPhases from WorkflowSection to StatusesEditor (the JSX that renders it):



&#x20; <StatusesEditor

&#x20;   statuses={statuses}

&#x20;   setStatuses={setStatuses}

&#x20;   statusColors={statusColors}

&#x20;   setStatusColors={setStatusColors}

&#x20;   phases={phases}

&#x20;   setPhases={setPhases}

&#x20;   onClose={() => setStatusesOpen(false)}

&#x20; />



================================================================

TASK 3 — PMsEditor modal

================================================================



Add a new component AFTER StatusesEditor:



&#x20; function PMsEditor({ pms, setPms, onClose }) {

&#x20;   const \[editingIdx, setEditingIdx] = React.useState(null);

&#x20;   const \[editingName, setEditingName] = React.useState('');

&#x20;   const \[newName, setNewName] = React.useState('');



&#x20;   const commitRename = (idx) => {

&#x20;     const trimmed = editingName.trim();

&#x20;     if (trimmed) {

&#x20;       const next = \[...pms];

&#x20;       next\[idx] = { ...next\[idx], name: trimmed };

&#x20;       setPms(next);

&#x20;     }

&#x20;     setEditingIdx(null);

&#x20;   };



&#x20;   const deletePM = (idx) => {

&#x20;     if (!window.confirm('Remove this PM?')) return;

&#x20;     setPms(pms.filter((\_, i) => i !== idx));

&#x20;   };



&#x20;   const addPM = () => {

&#x20;     const n = newName.trim();

&#x20;     if (!n) return;

&#x20;     setPms(\[...pms, { name: n, color: '#6b7280' }]);

&#x20;     setNewName('');

&#x20;   };



&#x20;   const setColor = (idx, hex) => {

&#x20;     const next = \[...pms];

&#x20;     next\[idx] = { ...next\[idx], color: hex };

&#x20;     setPms(next);

&#x20;   };



&#x20;   return (

&#x20;     <div

&#x20;       style={{

&#x20;         position: 'fixed', inset: 0, zIndex: 400,

&#x20;         background: 'rgba(0,0,0,0.55)',

&#x20;         display: 'flex', alignItems: 'center', justifyContent: 'center',

&#x20;       }}

&#x20;       onClick={onClose}

&#x20;     >

&#x20;       <div onClick={e => e.stopPropagation()} style={{

&#x20;         width: 520, maxHeight: '80vh',

&#x20;         background: 'var(--bg-surface)',

&#x20;         border: '1px solid var(--border-1)',

&#x20;         borderRadius: 12, overflow: 'hidden',

&#x20;         display: 'flex', flexDirection: 'column',

&#x20;         boxShadow: '0 24px 60px rgba(0,0,0,0.45)',

&#x20;         color: 'var(--text-1)',

&#x20;       }}>

&#x20;         <div style={{

&#x20;           padding: '16px 22px', borderBottom: '1px solid var(--border-1)',

&#x20;           display: 'flex', alignItems: 'center', justifyContent: 'space-between',

&#x20;         }}>

&#x20;           <div style={{ fontSize: 16, fontWeight: 600 }}>Manage PMs</div>

&#x20;           <button onClick={onClose} style={{

&#x20;             background: 'transparent', border: 'none', cursor: 'pointer',

&#x20;             color: 'var(--text-3)', fontSize: 18, padding: 4,

&#x20;           }}>{'\\u2715'}</button>

&#x20;         </div>

&#x20;         <div style={{ padding: '14px 22px', overflowY: 'auto', flex: 1 }}>

&#x20;           {pms.map((pm, idx) => (

&#x20;             <div key={idx} style={{

&#x20;               display: 'flex', alignItems: 'center', gap: 10,

&#x20;               padding: '8px 0', borderBottom: '1px solid var(--border-1)',

&#x20;             }}>

&#x20;               <input

&#x20;                 type="color"

&#x20;                 value={pm.color || '#6b7280'}

&#x20;                 onChange={e => setColor(idx, e.target.value)}

&#x20;                 style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}

&#x20;                 title="PM color"

&#x20;               />

&#x20;               {editingIdx === idx

&#x20;                 ? <input

&#x20;                     autoFocus

&#x20;                     value={editingName}

&#x20;                     onChange={e => setEditingName(e.target.value)}

&#x20;                     onBlur={() => commitRename(idx)}

&#x20;                     onKeyDown={e => { if (e.key === 'Enter') commitRename(idx); if (e.key === 'Escape') setEditingIdx(null); }}

&#x20;                     style={{

&#x20;                       flex: 1, fontSize: 14,

&#x20;                       background: 'var(--bg-canvas)', border: '1px solid var(--accent)',

&#x20;                       borderRadius: 4, padding: '3px 8px', color: 'var(--text-1)', fontFamily: 'inherit',

&#x20;                     }}

&#x20;                   />

&#x20;                 : <span

&#x20;                     onDoubleClick={() => { setEditingIdx(idx); setEditingName(pm.name); }}

&#x20;                     title="Double-click to rename"

&#x20;                     style={{ flex: 1, fontSize: 14, cursor: 'text' }}

&#x20;                   >{pm.name}</span>

&#x20;               }

&#x20;               <button

&#x20;                 onClick={() => deletePM(idx)}

&#x20;                 style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 7px' }}

&#x20;               >{'\\u2715'}</button>

&#x20;             </div>

&#x20;           ))}

&#x20;           <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>

&#x20;             <input

&#x20;               value={newName}

&#x20;               onChange={e => setNewName(e.target.value)}

&#x20;               onKeyDown={e => { if (e.key === 'Enter') addPM(); }}

&#x20;               placeholder="New PM name or initials"

&#x20;               style={{

&#x20;                 flex: 1, padding: '7px 10px',

&#x20;                 border: '1px solid var(--border-2)', borderRadius: 6,

&#x20;                 background: 'var(--bg-canvas)', color: 'var(--text-1)',

&#x20;                 fontFamily: 'inherit', fontSize: 13,

&#x20;               }}

&#x20;             />

&#x20;             <ActionBtn primary onClick={addPM}>Add</ActionBtn>

&#x20;           </div>

&#x20;         </div>

&#x20;       </div>

&#x20;     </div>

&#x20;   );

&#x20; }



================================================================

TASK 4 — TypesEditor and TechsEditor (string-list variants)

================================================================



These two are simpler — strings, no color. Add a single shared component AFTER PMsEditor:



&#x20; function SimpleListEditor({ title, placeholder, items, setItems, onClose }) {

&#x20;   const \[editingIdx, setEditingIdx] = React.useState(null);

&#x20;   const \[editingName, setEditingName] = React.useState('');

&#x20;   const \[newName, setNewName] = React.useState('');



&#x20;   const commitRename = (idx) => {

&#x20;     const trimmed = editingName.trim();

&#x20;     if (trimmed \&\& trimmed !== items\[idx]) {

&#x20;       const next = \[...items];

&#x20;       next\[idx] = trimmed;

&#x20;       setItems(next);

&#x20;     }

&#x20;     setEditingIdx(null);

&#x20;   };



&#x20;   const deleteItem = (idx) => {

&#x20;     if (!window.confirm('Remove this entry?')) return;

&#x20;     setItems(items.filter((\_, i) => i !== idx));

&#x20;   };



&#x20;   const addItem = () => {

&#x20;     const n = newName.trim();

&#x20;     if (!n) return;

&#x20;     setItems(\[...items, n]);

&#x20;     setNewName('');

&#x20;   };



&#x20;   return (

&#x20;     <div

&#x20;       style={{

&#x20;         position: 'fixed', inset: 0, zIndex: 400,

&#x20;         background: 'rgba(0,0,0,0.55)',

&#x20;         display: 'flex', alignItems: 'center', justifyContent: 'center',

&#x20;       }}

&#x20;       onClick={onClose}

&#x20;     >

&#x20;       <div onClick={e => e.stopPropagation()} style={{

&#x20;         width: 480, maxHeight: '80vh',

&#x20;         background: 'var(--bg-surface)',

&#x20;         border: '1px solid var(--border-1)',

&#x20;         borderRadius: 12, overflow: 'hidden',

&#x20;         display: 'flex', flexDirection: 'column',

&#x20;         boxShadow: '0 24px 60px rgba(0,0,0,0.45)',

&#x20;         color: 'var(--text-1)',

&#x20;       }}>

&#x20;         <div style={{

&#x20;           padding: '16px 22px', borderBottom: '1px solid var(--border-1)',

&#x20;           display: 'flex', alignItems: 'center', justifyContent: 'space-between',

&#x20;         }}>

&#x20;           <div style={{ fontSize: 16, fontWeight: 600 }}>{title}</div>

&#x20;           <button onClick={onClose} style={{

&#x20;             background: 'transparent', border: 'none', cursor: 'pointer',

&#x20;             color: 'var(--text-3)', fontSize: 18, padding: 4,

&#x20;           }}>{'\\u2715'}</button>

&#x20;         </div>

&#x20;         <div style={{ padding: '14px 22px', overflowY: 'auto', flex: 1 }}>

&#x20;           {items.map((s, idx) => (

&#x20;             <div key={idx} style={{

&#x20;               display: 'flex', alignItems: 'center', gap: 10,

&#x20;               padding: '8px 0', borderBottom: '1px solid var(--border-1)',

&#x20;             }}>

&#x20;               {editingIdx === idx

&#x20;                 ? <input

&#x20;                     autoFocus

&#x20;                     value={editingName}

&#x20;                     onChange={e => setEditingName(e.target.value)}

&#x20;                     onBlur={() => commitRename(idx)}

&#x20;                     onKeyDown={e => { if (e.key === 'Enter') commitRename(idx); if (e.key === 'Escape') setEditingIdx(null); }}

&#x20;                     style={{

&#x20;                       flex: 1, fontSize: 14,

&#x20;                       background: 'var(--bg-canvas)', border: '1px solid var(--accent)',

&#x20;                       borderRadius: 4, padding: '3px 8px', color: 'var(--text-1)', fontFamily: 'inherit',

&#x20;                     }}

&#x20;                   />

&#x20;                 : <span

&#x20;                     onDoubleClick={() => { setEditingIdx(idx); setEditingName(s); }}

&#x20;                     title="Double-click to rename"

&#x20;                     style={{ flex: 1, fontSize: 14, cursor: 'text' }}

&#x20;                   >{s}</span>

&#x20;               }

&#x20;               <button

&#x20;                 onClick={() => deleteItem(idx)}

&#x20;                 style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 7px' }}

&#x20;               >{'\\u2715'}</button>

&#x20;             </div>

&#x20;           ))}

&#x20;           <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>

&#x20;             <input

&#x20;               value={newName}

&#x20;               onChange={e => setNewName(e.target.value)}

&#x20;               onKeyDown={e => { if (e.key === 'Enter') addItem(); }}

&#x20;               placeholder={placeholder}

&#x20;               style={{

&#x20;                 flex: 1, padding: '7px 10px',

&#x20;                 border: '1px solid var(--border-2)', borderRadius: 6,

&#x20;                 background: 'var(--bg-canvas)', color: 'var(--text-1)',

&#x20;                 fontFamily: 'inherit', fontSize: 13,

&#x20;               }}

&#x20;             />

&#x20;             <ActionBtn primary onClick={addItem}>Add</ActionBtn>

&#x20;           </div>

&#x20;         </div>

&#x20;       </div>

&#x20;     </div>

&#x20;   );

&#x20; }



================================================================

TASK 5 — Wire pms/types/techs through App and WorkflowSection

================================================================



5a. In App, after setStatusColors (around line \~2969), add three derived values and three setters:



&#x20; const pms = (data?.pms \&\& data.pms.length) ? data.pms : DEFAULT\_PMS;

&#x20; const setPms = React.useCallback((p) => updateData({ pms: p }), \[updateData]);

&#x20; const types = (data?.types \&\& data.types.length) ? data.types : DEFAULT\_TYPES;

&#x20; const setTypes = React.useCallback((t) => updateData({ types: t }), \[updateData]);

&#x20; const techs = (data?.techs \&\& data.techs.length) ? data.techs : DEFAULT\_TECHS;

&#x20; const setTechs = React.useCallback((t) => updateData({ techs: t }), \[updateData]);



5b. SettingsDrawer signature — add pms, setPms, types, setTypes, techs, setTechs to the destructured props. Forward all six to WorkflowSection in the section==='workflow' dispatch line.



5c. WorkflowSection signature — accept pms, setPms, types, setTypes, techs, setTechs.



5d. Add three local state booleans inside WorkflowSection alongside statusesOpen:



&#x20; const \[pmsOpen, setPmsOpen] = React.useState(false);

&#x20; const \[typesOpen, setTypesOpen] = React.useState(false);

&#x20; const \[techsOpen, setTechsOpen] = React.useState(false);



5e. In WorkflowSection's button row (currently just "+ Add phase" and "Manage statuses..."), add three more buttons:



&#x20; <ActionBtn onClick={() => setPmsOpen(true)}>Manage PMs...</ActionBtn>

&#x20; <ActionBtn onClick={() => setTypesOpen(true)}>Manage types...</ActionBtn>

&#x20; <ActionBtn onClick={() => setTechsOpen(true)}>Manage techs...</ActionBtn>



5f. At the bottom of WorkflowSection, render the modals conditionally (after the existing {statusesOpen \&\& <StatusesEditor ... />} block):



&#x20; {pmsOpen \&\& (

&#x20;   <PMsEditor pms={pms} setPms={setPms} onClose={() => setPmsOpen(false)} />

&#x20; )}

&#x20; {typesOpen \&\& (

&#x20;   <SimpleListEditor

&#x20;     title="Manage types"

&#x20;     placeholder="New type name"

&#x20;     items={types}

&#x20;     setItems={setTypes}

&#x20;     onClose={() => setTypesOpen(false)}

&#x20;   />

&#x20; )}

&#x20; {techsOpen \&\& (

&#x20;   <SimpleListEditor

&#x20;     title="Manage techs"

&#x20;     placeholder="New tech name"

&#x20;     items={techs}

&#x20;     setItems={setTechs}

&#x20;     onClose={() => setTechsOpen(false)}

&#x20;   />

&#x20; )}



5g. App's <SettingsDrawer ... /> JSX — add the six new props alongside the existing setPhases/setStatuses/etc.:



&#x20; pms={pms}

&#x20; setPms={setPms}

&#x20; types={types}

&#x20; setTypes={setTypes}

&#x20; techs={techs}

&#x20; setTechs={setTechs}



================================================================

TASK 6 — Rewire PM chip rendering to read from data.pms

================================================================



In Task 0 you grepped for TT\_PM. The PM chip currently reads colors from that constant, which means edits in PMsEditor are cosmetic. Fix it:



&#x20; - Find the component that renders the PM chip (likely in ListRow or a PMChip subcomponent).

&#x20; - Replace any `TT\_PM\[name]` lookup with a lookup against `data.pms` passed through context or props.



Simplest mechanism: create a PMsContext at the top of the file (next to PhasesContext):



&#x20; const PMsContext = React.createContext(DEFAULT\_PMS);

&#x20; function usePMs() { return React.useContext(PMsContext); }



In the chip render site, call usePMs(), find the entry by name, and use its color. Derive a soft bg via hexToRgba(color, 0.18).



In App's return JSX, wrap the existing providers with PMsContext.Provider:



&#x20; <PMsContext.Provider value={pms}>

&#x20;   <PhasesContext.Provider value={phases}>

&#x20;     ...



If the chip's existing render reads TT\_PM\[name] and falls back to a default, preserve the fallback shape:



&#x20; const pmsList = usePMs();

&#x20; const entry = pmsList.find(p => p.name === name);

&#x20; const color = entry?.color || '#6b7280';

&#x20; const fg = color;

&#x20; const bg = hexToRgba(color, 0.18);



If TT\_PM is referenced in MORE than one place, do all of them. Leave TT\_PM in place at the top of the file (harmless dead constant) unless removing it is a one-line change.



================================================================

RISK NOTE — Types/Techs consumers

================================================================



DEFAULT\_TYPES and DEFAULT\_TECHS are likely referenced by the WOForm dropdowns and the filter dropdowns in ListPane. If those forms read from data.types / data.techs already (via the `data` prop), no rewire is needed. If they read from the DEFAULT\_\* constants directly, the editor is cosmetic for those fields too.



Verify in Task 0 grep results. If consumers read from DEFAULT\_\*, change them to prefer data.types / data.techs with the DEFAULT\_\* as fallback. Be surgical — do not refactor the WOForm beyond replacing the source array.



================================================================

DONE

================================================================



Perform this task as written. No mid-task chat. Read the relevant file ranges before each edit. When complete, summarize:

&#x20; - Which consumers were rewired (Task 0 + 6 + risk note)

&#x20; - Any TT\_PM/DEFAULT\_\* references you left in place and why

&#x20; - Any deviations from the spec

