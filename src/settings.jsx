// Settings drawer + section editors, carved out of app.jsx. Shared helpers
// import from app.jsx (live-binding cycle, eval-safe). App renders SettingsDrawer.
import React from 'react';
import {
  APP_VERSION, EDITABLE_THEME_VARS, DEFAULT_MORE_INFO_COLOR, LOCKED_STATUSES,
  SYSTEM_TAGS, SYSTEM_TAG_LABELS, TYPE_COLORS, DEFAULT_MAP_MARKER_COLORS, normalizeHex, acronymOf,
} from './constants.js';
import {
  SettingTitle, SettingRow, Seg, ActionBtn, InlineEdit, miniBtnStyle, ReorderBtns, swapAt,
} from './primitives.jsx';
import {
  TT_LIGHT, TT_DARK, GambleMark, DEFAULT_OVERDUE_CFG, DEFAULT_ROUTING_WEIGHTS,
  DEFAULT_ALERT_THRESHOLDS, US_STATE_NAMES, updateStatusText, LibraryToolsSection,
} from './app.jsx';

const TT_SECTIONS = [
  { id: 'appearance',  label: 'Appearance' },
  { id: 'workflow',    label: 'Workflow' },
  { id: 'trades',      label: 'Tech Job Types' },
  { id: 'routing',     label: 'Routing' },
  { id: 'library',     label: 'Service Library' },
  { id: 'credentials', label: 'Credentials' },
  { id: 'apikeys',     label: 'API Keys' },
  { id: 'maps',        label: 'Maps' },
  { id: 'alerts',      label: 'Alerts' },
  { id: 'tray',        label: 'Tray' },
  { id: 'about',       label: 'About' },
];

export function SettingsDrawer({ onClose, toast, theme, setTheme, density, setDensity, clearSearchKey, setClearSearchKey, alertThresholds, setAlertThresholds, overdueCfg, setOverdueCfg, librarySubCats, setLibrarySubCats, techJobTypes, setTechJobTypes, techColors, setTechColors, routingWeights, setRoutingWeights, statusTags, setStatusTags, phases, setPhases, statuses, setStatuses, statusColors, setStatusColors, moreInfoColor, setMoreInfoColor, customTheme, setCustomTheme, mapsHomeState, mapsHomeZip, mapsHomeAddress, mapsHomeCity, saveHome, onClearGeocache, geocacheCount, locationIqKey, setLocationIqKey, mapMarkerColors, setMapMarkerColors, mapTypeColors, setMapTypeColors, pms, setPms, onRenameClientCode, types, setTypes, techs, setTechs, trayEnabled, setTrayEnabled, trayBadgeSource, setTrayBadgeSource, onResetSettings, onRestoreBackup, updateState, onCheckUpdate, onInstallUpdate, initialSection }) {
  const [section, setSection] = React.useState(initialSection || 'appearance');
  return (
    <section style={{
      minWidth: 0, minHeight: 0, height: '100%',
      display: 'grid',
      gridTemplateColumns: '180px 1fr',
      gridTemplateRows: '1fr',
      background: 'var(--bg-canvas)',
    }}>
      <nav style={{
        borderRight: '1px solid var(--border-1)',
        background: 'var(--bg-surface)',
        padding: '20px 12px',
        display: 'flex', flexDirection: 'column', gap: 2,
        minHeight: 0,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 600, color: 'var(--text-3)',
          padding: '0 10px 8px', letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}>Settings</div>
        {TT_SECTIONS.map(s => (
          <div
            key={s.id}
            onClick={() => setSection(s.id)}
            style={{
              padding: '6px 10px', borderRadius: 6,
              fontSize: 14,
              background: section === s.id ? 'var(--bg-row-sel)' : 'transparent',
              color: 'var(--text-1)',
              fontWeight: section === s.id ? 600 : 400,
              cursor: 'pointer',
            }}
          >{s.label}</div>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{
          flexShrink: 0,
          height: 32, padding: '0 12px',
          border: '1px solid var(--border-2)',
          background: 'var(--bg-surface)',
          color: 'var(--text-1)',
          borderRadius: 6, fontFamily: 'inherit', fontSize: 13, fontWeight: 600,
          cursor: 'pointer',
        }}>Close {'✕'}</button>
      </nav>

      {/* Scroller is full-bleed (no horizontal padding) so its scrollbar always
          rides the modal's right edge on every tab; the 28/32 padding lives on
          the inner wrapper, regardless of a section's own max-width/centering. */}
      <div style={{ overflow: 'auto', minHeight: 0 }}>
        <div style={{ padding: '28px 32px' }}>
        {section === 'appearance' && <AppearanceSection theme={theme} setTheme={setTheme} density={density} setDensity={setDensity} clearSearchKey={clearSearchKey} setClearSearchKey={setClearSearchKey} moreInfoColor={moreInfoColor} setMoreInfoColor={setMoreInfoColor} customTheme={customTheme} setCustomTheme={setCustomTheme} />}
        {section === 'workflow'   && <WorkflowSection phases={phases} setPhases={setPhases} statuses={statuses} setStatuses={setStatuses} statusColors={statusColors} setStatusColors={setStatusColors} statusTags={statusTags} setStatusTags={setStatusTags} pms={pms} setPms={setPms} onRenameClientCode={onRenameClientCode} />}
        {section === 'trades'     && <TradesSection types={types} setTypes={setTypes} mapTypeColors={mapTypeColors} setMapTypeColors={setMapTypeColors} techJobTypes={techJobTypes} setTechJobTypes={setTechJobTypes} techs={techs} setTechs={setTechs} techColors={techColors} setTechColors={setTechColors} />}
        {section === 'routing'    && <RoutingSection weights={routingWeights} setWeights={setRoutingWeights} />}
        {section === 'library'    && <LibraryToolsSection subCats={librarySubCats} setSubCats={setLibrarySubCats} toast={toast} />}
        {section === 'credentials' && <CredentialsSection />}
        {section === 'apikeys'    && <ApiKeysSection locationIqKey={locationIqKey} setLocationIqKey={setLocationIqKey} />}
        {section === 'maps'       && <MapsSection mapsHomeState={mapsHomeState} mapsHomeZip={mapsHomeZip} mapsHomeAddress={mapsHomeAddress} mapsHomeCity={mapsHomeCity} saveHome={saveHome} onClearGeocache={onClearGeocache} geocacheCount={geocacheCount} mapMarkerColors={mapMarkerColors} setMapMarkerColors={setMapMarkerColors} mapTypeColors={mapTypeColors} setMapTypeColors={setMapTypeColors} types={types} />}
        {section === 'alerts'     && <AlertsSection thresholds={alertThresholds} setThresholds={setAlertThresholds} overdueCfg={overdueCfg} setOverdueCfg={setOverdueCfg} />}
        {section === 'tray'       && <TraySection trayEnabled={trayEnabled} setTrayEnabled={setTrayEnabled} trayBadgeSource={trayBadgeSource} setTrayBadgeSource={setTrayBadgeSource} />}
        {section === 'about'      && <AboutSection onResetSettings={onResetSettings} onRestoreBackup={onRestoreBackup} updateState={updateState} onCheckUpdate={onCheckUpdate} onInstallUpdate={onInstallUpdate} />}
        </div>
      </div>
    </section>
  );
}

// Portal credentials for in-app capture. AMH only — its scraper (headless Edge,
// scrape_amh.py) logs in with these credentials, so they are REQUIRED for
// capture to work. MSR uses the Chrome extension (authenticated Chrome), so no
// credentials are stored here for it. Secrets are encrypted by the main process
// via safeStorage; this UI never persists them in plain wo_data.
function CredentialsSection() {
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [stored, setStored] = React.useState(false);
  const [status, setStatus] = React.useState('');
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (window.creds && window.creds.get) {
      window.creds.get('AMH').then(c => {
        if (c && c.username) { setUsername(c.username); setPassword(c.password || ''); setStored(true); }
      }).catch(() => {});
    }
  }, []);

  const save = async () => {
    if (!window.creds || !window.creds.set) { setStatus('Credentials are only available in the desktop app.'); return; }
    if (!username.trim() || !password) { setStatus('Enter both username and password.'); return; }
    const r = await window.creds.set('AMH', username.trim(), password);
    if (r && r.ok) { setStored(true); setStatus('Saved (encrypted).'); }
    else setStatus('Error: ' + ((r && r.error) || 'could not save.'));
  };
  const clear = async () => {
    if (window.creds && window.creds.clear) await window.creds.clear('AMH');
    setUsername(''); setPassword(''); setStored(false); setStatus('Cleared.');
  };

  const fld = {
    width: '100%', maxWidth: 360, padding: '8px 10px', marginTop: 4,
    border: '1px solid var(--border-2)', borderRadius: 6,
    background: 'var(--bg-surface)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 13,
  };
  const lbl = { fontSize: 12, color: 'var(--text-3)', display: 'block', marginTop: 12 };

  return (
    <div>
      <SettingTitle sub="Stored encrypted on this machine (safeStorage). Used to log in to the AMH portal during capture.">Credentials</SettingTitle>
      <div style={{ marginBottom: 14, padding: '10px 12px', border: '1px solid var(--border-1)', borderRadius: 6, background: 'var(--bg-surface)', fontSize: 12, color: 'var(--text-2)', lineHeight: 1.5 }}>
        AMH capture signs in to the portal with these credentials (headless Microsoft Edge). Enter your AMH username and password below — capture will fail without them.
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>AMH portal {stored && <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600 }}>· saved</span>}</div>
      <label style={lbl}>Username / email
        <input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" style={fld} />
      </label>
      <label style={lbl}>Password
        <input type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="off" style={fld} />
      </label>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-2)', marginTop: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Show password
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <ActionBtn primary onClick={save}>Save</ActionBtn>
        {stored && <ActionBtn onClick={clear}>Clear</ActionBtn>}
      </div>
      {status && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-2)' }}>{status}</div>}
      <div style={{ marginTop: 22, fontSize: 12, color: 'var(--text-3)', lineHeight: 1.6, maxWidth: 420 }}>
        MSR work orders import through the Chrome extension (your signed-in Chrome) and need no credentials here.
      </div>
    </div>
  );
}

// SettingTitle, SettingRow, Seg moved to ./primitives.jsx (imported at top).

function AppearanceSection({ theme, setTheme, density, setDensity, clearSearchKey, setClearSearchKey, moreInfoColor, setMoreInfoColor, customTheme, setCustomTheme }) {
  const baseTheme = theme === 'light' ? TT_LIGHT : TT_DARK;
  const ct = customTheme || {};
  const setVar = (key, hex) => setCustomTheme && setCustomTheme({ ...ct, [key]: hex });
  const clearVar = (key) => {
    if (!setCustomTheme) return;
    const next = { ...ct };
    delete next[key];
    setCustomTheme(next);
  };
  const resetAll = () => setCustomTheme && setCustomTheme({});
  const hasAnyOverride = Object.keys(ct).length > 0;
  const isDefaultMoreInfo = !moreInfoColor
    || (typeof moreInfoColor === 'string'
        && moreInfoColor.toLowerCase() === DEFAULT_MORE_INFO_COLOR.toLowerCase());
  const accent = moreInfoColor || DEFAULT_MORE_INFO_COLOR;
  const softBg = `color-mix(in srgb, ${accent} 14%, transparent)`;
  return (
    <div style={{ maxWidth: 720, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{
          fontFamily: "'Bricolage Grotesque', sans-serif",
          fontWeight: 700, fontSize: 26, letterSpacing: '-0.02em',
          color: 'var(--text-1)',
        }}>Appearance</div>
        <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-3)' }}>
          Theme, density, and detail-pane accent colors. Affects the whole app.
        </div>
      </div>

      <AppearanceGroup eyebrow="Theme">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Seg
            equal
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'dark',  label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'System' },
            ]}
          />
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Dark is the recommended default. System follows your OS appearance setting.
          </div>
        </div>
      </AppearanceGroup>

      <AppearanceGroup eyebrow="Layout density">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Seg
            equal
            value={density}
            onChange={setDensity}
            options={[
              { value: 'compact',  label: 'Compact' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'generous', label: 'Generous' },
            ]}
          />
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Tighter density fits more rows; generous is easier on the eyes.
          </div>
        </div>
      </AppearanceGroup>

      <AppearanceGroup eyebrow="Search clear key">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              readOnly
              value={clearSearchKey || 'Backspace'}
              onKeyDown={(e) => {
                e.preventDefault();
                if (e.key === 'Escape' || e.key === 'Tab') return;   // let the user leave without binding
                if (setClearSearchKey) setClearSearchKey(e.key);
                e.currentTarget.blur();
              }}
              title="Click, then press the key to bind"
              style={{
                width: 160, height: 32, padding: '0 10px', textAlign: 'center', borderRadius: 8,
                border: '1px solid var(--border-1)', background: 'var(--bg-canvas)', color: 'var(--text-1)',
                fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
              }}
            />
            <button onClick={() => setClearSearchKey && setClearSearchKey('Backspace')} style={{
              height: 32, padding: '0 12px', borderRadius: 7, border: '1px solid var(--border-1)',
              background: 'var(--bg-surface)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13, cursor: 'pointer',
            }}>Reset</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Click the box and press a key. When a list or module is focused (not a text field or dialog),
            typing jumps into the search bar and this key clears it. Default Backspace.
          </div>
        </div>
      </AppearanceGroup>

      <AppearanceGroup eyebrow="Detail pane accents">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-1)' }}>
            More Information card color
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: -8 }}>
            Accent strip + soft tint on the detail pane's More Information card. Pick something distinct from the blue pinned-note accent.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <input
              type="color"
              value={normalizeHex(accent)}
              onChange={e => setMoreInfoColor && setMoreInfoColor(e.target.value)}
              style={{ width: 36, height: 36, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
            />
            <code style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12, color: 'var(--text-2)',
              padding: '4px 8px', background: 'var(--bg-surface-2)',
              border: '1px solid var(--border-2)', borderRadius: 4,
            }}>{normalizeHex(accent).toUpperCase()}</code>
            {!isDefaultMoreInfo && (
              <button
                onClick={() => setMoreInfoColor && setMoreInfoColor(DEFAULT_MORE_INFO_COLOR)}
                style={{
                  fontFamily: 'inherit', fontSize: 12,
                  padding: '5px 12px',
                  background: 'var(--bg-surface-2)',
                  color: 'var(--text-2)',
                  border: '1px solid var(--border-2)',
                  borderRadius: 4, cursor: 'pointer',
                }}
              >Reset to default</button>
            )}
          </div>
          <div style={{
            marginTop: 4,
            border: '1px solid var(--border-2)',
            borderLeft: `3px solid ${accent}`,
            background: softBg,
            borderRadius: 8,
            padding: '12px 14px',
            maxWidth: 360,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <span style={{ fontSize: 11, color: 'var(--text-3)' }}>{'▾'}</span>
              <span style={{ fontWeight: 600, color: 'var(--text-1)' }}>More Information</span>
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-3)', fontStyle: 'italic' }}>
              Preview - matches the detail pane.
            </div>
          </div>
        </div>
      </AppearanceGroup>

      <AppearanceGroup eyebrow="Custom theme">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
            Override surface, text, and accent colors on top of the base {theme === 'light' ? 'Light' : theme === 'system' ? 'System' : 'Dark'} theme.
            Phase colors live in Settings → Workflow. Borders and semantic tints (age, flags) stay tied to the base.
          </div>
          {EDITABLE_THEME_VARS.map(group => (
            <div key={group.group} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--text-3)', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {group.group}
              </div>
              {group.items.map(item => {
                const overridden = item.key in ct;
                const effective = ct[item.key] || baseTheme[item.key] || '#000000';
                const swatch = normalizeHex(effective.startsWith('#') ? effective : '#888888');
                return (
                  <div key={item.key} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '6px 0',
                  }}>
                    <input
                      type="color"
                      value={swatch}
                      onChange={e => setVar(item.key, e.target.value)}
                      style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent', flexShrink: 0 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: overridden ? 600 : 500 }}>
                        {item.label} {overridden && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 4 }}>(custom)</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-3)' }}>{item.desc}</div>
                    </div>
                    <code style={{
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 11, color: 'var(--text-2)',
                      padding: '3px 6px', background: 'var(--bg-surface-2)',
                      border: '1px solid var(--border-2)', borderRadius: 4,
                    }}>{swatch.toUpperCase()}</code>
                    {overridden && (
                      <button onClick={() => clearVar(item.key)} title="Reset to base theme" style={{
                        height: 24, padding: '0 8px', border: '1px solid var(--border-1)',
                        borderRadius: 4, background: 'transparent', color: 'var(--text-3)',
                        fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
                      }}>Reset</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          {hasAnyOverride && (
            <button onClick={resetAll} style={{
              alignSelf: 'flex-start',
              height: 30, padding: '0 14px',
              border: '1px solid var(--flag-emergency)',
              borderRadius: 6, background: 'transparent', color: 'var(--flag-emergency)',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>Reset all custom colors</button>
          )}
        </div>
      </AppearanceGroup>
    </div>
  );
}

// Section block for AppearanceSection. Eyebrow title + divider + padded body.
function AppearanceGroup({ eyebrow, children }) {
  return (
    <div style={{
      padding: '20px 0',
      borderTop: '1px solid var(--border-1)',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700,
        letterSpacing: '0.08em', textTransform: 'uppercase',
        color: 'var(--text-3)',
        marginBottom: 12,
      }}>{eyebrow}</div>
      <div>{children}</div>
    </div>
  );
}

// miniBtnStyle, ReorderBtns, swapAt moved to ./primitives.jsx (imported at top).

function WorkflowSection({ phases, setPhases, statuses, setStatuses, statusColors, setStatusColors, statusTags, setStatusTags, pms, setPms, onRenameClientCode }) {
  const [statusesOpen, setStatusesOpen] = React.useState(false);
  const [pmsOpen, setPmsOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState(null);
  // Inline editing now uses the shared <InlineEdit> (owns value + focus + the
  // race-safe blur). editingId only marks which row is open.
  const startRename = (p) => setEditingId(p.id || p.name);
  const commitRename = (targetId, val) => {
    const name = (val || '').trim();
    if (name) {
      setPhases(phases.map(p => (p.id || p.name) === targetId ? { ...p, name } : p));
    }
    setEditingId(null);
  };
  const moveUp = (idx) => setPhases(swapAt(phases, idx, idx - 1));
  const moveDown = (idx) => setPhases(swapAt(phases, idx, idx + 1));
  const addPhase = () => {
    const id = 'ph_' + Date.now().toString(36);
    // change11: complete flag dropped from phase shape.
    setPhases([...phases, { id, name: 'New phase', fg: '#6b7280', bg: 'var(--bg-surface-2)', statuses: [] }]);
    // Drop straight into the name editor on the new row so naming a phase does
    // not require hunting for the rename affordance.
    setEditingId(id);
  };
  const setPhaseColor = (targetId, hex) => {
    setPhases(phases.map(p => (p.id || p.name) === targetId ? { ...p, fg: hex } : p));
  };
  // Slice 4 (#9): per-phase status display mode (pills | single | hidden).
  const setDisplayMode = (targetId, mode) => {
    setPhases(phases.map(p => (p.id || p.name) === targetId ? { ...p, displayMode: mode } : p));
  };
  // change11: togglePhaseComplete deprecated.
  const deletePhase = (targetId) => {
    if (!window.confirm('Delete this phase?')) return;
    setPhases(phases.filter(p => (p.id || p.name) !== targetId));
  };

  return (
    <div>
      <SettingTitle sub="Statuses are the raw values stored per WO. Phases group statuses and own the color.">Workflow</SettingTitle>
      <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 600 }}>Phases</div>
      {phases.map((p, idx) => {
        const uid = p.id || p.name;
        return (
          <div key={uid} style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: '8px 10px', marginBottom: 6,
            border: '1px solid var(--border-1)', borderRadius: 6,
            background: 'var(--bg-surface)', minWidth: 0,
          }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: 'wrap' }}>
            <ReorderBtns
              onUp={() => moveUp(idx)} onDown={() => moveDown(idx)}
              disableUp={idx === 0} disableDown={idx === phases.length - 1}
            />
            <input
              type="color"
              value={normalizeHex(p.fg)}
              onChange={e => setPhaseColor(uid, e.target.value)}
              title="Phase color"
              style={{ width: 22, height: 22, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent', flexShrink: 0 }}
            />
            {editingId === uid
              ? <InlineEdit
                  value={p.name}
                  onCommit={(val) => commitRename(uid, val)}
                  onCancel={() => setEditingId(null)}
                  style={{
                    fontSize: 14, fontWeight: 600, minWidth: 100, maxWidth: 160,
                    background: 'var(--bg-canvas)', border: '1px solid var(--accent)',
                    borderRadius: 4, padding: '2px 6px', color: 'var(--text-1)', fontFamily: 'inherit',
                  }}
                />
              : <span
                  onDoubleClick={() => startRename(p)}
                  title="Double-click or use ✎ to rename"
                  style={{ fontSize: 14, fontWeight: 600, minWidth: 90, flexShrink: 0, cursor: 'text' }}
                >{p.name}</span>
            }
            <span style={{
              fontSize: 13, color: 'var(--text-2)', flex: 1, minWidth: 60,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {(p.statuses || []).length
                ? p.statuses.join(' · ')
                : <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>tab-derived</span>}
            </span>
            <select
              value={p.displayMode === 'hidden' ? 'hidden' : 'show'}
              onChange={e => setDisplayMode(uid, e.target.value)}
              title="Status display in the WO list"
              style={{ padding: '3px 6px', fontSize: 12, border: '1px solid var(--border-2)', borderRadius: 4,
                background: 'var(--bg-canvas)', color: 'var(--text-1)', fontFamily: 'inherit', cursor: 'pointer', maxWidth: 90, flexShrink: 0 }}
            >
              {/* Post list-rework there is no pill in the list -- status renders as
                  colored text + a status-colored left bar -- so the old Pills/Single
                  split is gone. 'show' covers both legacy values; only 'hidden' hides. */}
              <option value="show">Show</option>
              <option value="hidden">Hidden</option>
            </select>
            <button onClick={() => startRename(p)} title="Rename" style={{ ...miniBtnStyle, padding: '0 7px', flexShrink: 0 }}>{'✎'}</button>
            <button
              onClick={() => deletePhase(uid)}
              style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 7px', flexShrink: 0 }}
            >{'✕'}</button>
           </div>
          </div>
        );
      })}
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <ActionBtn onClick={addPhase}>+ Add phase</ActionBtn>
        <ActionBtn onClick={() => setStatusesOpen(true)}>Manage statuses...</ActionBtn>
        <ActionBtn onClick={() => setPmsOpen(true)}>Manage Clients...</ActionBtn>
      </div>
      {statusesOpen && (
        <StatusesEditor
          statuses={statuses}
          setStatuses={setStatuses}
          statusColors={statusColors}
          setStatusColors={setStatusColors}
          statusTags={statusTags}
          setStatusTags={setStatusTags}
          phases={phases}
          setPhases={setPhases}
          onClose={() => setStatusesOpen(false)}
        />
      )}
      {pmsOpen && (
        <PMsEditor
          pms={pms}
          setPms={setPms}
          onRenameCode={onRenameClientCode}
          onClose={() => setPmsOpen(false)}
        />
      )}
    </div>
  );
}

function StatusesEditor({ statuses, setStatuses, statusColors, setStatusColors, statusTags, setStatusTags, phases, setPhases, onClose }) {
  const [editingIdx, setEditingIdx] = React.useState(null);
  const [newName, setNewName] = React.useState('');
  const [insertAbove, setInsertAbove] = React.useState(''); // '' = append
  useEditorEscClose(onClose);
  // Inline editing via the shared <InlineEdit>; editingIdx marks the open row.

  // Returns the phase id/name that owns this status, or '' if none.
  const phaseOf = (statusName) => {
    if (!phases) return '';
    const ph = phases.find(p => (p.statuses || []).includes(statusName));
    return ph ? (ph.id || ph.name) : '';
  };

  // Assign a status to a phase (remove from all others first). The new entry
  // is re-sorted into the phase's status list by the global statuses index so
  // it lands wherever the user placed it in the global order, instead of
  // always being appended to the end of the phase.
  const assignPhase = (statusName, phaseUid) => {
    if (!phases || !setPhases) return;
    const rank = new Map((statuses || []).map((s, i) => [s, i]));
    setPhases(phases.map(p => {
      const uid = p.id || p.name;
      const cur = (p.statuses || []).filter(s => s !== statusName);
      if (uid === phaseUid) {
        const next = [...cur, statusName].sort(
          (a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity)
        );
        return { ...p, statuses: next };
      }
      return { ...p, statuses: cur };
    }));
  };

  const commitRename = (idx, val) => {
    const trimmed = (val || '').trim();
    if (LOCKED_STATUSES.has(statuses[idx])) { setEditingIdx(null); return; } // hardcoded; cannot rename
    if (trimmed && trimmed !== statuses[idx]) {
      const oldName = statuses[idx];
      const next = [...statuses];
      next[idx] = trimmed;
      setStatuses(next);
      const sc = { ...statusColors };
      if (sc[oldName] !== undefined) { sc[trimmed] = sc[oldName]; delete sc[oldName]; }
      setStatusColors(sc);
      // Slice 4 (#9): move the system-tag entry with the rename.
      if (statusTags && setStatusTags && statusTags[oldName] !== undefined) {
        const st = { ...statusTags };
        st[trimmed] = st[oldName];
        delete st[oldName];
        setStatusTags(st);
      }
      // Propagate rename into phases.statuses[]
      if (phases && setPhases) {
        setPhases(phases.map(p => ({
          ...p,
          statuses: (p.statuses || []).map(s => s === oldName ? trimmed : s),
        })));
      }
    }
    setEditingIdx(null);
  };

  const deleteStatus = (idx) => {
    const name = statuses[idx];
    if (LOCKED_STATUSES.has(name)) return; // hardcoded by change11; cannot delete
    if (!window.confirm('Remove this status?')) return;
    setStatuses(statuses.filter((_, i) => i !== idx));
    const sc = { ...statusColors };
    delete sc[name];
    setStatusColors(sc);
    // Slice 4 (#9): drop the system-tag entry too.
    if (statusTags && setStatusTags && statusTags[name] !== undefined) {
      const st = { ...statusTags };
      delete st[name];
      setStatusTags(st);
    }
    // Remove from phases.statuses[]
    if (phases && setPhases) {
      setPhases(phases.map(p => ({
        ...p,
        statuses: (p.statuses || []).filter(s => s !== name),
      })));
    }
  };

  const addStatus = () => {
    const n = newName.trim();
    if (!n) return;
    if (statuses.includes(n)) { setNewName(''); return; }
    let next;
    const idx = insertAbove ? statuses.indexOf(insertAbove) : -1;
    if (idx >= 0) next = [...statuses.slice(0, idx), n, ...statuses.slice(idx)];
    else next = [...statuses, n];
    setStatuses(next);
    setNewName('');
    // Keep phase status orders aligned with the new global order so the row
    // sort within phases reflects the insertion immediately (no manual ↑↓).
    if (phases && setPhases) {
      setPhases(phases.map(p => ({
        ...p,
        statuses: next.filter(s => (p.statuses || []).includes(s)),
      })));
    }
  };

  // Per-phase status order auto-derives from the global order: filter each
  // phase's status list against the new global ordering. Keeps phases in
  // sync without a separate UI.
  const syncPhasesToGlobal = (newGlobal) => {
    if (!phases || !setPhases) return;
    setPhases(phases.map(p => ({
      ...p,
      statuses: newGlobal.filter(s => (p.statuses || []).includes(s)),
    })));
  };
  const moveStatus = (idx, delta) => {
    const next = swapAt(statuses, idx, idx + delta);
    if (next === statuses) return;
    setStatuses(next);
    syncPhasesToGlobal(next);
  };

  const setColor = (name, hex) => setStatusColors({ ...statusColors, [name]: hex });

  const selectStyle = {
    padding: '3px 6px', fontSize: 12,
    border: '1px solid var(--border-2)', borderRadius: 4,
    background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', cursor: 'pointer', maxWidth: 130,
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 580, maxHeight: '80vh',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)',
        borderRadius: 12, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        color: 'var(--text-1)',
      }}>
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--border-1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Manage statuses</div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-3)', fontSize: 18, padding: 4,
          }}>{'✕'}</button>
        </div>
        <div style={{ padding: '14px 22px', overflowY: 'auto', flex: 1 }}>
          {statuses.map((s, idx) => {
            const locked = LOCKED_STATUSES.has(s);
            return (
            <div key={s} style={{
              display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
              padding: '8px 0', borderBottom: '1px solid var(--border-1)',
              opacity: locked ? 0.85 : 1,
            }}>
              <ReorderBtns
                onUp={() => moveStatus(idx, -1)} onDown={() => moveStatus(idx, 1)}
                disableUp={idx === 0} disableDown={idx === statuses.length - 1}
              />
              <input
                type="color"
                value={statusColors[s] || '#6b7280'}
                onChange={e => setColor(s, e.target.value)}
                style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
                title="Status color"
              />
              {editingIdx === idx && !locked
                ? <InlineEdit
                    value={s}
                    onCommit={(val) => commitRename(idx, val)}
                    onCancel={() => setEditingIdx(null)}
                    style={{
                      flex: 1, fontSize: 14,
                      background: 'var(--bg-canvas)', border: '1px solid var(--accent)',
                      borderRadius: 4, padding: '3px 8px', color: 'var(--text-1)', fontFamily: 'inherit',
                    }}
                  />
                : <span
                    onDoubleClick={locked ? undefined : () => setEditingIdx(idx)}
                    title={locked ? 'Hardcoded by change11 — cannot rename' : 'Double-click to rename'}
                    style={{ flex: 1, fontSize: 14, cursor: locked ? 'default' : 'text', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    {s}
                    {locked && (
                      <span title="Locked — managed automatically" style={{
                        fontSize: 10, padding: '1px 6px', borderRadius: 999,
                        border: '1px solid var(--border-2)', color: 'var(--text-3)',
                        background: 'var(--bg-surface-2)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
                      }}>locked</span>
                    )}
                  </span>
              }
              {phases && (
                <select
                  value={phaseOf(s)}
                  onChange={e => assignPhase(s, e.target.value)}
                  style={selectStyle}
                  title="Phase"
                  disabled={locked}
                >
                  <option value="">-- no phase --</option>
                  {phases.map(p => (
                    <option key={p.id || p.name} value={p.id || p.name}>{p.name}</option>
                  ))}
                </select>
              )}
              {setStatusTags && (
                <select
                  value={(statusTags && statusTags[s]) || ''}
                  onChange={e => {
                    const st = { ...(statusTags || {}) };
                    if (e.target.value) st[s] = e.target.value; else delete st[s];
                    setStatusTags(st);
                  }}
                  style={selectStyle}
                  title="System tag (behavior hook)"
                  disabled={locked}
                >
                  <option value="">-- no hook --</option>
                  {SYSTEM_TAGS.map(t => (
                    <option key={t} value={t}>{SYSTEM_TAG_LABELS[t]}</option>
                  ))}
                </select>
              )}
              <button
                onClick={locked ? undefined : () => setEditingIdx(idx)}
                disabled={locked}
                title={locked ? 'Locked' : 'Rename'}
                style={{ ...miniBtnStyle, padding: '0 7px', opacity: locked ? 0.3 : 1, cursor: locked ? 'default' : 'pointer' }}
              >{'✎'}</button>
              <button
                onClick={locked ? undefined : () => deleteStatus(idx)}
                disabled={locked}
                title={locked ? 'Locked' : 'Delete'}
                style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 7px', opacity: locked ? 0.3 : 1, cursor: locked ? 'default' : 'pointer' }}
              >{'✕'}</button>
            </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addStatus(); }}
              placeholder="New status name"
              style={{
                flex: 1, minWidth: 140, padding: '7px 10px',
                border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-canvas)', color: 'var(--text-1)',
                fontFamily: 'inherit', fontSize: 13,
              }}
            />
            <select
              value={insertAbove}
              onChange={e => setInsertAbove(e.target.value)}
              title="Insert position"
              style={{ ...selectStyle, maxWidth: 180 }}
            >
              <option value="">Insert at end</option>
              {statuses.map(s => <option key={s} value={s}>Insert above: {s}</option>)}
            </select>
            <ActionBtn primary onClick={addStatus}>Add</ActionBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

// Esc closes a nested settings editor (not the whole Settings popup). Capture
// phase + stopImmediatePropagation so it runs before the SettingsOverlay's
// bubble-phase Esc handler and prevents it from firing.
function useEditorEscClose(onClose) {
  React.useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); onClose(); } };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);
}

function PMsEditor({ pms, setPms, onRenameCode, onClose }) {
  const [editingIdx, setEditingIdx] = React.useState(null);
  useEditorEscClose(onClose);
  const [newCode, setNewCode] = React.useState('');
  const [newFullName, setNewFullName] = React.useState('');
  const [newColor, setNewColor] = React.useState('#1a73e8');
  // Whether the user has manually edited the code in the add row. Until they do,
  // the code auto-tracks the full name's acronym suggestion.
  const codeTouched = React.useRef(false);

  // Inline rename edits the CODE (o.pm key). Renaming the code is rare; the full
  // name is the usual edit. Codes stay stable so existing WOs keep their Client.
  const commitRename = (idx, val) => {
    const trimmed = (val || '').trim();
    if (trimmed && trimmed !== pms[idx].name) {
      // Cascade the code change to every WO so none orphan (B2). Fall back to a
      // plain pms rename if the cascade handler wasn't provided.
      if (onRenameCode) onRenameCode(pms[idx].name, trimmed);
      else setPms(pms.map((p, i) => i === idx ? { ...p, name: trimmed } : p));
    }
    setEditingIdx(null);
  };

  const setFullName = (idx, val) => setPms(pms.map((p, i) => i === idx ? { ...p, fullName: val } : p));
  const setColor = (idx, hex) => setPms(pms.map((p, i) => i === idx ? { ...p, color: hex } : p));

  const deletePm = (idx) => {
    if (!window.confirm('Remove this Client?')) return;
    setPms(pms.filter((_, i) => i !== idx));
  };

  const onNewFullName = (val) => {
    setNewFullName(val);
    if (!codeTouched.current) setNewCode(acronymOf(val));
  };

  const addPm = () => {
    const code = newCode.trim();
    const full = newFullName.trim();
    if (!code && !full) return;
    setPms([...pms, { name: code || acronymOf(full), fullName: full || code, color: newColor }]);
    setNewCode(''); setNewFullName(''); setNewColor('#1a73e8');
    codeTouched.current = false;
  };

  const movePm = (idx, delta) => setPms(swapAt(pms, idx, idx + delta));

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 400,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div style={{
        width: 460, maxHeight: '80vh',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-1)',
        borderRadius: 12, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        color: 'var(--text-1)',
      }}>
        <div style={{
          padding: '16px 22px', borderBottom: '1px solid var(--border-1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Manage Clients</div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--text-3)', fontSize: 18, padding: 4,
          }}>{'✕'}</button>
        </div>
        <div style={{ padding: '14px 22px', overflowY: 'auto', flex: 1 }}>
          {pms.map((pm, idx) => (
            <div key={pm.name} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 0', borderBottom: '1px solid var(--border-1)',
            }}>
              <ReorderBtns
                onUp={() => movePm(idx, -1)} onDown={() => movePm(idx, 1)}
                disableUp={idx === 0} disableDown={idx === pms.length - 1}
              />
              <input
                type="color"
                value={normalizeHex(pm.color)}
                onChange={e => setColor(idx, e.target.value)}
                style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
                title="Client color"
              />
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {editingIdx === idx
                  ? <InlineEdit
                      value={pm.name}
                      onCommit={(val) => commitRename(idx, val)}
                      onCancel={() => setEditingIdx(null)}
                      title="Code shown on WOs (kept stable on rename)"
                      style={{
                        fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
                        background: 'var(--bg-canvas)', border: '1px solid var(--accent)',
                        borderRadius: 4, padding: '3px 8px', color: 'var(--text-1)', fontFamily: 'inherit',
                      }}
                    />
                  : <span
                      onDoubleClick={() => setEditingIdx(idx)}
                      title="The code shown on work orders. Double-click to edit (rare — keep stable)."
                      style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', cursor: 'text' }}
                    >{pm.name}</span>
                }
                <input
                  value={pm.fullName || ''}
                  onChange={e => setFullName(idx, e.target.value)}
                  placeholder="Full name"
                  style={{
                    fontSize: 12, padding: '3px 6px', border: '1px solid var(--border-2)',
                    borderRadius: 4, background: 'var(--bg-canvas)', color: 'var(--text-2)', fontFamily: 'inherit',
                  }}
                />
              </div>
              <button onClick={() => setEditingIdx(idx)} title="Edit code" style={{ ...miniBtnStyle, padding: '0 7px' }}>{'✎'}</button>
              <button
                onClick={() => deletePm(idx)}
                style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 7px' }}
              >{'✕'}</button>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'flex-start' }}>
            <input
              type="color"
              value={newColor}
              onChange={e => setNewColor(e.target.value)}
              style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent', marginTop: 2 }}
            />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input
                value={newFullName}
                onChange={e => onNewFullName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addPm(); }}
                placeholder="New client full name (e.g. American Homes 4 Rent)"
                style={{
                  padding: '7px 10px', border: '1px solid var(--border-2)', borderRadius: 6,
                  background: 'var(--bg-canvas)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13,
                }}
              />
              <input
                value={newCode}
                onChange={e => { codeTouched.current = true; setNewCode(e.target.value); }}
                onKeyDown={e => { if (e.key === 'Enter') addPm(); }}
                placeholder="Code — auto, editable (e.g. AMH)"
                style={{
                  padding: '6px 10px', border: '1px solid var(--border-2)', borderRadius: 6,
                  background: 'var(--bg-canvas)', color: 'var(--text-1)', fontFamily: 'inherit',
                  fontSize: 13, fontWeight: 700, letterSpacing: '0.02em',
                }}
              />
            </div>
            <ActionBtn primary onClick={addPm}>Add</ActionBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

const ALERT_DEFS = [
  { key: 'emergencyUnscheduled',        label: 'Emergency unscheduled',          hint: 'WO with emergency flag still in "Open"' },
  { key: 'stale',                       label: 'Stale',                          hint: 'No status change' },
  { key: 'bidOutNoResponse',            label: 'Bid out, no response',           hint: 'Status = Bid submitted, no Client movement' },
  { key: 'partsPastEta',                label: 'Parts past ETA',                 hint: 'Status = Parts pending' },
  { key: 'approvedUnscheduled',         label: 'Approved but unscheduled',       hint: 'Status = Bid approved - Return, no scheduled date' },
  { key: 'readyToClose',                label: 'Ready to close',                 hint: 'Status = Pending-complete' },
  { key: 'approvedCompleteNotInvoiced', label: 'Approved Complete not invoiced', hint: 'Status = Bid approved - Complete, still in Active' },
];

// Diagnostic panel: lets the user paste any address and run the same
// 3-pass chain the worker uses, with full URLs + raw response visible.
// Helps figure out why a specific WO will not geocode.
function TestGeocoder({ mapsHomeState }) {
  const [street, setStreet] = React.useState('');
  const [city, setCity] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [logLines, setLogLines] = React.useState([]);
  const append = (line) => setLogLines(ls => [...ls, line]);
  const run = async () => {
    if (!street.trim() && !city.trim()) return;
    setRunning(true);
    setLogLines([]);
    const state = (mapsHomeState || '').toUpperCase();
    const passes = [
      { label: 'CENSUS STRUCTURED', url: (() => {
          const p = new URLSearchParams();
          p.set('street', street.trim());
          if (city.trim()) p.set('city', city.trim());
          if (state) p.set('state', state);
          p.set('benchmark', 'Public_AR_Current');
          p.set('format', 'json');
          return 'https://geocoding.geo.census.gov/geocoder/locations/address?' + p.toString();
        })()
      },
      { label: 'CENSUS ONELINE', url: (() => {
          const p = new URLSearchParams();
          p.set('address', [street.trim(), city.trim(), state].filter(Boolean).join(', '));
          p.set('benchmark', 'Public_AR_Current');
          p.set('format', 'json');
          return 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?' + p.toString();
        })()
      },
      { label: 'PHOTON', url: (() => {
          const p = new URLSearchParams();
          p.set('q', [street.trim(), city.trim(), state].filter(Boolean).join(', '));
          p.set('limit', '1');
          return 'https://photon.komoot.io/api/?' + p.toString();
        })()
      },
      { label: 'NOMINATIM STRUCTURED', url: (() => {
          const p = new URLSearchParams();
          p.set('format', 'json'); p.set('limit', '1'); p.set('addressdetails', '1'); p.set('countrycodes', 'us');
          if (street.trim()) p.set('street', street.trim());
          if (city.trim())   p.set('city', city.trim());
          if (state)         p.set('state', state);
          return 'https://nominatim.openstreetmap.org/search?' + p.toString();
        })()
      },
      { label: 'NOMINATIM FREE', url: (() => {
          const p = new URLSearchParams();
          p.set('format', 'json'); p.set('limit', '1'); p.set('addressdetails', '1'); p.set('countrycodes', 'us');
          p.set('q', [street.trim(), city.trim(), state].filter(Boolean).join(', '));
          return 'https://nominatim.openstreetmap.org/search?' + p.toString();
        })()
      },
    ];
    for (const pass of passes) {
      append('--> ' + pass.label);
      append(pass.url);
      try {
        const r = await fetch(pass.url, { headers: { 'Accept-Language': 'en' } });
        const text = await r.text();
        append('HTTP ' + r.status + '  bytes=' + text.length);
        try {
          const parsed = JSON.parse(text);
          if (pass.label.startsWith('CENSUS')) {
            const matches = parsed && parsed.result && parsed.result.addressMatches;
            append('matches=' + (Array.isArray(matches) ? matches.length : 'none'));
            if (Array.isArray(matches) && matches.length) {
              const m0 = matches[0];
              const c = m0.coordinates || {};
              append('lat=' + c.y + ' lon=' + c.x);
              append('matched=' + (m0.matchedAddress || '').slice(0, 200));
            }
          } else if (pass.label === 'PHOTON') {
            const feats = parsed && parsed.features;
            append('features=' + (Array.isArray(feats) ? feats.length : 'none'));
            if (Array.isArray(feats) && feats.length) {
              const coords = feats[0].geometry && feats[0].geometry.coordinates;
              if (Array.isArray(coords) && coords.length >= 2) {
                append('lat=' + coords[1] + ' lon=' + coords[0]);
              }
              const props = feats[0].properties || {};
              append('name=' + (props.name || ''));
              append('display=' + [props.housenumber, props.street, props.city, props.state, props.postcode].filter(Boolean).join(', '));
            }
          } else {
            append('results=' + (Array.isArray(parsed) ? parsed.length : 'non-array'));
            if (Array.isArray(parsed) && parsed.length) {
              append('lat=' + parsed[0].lat + ' lon=' + parsed[0].lon);
              append('display=' + (parsed[0].display_name || '').slice(0, 200));
            }
          }
        } catch { append('JSON parse failed: ' + text.slice(0, 200)); }
      } catch (e) {
        append('EXCEPTION: ' + e.message);
      }
      append('');
      await new Promise(r => setTimeout(r, 1100));
    }
    setRunning(false);
  };
  const inputStyle = {
    height: 32, padding: '0 10px',
    border: '1px solid var(--border-2)', borderRadius: 6,
    background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box',
  };
  return (
    <div style={{
      padding: '14px 0',
      borderBottom: '1px solid var(--border-1)',
      display: 'flex', flexDirection: 'column', gap: 10,
      minWidth: 0,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Test geocoder</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
          Paste any street + city and run both structured and free-text passes against
          Nominatim. Shows exact URLs, HTTP status, response shape, and result address.
          Use to diagnose why a specific WO will not geocode. Uses your saved home
          state as the filter.
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0 }}>
        <input
          type="text"
          value={street}
          onChange={e => setStreet(e.target.value)}
          placeholder="Street (e.g. 120 Jethro Circle)"
          style={{ ...inputStyle, flex: '1 1 240px', minWidth: 0 }}
        />
        <input
          type="text"
          value={city}
          onChange={e => setCity(e.target.value)}
          placeholder="City (e.g. Smithfield)"
          style={{ ...inputStyle, flex: '1 1 160px', minWidth: 0 }}
        />
        <button
          onClick={run}
          disabled={running}
          style={{
            height: 32, padding: '0 14px',
            border: 'none', borderRadius: 6,
            background: running ? 'var(--bg-surface-2)' : 'var(--accent)',
            color: running ? 'var(--text-3)' : 'var(--accent-fg)',
            fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
            cursor: running ? 'default' : 'pointer',
          }}
        >{running ? 'Running...' : 'Run test'}</button>
      </div>
      {logLines.length > 0 && (
        <pre style={{
          margin: 0, padding: '10px 12px',
          background: 'var(--bg-canvas)',
          border: '1px solid var(--border-2)', borderRadius: 6,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11, color: 'var(--text-2)',
          maxHeight: 280, overflow: 'auto',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>{logLines.join('\n')}</pre>
      )}
    </div>
  );
}

function MapsSection({ mapsHomeState, mapsHomeZip, mapsHomeAddress, mapsHomeCity, saveHome, onClearGeocache, geocacheCount, mapMarkerColors, setMapMarkerColors, mapTypeColors, setMapTypeColors, types }) {
  const [zip, setZip] = React.useState(mapsHomeZip || '');
  const [addr, setAddr] = React.useState(mapsHomeAddress || '');
  const [city, setCity] = React.useState(mapsHomeCity || '');
  const [state, setState] = React.useState(mapsHomeState || '');
  React.useEffect(() => { setZip(mapsHomeZip || ''); }, [mapsHomeZip]);
  React.useEffect(() => { setAddr(mapsHomeAddress || ''); }, [mapsHomeAddress]);
  React.useEffect(() => { setCity(mapsHomeCity || ''); }, [mapsHomeCity]);
  React.useEffect(() => { setState(mapsHomeState || ''); }, [mapsHomeState]);
  const zipValid = /^\d{5}$/.test(zip.trim());
  const dirty =
    zip.trim() !== (mapsHomeZip || '') ||
    addr.trim() !== (mapsHomeAddress || '') ||
    city.trim() !== (mapsHomeCity || '') ||
    state.trim().toUpperCase() !== (mapsHomeState || '');
  const save = () => { if (zipValid && saveHome) saveHome({ zip: zip.trim(), addr: addr.trim(), city: city.trim(), state: state.trim() }); };
  const inputStyle = {
    height: 32, padding: '0 10px',
    border: '1px solid var(--border-2)', borderRadius: 6,
    background: 'var(--bg-canvas)', color: 'var(--text-1)',
    fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box',
  };
  return (
    <div>
      <SettingTitle sub="Home address used to center the map and bias geocoding so WO addresses do not land out of region.">Maps</SettingTitle>
      <TestGeocoder mapsHomeState={mapsHomeState} />
      <div style={{
        padding: '14px 0',
        borderBottom: '1px solid var(--border-1)',
        display: 'flex', flexDirection: 'column', gap: 10,
        minWidth: 0,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Home address</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            Full home address - street, city, state, zip. Zipcode is required. The other fields refine the lookup; the Maps module zooms in tighter when a street address is provided. Saving runs the lookup once and stores the resulting center / zoom internally. If the structured lookup fails (e.g. a highway notation like "US-70 W"), a free-text fallback is tried automatically.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <input
            type="text"
            value={addr}
            onChange={e => setAddr(e.target.value)}
            placeholder="Street address (e.g. 1027 US-70 W)"
            style={{ ...inputStyle, flex: '1 1 240px', minWidth: 0 }}
          />
          <input
            type="text"
            value={city}
            onChange={e => setCity(e.target.value)}
            placeholder="City"
            style={{ ...inputStyle, flex: '1 1 160px', minWidth: 0 }}
          />
          <select
            value={state}
            onChange={e => setState(e.target.value)}
            style={{ ...inputStyle, flex: '0 0 200px', fontSize: 13 }}
          >
            <option value="">Select state or territory...</option>
            {Object.entries(US_STATE_NAMES)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([code, name]) => (
                <option key={code} value={code}>{name} ({code})</option>
              ))}
          </select>
          <input
            type="text"
            inputMode="numeric"
            value={zip}
            onChange={e => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))}
            placeholder="Zipcode"
            maxLength={5}
            style={{ ...inputStyle, flex: '0 0 100px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 14 }}
          />
        </div>
        <div>
          <button
            onClick={save}
            disabled={!zipValid || !dirty}
            style={{
              height: 32, padding: '0 14px',
              border: 'none', borderRadius: 6,
              background: (zipValid && dirty) ? 'var(--accent)' : 'var(--bg-surface-2)',
              color:      (zipValid && dirty) ? 'var(--accent-fg)' : 'var(--text-3)',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
              cursor: (zipValid && dirty) ? 'pointer' : 'default',
            }}
          >Save home and recenter</button>
        </div>
      </div>
      <div style={{
        padding: '14px 0',
        borderBottom: '1px solid var(--border-1)',
        display: 'flex', flexDirection: 'column', gap: 10,
        minWidth: 0,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>Geocode cache</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            Lat/lon results from Nominatim are cached per WO so the map loads
            instantly. After changing the home state or default view, clear
            the cache so every active WO is re-geocoded with the new bounds.
            Suspect entries (state mismatch or distance &gt; 250km from default
            view) are flagged with an orange marker; right-click the WO and pick
            "Re-geocode address" to retry just that one.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <div style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {geocacheCount ? geocacheCount + ' cached' : 'Empty cache'}
          </div>
          {geocacheCount > 0 && (
            <button
              onClick={() => {
                if (!window.confirm('Clear all cached geocodes (' + geocacheCount + ')? Every active WO will be re-geocoded with the current home state and default view.')) return;
                onClearGeocache && onClearGeocache();
              }}
              style={{
                height: 32, padding: '0 12px',
                border: '1px solid var(--flag-emergency)',
                background: 'transparent',
                color: 'var(--flag-emergency)',
                borderRadius: 6, fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
                cursor: 'pointer',
              }}
            >Clear geocode cache</button>
          )}
        </div>
      </div>

      <MarkerColorsSubsection
        mapMarkerColors={mapMarkerColors}
        setMapMarkerColors={setMapMarkerColors}
      />
    </div>
  );
}

function MarkerColorsSubsection({ mapMarkerColors, setMapMarkerColors }) {
  const mc = { ...DEFAULT_MAP_MARKER_COLORS, ...(mapMarkerColors || {}) };
  const updMarker = (key, value) => setMapMarkerColors && setMapMarkerColors({ ...mc, [key]: value });
  const row = (label, color, onChange, onReset) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
      <input
        type="color" value={normalizeHex(color)} onChange={e => onChange(e.target.value)}
        style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
      />
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-1)' }}>{label}</span>
      {onReset && (
        <button onClick={onReset} style={{
          height: 24, padding: '0 8px', border: '1px solid var(--border-2)',
          background: 'var(--bg-surface)', color: 'var(--text-3)',
          borderRadius: 4, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
        }}>Reset</button>
      )}
    </div>
  );
  return (
    <div style={{
      padding: '14px 0',
      borderBottom: '1px solid var(--border-1)',
      display: 'flex', flexDirection: 'column', gap: 4,
      minWidth: 0,
    }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>Marker colors</div>
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
          Pin fill is the WO status color; the marker border is the job-type
          color (set in Settings &gt; Tech Job Types). Suspect overrides the
          fill; the fallback fills WOs with no status color.
        </div>
      </div>
      <div style={{ marginTop: 6 }}>
        {row('Suspect (geocoder unsure)', mc.suspect, v => updMarker('suspect', v),
          mc.suspect !== DEFAULT_MAP_MARKER_COLORS.suspect ? () => updMarker('suspect', DEFAULT_MAP_MARKER_COLORS.suspect) : null)}
        {row('Unknown status (fallback fill)', mc.fallback, v => updMarker('fallback', v),
          mc.fallback !== DEFAULT_MAP_MARKER_COLORS.fallback ? () => updMarker('fallback', DEFAULT_MAP_MARKER_COLORS.fallback) : null)}
      </div>
    </div>
  );
}

function ApiKeysSection({ locationIqKey, setLocationIqKey }) {
  const [draft, setDraft] = React.useState(locationIqKey || '');
  const [revealed, setRevealed] = React.useState(false);
  React.useEffect(() => { setDraft(locationIqKey || ''); }, [locationIqKey]);
  const dirty = draft !== (locationIqKey || '');
  const save = () => { if (setLocationIqKey) setLocationIqKey(draft.trim()); };
  const clear = () => { setDraft(''); if (setLocationIqKey) setLocationIqKey(''); };
  return (
    <div>
      <SettingTitle sub="Third-party service credentials. Stored locally in your wo_data file; never sent anywhere except the service it identifies.">API Keys</SettingTitle>
      <div style={{
        padding: '14px 0',
        borderBottom: '1px solid var(--border-1)',
        display: 'flex', flexDirection: 'column', gap: 10,
        minWidth: 0,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 500 }}>LocationIQ API key</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4, lineHeight: 1.5 }}>
            Optional. When set, the Maps module geocoder tries LocationIQ first (free tier: 5,000 requests/day, no credit card). Better residential coverage than the free Census + Photon + Nominatim cascade.
            {' '}<a href="https://locationiq.com/dashboard/access-tokens" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Get a key at locationiq.com</a>.
            Only the Forward Geocoding (Search) endpoint is used.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', minWidth: 0 }}>
          <input
            type={revealed ? 'text' : 'password'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="pk.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            style={{
              flex: '1 1 220px', minWidth: 0,
              height: 32, padding: '0 10px',
              border: '1px solid var(--border-2)', borderRadius: 6,
              background: 'var(--bg-canvas)', color: 'var(--text-1)',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 12, boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => setRevealed(r => !r)}
            style={{
              height: 32, padding: '0 12px',
              border: '1px solid var(--border-2)', borderRadius: 6,
              background: 'var(--bg-surface)', color: 'var(--text-1)',
              fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', flexShrink: 0,
            }}
          >{revealed ? 'Hide' : 'Show'}</button>
          <button
            onClick={save}
            disabled={!dirty}
            style={{
              height: 32, padding: '0 12px',
              border: 'none', borderRadius: 6,
              background: dirty ? 'var(--accent)' : 'var(--bg-surface-2)',
              color: dirty ? 'var(--accent-fg)' : 'var(--text-3)',
              fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
              cursor: dirty ? 'pointer' : 'default', flexShrink: 0,
            }}
          >Save</button>
          {locationIqKey && (
            <button
              onClick={clear}
              style={{
                height: 32, padding: '0 10px',
                border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-surface)', color: 'var(--text-2)',
                fontFamily: 'inherit', fontSize: 12, cursor: 'pointer', flexShrink: 0,
              }}
            >Clear</button>
          )}
        </div>
      </div>
    </div>
  );
}


function AlertsSection({ thresholds, setThresholds, overdueCfg, setOverdueCfg }) {
  const t = { ...DEFAULT_ALERT_THRESHOLDS, ...(thresholds || {}) };
  const oc = { ...DEFAULT_OVERDUE_CFG, ...(overdueCfg || {}) };
  const colorRow = (label, key) => (
    <SettingRow key={key} label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="color" value={normalizeHex(oc[key])}
          onChange={(e) => setOverdueCfg({ ...oc, [key]: e.target.value })}
          style={{ width: 28, height: 28, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
        />
        {oc[key] !== DEFAULT_OVERDUE_CFG[key] && (
          <button onClick={() => setOverdueCfg({ ...oc, [key]: DEFAULT_OVERDUE_CFG[key] })} style={{
            height: 24, padding: '0 8px', border: '1px solid var(--border-2)',
            background: 'var(--bg-surface)', color: 'var(--text-3)',
            borderRadius: 4, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
          }}>Reset</button>
        )}
      </div>
    </SettingRow>
  );
  return (
    <div>
      <SettingTitle sub="Tune when each alert fires in the Needs Attention surface.">Alerts</SettingTitle>
      {/* Slice 2 (#3): overdue-schedule indicator config. */}
      <div style={{ marginBottom: 4, fontSize: 14, fontWeight: 600 }}>Overdue schedule</div>
      <SettingRow label="Overdue after" hint="Scheduled WO past its start time by this many minutes gets recolored (list, detail, itinerary, map marker border).">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="number" min={0} value={oc.thresholdMinutes}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              setOverdueCfg({ ...oc, thresholdMinutes: isNaN(n) ? 0 : n });
            }}
            style={{
              width: 80, padding: '6px 10px',
              border: '1px solid var(--border-2)', borderRadius: 6,
              background: 'var(--bg-surface)',
              color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13,
              textAlign: 'right',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>minutes</span>
        </div>
      </SettingRow>
      {colorRow('Overdue text color', 'textColor')}
      {colorRow('Overdue marker border color', 'borderColor')}
      <div style={{ margin: '18px 0 4px', fontSize: 14, fontWeight: 600 }}>Needs Attention</div>
      {ALERT_DEFS.map(def => (
        <SettingRow key={def.key} label={def.label} hint={def.hint}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number"
              min={0}
              value={t[def.key]}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                setThresholds({ ...t, [def.key]: isNaN(n) ? 0 : n });
              }}
              style={{
                width: 80, padding: '6px 10px',
                border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-surface)',
                color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13,
                textAlign: 'right',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-3)' }}>days</span>
          </div>
        </SettingRow>
      ))}
    </div>
  );
}

// Slice 3 (#8): Tech Job Types. NO separate trade list — the trades ARE the
// existing work-order types (settings.types). This tab is now the single home
// for managing types (list + colors) AND techs (list + route colors); the old
// Workflow "Manage types/techs" modals were retired. techJobTypes is per tech,
// per type, a { selected, weight } cell (weight disabled unless selected).
// Routing (slice 5) reads techJobTypes[tech][wo.type].
const TRADE_WEIGHTS = ['low', 'med', 'high'];
function TradesSection({ types, setTypes, mapTypeColors, setMapTypeColors, techJobTypes, setTechJobTypes, techs, setTechs, techColors, setTechColors }) {
  const list = (types || []).filter(Boolean);
  const [editingTypeIdx, setEditingTypeIdx] = React.useState(null);
  const [editingTechIdx, setEditingTechIdx] = React.useState(null);
  const [newType, setNewType] = React.useState('');
  const [newTech, setNewTech] = React.useState('');
  // Same color resolution the map markers use: explicit override, else the
  // letter default for the built-ins, else a neutral gray. Electrical is
  // legacy-only (see TYPE_COLORS).
  const tc = { HVAC: TYPE_COLORS.H, Plumbing: TYPE_COLORS.P, Electrical: TYPE_COLORS.E, ...(mapTypeColors || {}) };
  const colorOf = (name) => tc[name] || '#6b7280';
  // Type list/color management (name-based so indices never drift). Renaming or
  // deleting leaves any orphaned color/cell keyed by the old name; harmless.
  const updTypeColor = (name, value) => setMapTypeColors && setMapTypeColors({ ...(mapTypeColors || {}), [name]: value });
  const renameType = (oldName, val) => {
    const n = (val || '').trim();
    setEditingTypeIdx(null);
    if (n && n !== oldName && !(types || []).includes(n)) setTypes((types || []).map(t => t === oldName ? n : t));
  };
  const deleteType = (name) => { if (window.confirm('Remove type "' + name + '"?')) setTypes((types || []).filter(t => t !== name)); };
  const moveType = (name, delta) => { const i = (types || []).indexOf(name); if (i >= 0) setTypes(swapAt(types, i, i + delta)); };
  const addType = () => { const n = newType.trim(); if (!n || (types || []).includes(n)) return; setTypes([...(types || []), n]); setNewType(''); };
  // Tech list management.
  const renameTech = (oldName, val) => {
    const n = (val || '').trim();
    setEditingTechIdx(null);
    if (n && n !== oldName && !(techs || []).includes(n)) setTechs((techs || []).map(t => t === oldName ? n : t));
  };
  const deleteTech = (name) => { if (window.confirm('Remove tech "' + name + '"?')) setTechs((techs || []).filter(t => t !== name)); };
  const moveTech = (name, delta) => { const i = (techs || []).indexOf(name); if (i >= 0) setTechs(swapAt(techs, i, i + delta)); };
  const addTech = () => { const n = newTech.trim(); if (!n || (techs || []).includes(n)) return; setTechs([...(techs || []), n]); setNewTech(''); };
  // Patch one tech/type cell. Selecting for the first time defaults weight med.
  const setCell = (tech, type, patch) => {
    const techMap = (techJobTypes && techJobTypes[tech]) || {};
    const cur = techMap[type] || {};
    const nextCell = { ...cur, ...patch };
    if (nextCell.selected && !nextCell.weight) nextCell.weight = 'med';
    setTechJobTypes({ ...techJobTypes, [tech]: { ...techMap, [type]: nextCell } });
  };
  const cellStyle = { padding: '4px 8px', textAlign: 'center', borderBottom: '1px solid var(--border-1)' };
  const addInputStyle = { flex: 1, minWidth: 0, padding: '6px 9px', border: '1px solid var(--border-2)', borderRadius: 6, background: 'var(--bg-canvas)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 12 };
  return (
    <div>
      <SettingTitle sub="Manage the job-type list and colors, the tech list and route colors, and which types each tech handles (with a preference weight). Used by routing to rank suggested work.">Tech Job Types</SettingTitle>
      {list.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>No types yet. Add one below to start.</div>
      ) : (
        <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-3)', fontWeight: 600, borderBottom: '1px solid var(--border-1)' }}>Tech</th>
              {list.map((type, ti) => (
                <th key={type} style={{ padding: '4px 8px', color: 'var(--text-2)', fontWeight: 600, borderBottom: '1px solid var(--border-1)', minWidth: 130 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <input type="color" value={normalizeHex(colorOf(type))}
                        onChange={(e) => updTypeColor(type, e.target.value)}
                        title="Type color (marker border)" style={{ width: 20, height: 20, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }} />
                      {editingTypeIdx === ti
                        ? <InlineEdit value={type} onCommit={(v) => renameType(type, v)} onCancel={() => setEditingTypeIdx(null)}
                            style={{ width: 80, fontSize: 13, background: 'var(--bg-canvas)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', color: 'var(--text-1)', fontFamily: 'inherit' }} />
                        : <span onDoubleClick={() => setEditingTypeIdx(ti)} title="Double-click to rename" style={{ cursor: 'text' }}>{type}</span>}
                    </div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                      <button onClick={() => moveType(type, -1)} disabled={ti === 0} title="Move left" style={{ ...miniBtnStyle, padding: '0 6px', opacity: ti === 0 ? 0.4 : 1 }}>{'‹'}</button>
                      <button onClick={() => moveType(type, 1)} disabled={ti === list.length - 1} title="Move right" style={{ ...miniBtnStyle, padding: '0 6px', opacity: ti === list.length - 1 ? 0.4 : 1 }}>{'›'}</button>
                      <button onClick={() => deleteType(type)} title="Remove type" style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 6px' }}>{'✕'}</button>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(techs || []).length === 0 ? (
              <tr><td colSpan={list.length + 1} style={{ padding: '8px', color: 'var(--text-3)', fontSize: 12 }}>No techs yet. Add one below.</td></tr>
            ) : (techs || []).map((tech, hi) => (
              <tr key={tech}>
                <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-1)', fontWeight: 500 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {/* Slice 5 (#10): per-tech route color used for map polylines. */}
                    {setTechColors && (
                      <input type="color" value={normalizeHex((techColors && techColors[tech]) || '#6b7280')}
                        onChange={(e) => setTechColors({ ...(techColors || {}), [tech]: e.target.value })}
                        title="Route color" style={{ width: 20, height: 20, padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }} />
                    )}
                    {editingTechIdx === hi
                      ? <InlineEdit value={tech} onCommit={(v) => renameTech(tech, v)} onCancel={() => setEditingTechIdx(null)}
                          style={{ flex: 1, fontSize: 13, background: 'var(--bg-canvas)', border: '1px solid var(--accent)', borderRadius: 4, padding: '2px 6px', color: 'var(--text-1)', fontFamily: 'inherit' }} />
                      : <span onDoubleClick={() => setEditingTechIdx(hi)} title="Double-click to rename" style={{ cursor: 'text' }}>{tech}</span>}
                    <span style={{ flex: 1 }} />
                    <ReorderBtns onUp={() => moveTech(tech, -1)} onDown={() => moveTech(tech, 1)} disableUp={hi === 0} disableDown={hi === techs.length - 1} />
                    <button onClick={() => deleteTech(tech)} title="Remove tech" style={{ ...miniBtnStyle, color: 'var(--flag-emergency)', padding: '0 6px' }}>{'✕'}</button>
                  </div>
                </td>
                {list.map(type => {
                  const cell = (techJobTypes && techJobTypes[tech] && techJobTypes[tech][type]) || {};
                  return (
                    <td key={type} style={cellStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        <input type="checkbox" checked={!!cell.selected}
                          onChange={(e) => setCell(tech, type, { selected: e.target.checked })} />
                        <select value={cell.weight || 'med'} disabled={!cell.selected}
                          onChange={(e) => setCell(tech, type, { weight: e.target.value })}
                          style={{ background: 'var(--bg-surface-2)', color: cell.selected ? 'var(--text-1)' : 'var(--text-3)',
                            border: '1px solid var(--border-2)', borderRadius: 6, padding: '1px 4px',
                            fontFamily: 'inherit', fontSize: 12, opacity: cell.selected ? 1 : 0.5 }}>
                          {TRADE_WEIGHTS.map(w => <option key={w} value={w}>{w}</option>)}
                        </select>
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 14 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 220px', minWidth: 0 }}>
          <input value={newType} onChange={e => setNewType(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addType(); }}
            placeholder="New job type" style={addInputStyle} />
          <ActionBtn primary onClick={addType}>Add type</ActionBtn>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: '1 1 220px', minWidth: 0 }}>
          <input value={newTech} onChange={e => setNewTech(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addTech(); }}
            placeholder="New tech" style={addInputStyle} />
          <ActionBtn primary onClick={addTech}>Add tech</ActionBtn>
        </div>
      </div>
    </div>
  );
}

// Slice 5 (#10): routing weight tuning. Weights feed the "Suggested" composite
// score in the Schedule modal. Tech route colors live in Tech Job Types.
const ROUTING_WEIGHT_DEFS = [
  { key: 'dist',         label: 'Distance',          hint: 'Closer WOs score higher (1 / road-km).' },
  { key: 'city',         label: 'Same city',         hint: 'Bonus when the candidate shares the anchor WO city.' },
  { key: 'unfilledCity', label: 'Unfilled city',     hint: 'Bonus when more unscheduled WOs remain in that city.' },
  { key: 'type',         label: 'Job-type preference', hint: "Weight of the tech's low/med/high preference for the WO type." },
];
function RoutingSection({ weights, setWeights }) {
  const w = { ...DEFAULT_ROUTING_WEIGHTS, ...(weights || {}) };
  return (
    <div>
      <SettingTitle sub="Tune how the Schedule modal ranks Suggested work orders. Distance is Haversine x 1.3 (no live traffic). Route colors are set per tech in Tech Job Types.">Routing</SettingTitle>
      {ROUTING_WEIGHT_DEFS.map(def => (
        <SettingRow key={def.key} label={def.label} hint={def.hint}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input
              type="number" min={0} step={0.1} value={w[def.key]}
              onChange={(e) => { const n = parseFloat(e.target.value); setWeights({ ...w, [def.key]: isNaN(n) ? 0 : n }); }}
              style={{ width: 80, padding: '6px 10px', border: '1px solid var(--border-2)', borderRadius: 6,
                background: 'var(--bg-surface)', color: 'var(--text-1)', fontFamily: 'inherit', fontSize: 13, textAlign: 'right' }}
            />
            {w[def.key] !== DEFAULT_ROUTING_WEIGHTS[def.key] && (
              <button onClick={() => setWeights({ ...w, [def.key]: DEFAULT_ROUTING_WEIGHTS[def.key] })} style={{
                height: 24, padding: '0 8px', border: '1px solid var(--border-2)', background: 'var(--bg-surface)',
                color: 'var(--text-3)', borderRadius: 4, fontFamily: 'inherit', fontSize: 11, cursor: 'pointer',
              }}>Reset</button>
            )}
          </div>
        </SettingRow>
      ))}
    </div>
  );
}

function TraySection({ trayEnabled, setTrayEnabled, trayBadgeSource, setTrayBadgeSource }) {
  return (
    <div>
      <SettingTitle sub="Always-on tray icon. Quick access from anywhere.">Tray</SettingTitle>
      <SettingRow label="Enable tray icon">
        <Seg value={trayEnabled ? 'on' : 'off'} onChange={setTrayEnabled} options={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]} />
      </SettingRow>
      <SettingRow label="Badge source" hint="What number appears on the tray icon.">
        <Seg value={trayBadgeSource} onChange={setTrayBadgeSource} options={[
          { value: 'attention', label: 'Needs attention' },
          { value: 'active',    label: 'Active total' },
          { value: 'off',       label: 'No badge' },
        ]} />
      </SettingRow>
    </div>
  );
}

function AboutSection({ onResetSettings, onRestoreBackup, updateState, onCheckUpdate, onInstallUpdate }) {
  // null = probing, true = backup present, false = absent.
  // While probing the button stays enabled so a click works even on
  // the first 50ms after mount; the restore callback already toasts
  // "No pre-migration backup found" if storage comes up empty.
  const [hasBackup, setHasBackup] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!window.storage || !window.storage.get) {
        if (!cancelled) setHasBackup(false);
        return;
      }
      try {
        const r = await window.storage.get('wo_data_pre_migration_backup');
        if (cancelled) return;
        setHasBackup(!!(r && r.value));
      } catch {
        if (!cancelled) setHasBackup(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const restoreDisabled = hasBackup === false;
  return (
    <div>
      <SettingTitle>About</SettingTitle>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
        <GambleMark size={48} />
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Trade Tracker</div>
          <div style={{ fontSize: 12, color: 'var(--text-3)' }}>by Gamble &middot; v{APP_VERSION}</div>
        </div>
      </div>

      <div style={{ paddingTop: 16, borderTop: '1px solid var(--border-1)' }}>
        <SettingRow label="Updates" hint={updateStatusText(updateState)}>
          <div style={{ display: 'flex', gap: 8 }}>
            {updateState && updateState.status === 'ready' && onInstallUpdate && (
              <ActionBtn primary onClick={onInstallUpdate}>Restart now</ActionBtn>
            )}
            <ActionBtn
              onClick={onCheckUpdate}
              disabled={!!updateState && (updateState.status === 'checking' || updateState.status === 'downloading')}
            >Check for updates</ActionBtn>
          </div>
        </SettingRow>
      </div>

      <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border-1)' }}>
        {/* change11: explicit one-click backup, distinct from the auto-rotated
            backups/ folder. User picks the save path; the live wo-data.json
            is copied as-is. Use this BEFORE installing a new version. */}
        <SettingRow
          label="Back up work order data"
          hint="Saves a copy of your current wo-data.json to a location you choose. Recommended before installing a new version."
        >
          <ActionBtn
            onClick={async () => {
              if (!(window.backup && window.backup.saveNow)) return;
              const r = await window.backup.saveNow();
              if (r && r.ok) alert('Backup saved to:\n' + r.path);
              else if (r && r.canceled) { /* user dismissed */ }
              else alert('Backup failed: ' + ((r && r.error) || 'unknown error'));
            }}
          >Back up now…</ActionBtn>
        </SettingRow>
        <SettingRow
          label="Open auto-backup folder"
          hint="Opens the rolling backup folder. The app keeps the last 10 saves automatically. Useful if you need to dig out an older snapshot."
        >
          <ActionBtn
            onClick={async () => {
              if (window.backup && window.backup.openFolder) await window.backup.openFolder();
            }}
          >Open folder</ActionBtn>
        </SettingRow>
        <SettingRow label="Reset all settings" hint="Restores theme, density, alerts, and tray to defaults. Does NOT touch your WOs.">
          <ActionBtn
            onClick={onResetSettings}
            style={{ background: 'var(--flag-emergency)', color: 'var(--accent-fg)', border: 'none' }}
          >Reset settings</ActionBtn>
        </SettingRow>
        <SettingRow
          label="Restore pre-migration backup"
          hint={restoreDisabled
            ? 'No pre-migration backup found in storage. Re-tick "Back up workbook first" on your next migration to create one.'
            : 'Replaces current data with the snapshot taken just before the last migration applied.'
          }
        >
          <ActionBtn
            onClick={onRestoreBackup}
            disabled={restoreDisabled}
            style={restoreDisabled ? { opacity: 0.5 } : undefined}
          >Restore backup</ActionBtn>
        </SettingRow>
      </div>
    </div>
  );
}

