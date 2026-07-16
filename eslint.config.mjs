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
  // scripts/ was UNLINTED until 2026-07-16, which is how a command injection
  // (execSync with an argv value interpolated into a shell string) shipped and had
  // to be caught by an LLM reviewer instead of by a machine. These are node CJS
  // tools, not React, so they get their own block. Honest scope: stock ESLint has
  // no rule for shell injection (that needs eslint-plugin-security's
  // detect-child-process, which flags EVERY child_process call and is noisy), so
  // this catches unused/undefined symbols, not that bug class. Do not mistake it
  // for a security gate.
  {
    files: ["scripts/**/*.js", "test/**/*.js"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: {
        require: "readonly", module: "writable", process: "readonly",
        console: "readonly", __dirname: "readonly", fetch: "readonly",
        Buffer: "readonly", setTimeout: "readonly", clearTimeout: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["error", { args: "none" }],
    },
  },
  // Same precedent as the React block above: severity is set from what the code
  // ALREADY passes, so the gate blocks NEW violations without forcing a legacy
  // cleanup inside an unrelated change. scripts/ is new code with 0 violations, so
  // it stays a hard error. test/ carries 5 legacy unused-vars (dead destructured
  // imports, plus a dead `failures` counter in change11). Checked, not assumed:
  // that counter is NOT a false-green, the harness exits on its own `fail` var.
  {
    files: ["test/**/*.js"],
    rules: { "no-unused-vars": "warn" },
  },
];
