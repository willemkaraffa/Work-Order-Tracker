// Test fixture: mount <ServiceLibrary/> standalone so renderer-smoke can assert the
// S1b nav (L2 page sub-entries) + Material/Labor columns render without throwing.
// Bundled by test/_load.js (esbuild), so React here is the SAME instance the
// component uses (single-copy hooks). Importing invoices.jsx pulls app.jsx, whose
// createRoot(#root).render(<App/>) self-mount also fires — harmless in jsdom.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ServiceLibrary } from '../src/invoices.jsx';

export function mountServiceLibrary(el) {
  const root = createRoot(el);
  root.render(React.createElement(ServiceLibrary, {
    toast: () => {}, subCats: [], setSubCats: () => {},
  }));
  return root;
}
