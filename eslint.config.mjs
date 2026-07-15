// ESLint flat config. This exists to HARDEN part of the anti-tech-debt protocol from a
// reminder (which drifts) into a deterministic gate (which does not). Only the rules that
// map to a real protocol item are enabled -- this is not a general style linter.
//
// Mapping:
//   react/no-unstable-nested-components  -> A5 (inline component defs remount every render)
//   react-hooks/rules-of-hooks           -> hook call-order correctness
//   react-hooks/exhaustive-deps          -> A1/A4/A6 (effect deps that do not observe the trigger)
//
// A7 (setTimeout without cleanup) has NO stock rule and is intentionally absent, not silently
// claimed. Severity (error vs warn) is set from what the EXISTING code already passes, so the
// gate blocks NEW violations without forcing a legacy-debt cleanup tonight.

import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { react, "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: "readonly", document: "readonly", console: "readonly",
        setTimeout: "readonly", clearTimeout: "readonly",
        setInterval: "readonly", clearInterval: "readonly",
        fetch: "readonly", localStorage: "readonly", navigator: "readonly",
        requestAnimationFrame: "readonly", alert: "readonly",
        React: "readonly", module: "writable", require: "readonly",
      },
    },
    settings: { react: { version: "detect" } },
    rules: {
      // Severity set from what the existing code ALREADY passes, so these BLOCK new
      // violations without a legacy cleanup:
      //   no-unstable-nested-components (A5): 0 current violations -> hard error.
      //   rules-of-hooks: 0 after renaming a mis-named non-hook (useSuspect) -> hard error.
      "react/no-unstable-nested-components": "error",
      "react-hooks/rules-of-hooks": "error",
      // exhaustive-deps (A1/A4/A6): 73 legacy violations. Cannot block without fixing all
      // 73. Kept as a VISIBLE warning -- honestly a nag, not a gate, until the debt is
      // paid down. The verify gate fails only on errors, so this does not block today.
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
