# Feature: Coach TUI — widget, dashboard panel, translator panel

## Goal
Gentle-shell-style TUI boxes for the coach: an always-on status widget, a
toggleable dashboard side panel, and a scratchpad translator input that
calls the model directly without touching the session context.

## Design (locked with user)
- Widget: ctx.ui.setWidget above the editor; 1–2 compact lines
  (corrections last 7d, trend, vocab due) recomputed on session_start and
  message_end from the existing log/vocab/review files (read-only, zero
  model cost); cleared when mode = off. TUI-only (guard ctx.hasUI).
- Dashboard panel: ctx.ui.custom({ overlay: true }) bordered component,
  opened via `/language panel` and a registered shortcut (pick a
  non-conflicting key; document it); sections: weekly stats (aggregateStats),
  top corrections, due vocabulary (vocabSchedule), recent blocks, and a
  recommendations line (e.g. drill hint when vocab is due); esc closes.
- Translator panel: `/language translate` overlay with an Input/Editor;
  Enter fires a direct pi-ai call via ctx.modelRegistry.getProvider +
  getProviderAuth using the active model (ctx.model) with a minimal
  translate-only prompt (native → target, output only the translation);
  result renders in-panel with the pairs kept as local history; esc closes
  and aborts via ctx.signal; provider/auth errors render inline in the
  panel; headless notify fallback (feature requires TUI).
- All three are pure extension code over existing data; no new stores,
  no session-context changes, no coach block.

## Tasks
- [x] T1 — Widget (setWidget, live recompute, mode-off clear).
- [x] T2 — Dashboard panel component + command + shortcut.
- [x] T3 — Translator panel component + command + direct model call.
- [x] T4 — README documentation.
- [x] T5 — Verify (parent: tsc + logic verification; visual test user-owned).

## Evidence
- tsc strict: `npx --yes -p typescript@5 tsc -p /tmp/language-coach.tsconfig.json` → exit 0.
- gentle-ai-verify (task muh1vx60-h-h7w4): 6/6 PASS — widget logic vs
  real files (corrections 7d = 36 match, due vocab = 3/3 match, trend
  rising, width bounds, empty-data states); command safety (exactly 4 fs
  write sites, all pre-existing; zero writes in widget/panel/translator
  code; translator history component-local; alt+c/alt+t collision-free
  per keybindings docs); prompt containment (single translate-only user
  message, no session context); headless guards; session-safety try/catch
  audit.
- Runtime TUI behavior (overlay rendering, esc/abort UX, focus/IME) is
  user-owned visual testing after /reload.
- Commits: `719f496` (feature) + `d05f36c` (correction) + (this record).
