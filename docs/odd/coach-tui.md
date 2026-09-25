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

## v2 — gentle-shell design (2026-09-25)

### Persistent right-side rail

The dashboard is now a persistent rail in the fullscreen sidebar (gentle-shell
look: rounded frame, `✿` glyph, INFO tone — frame in the theme `border` role,
title in `accent`), rendered from the same data as the overlay.

- Lib modules imported RELATIVE from the extension file
  (`extensions/language-coach.ts` → `../../gentle-shell/lib/`), with explicit
  `.ts` extensions (jiti resolves them relative to the source file at runtime;
  tsc has `allowImportingTsExtensions`):
  - `shell-card.ts` — `CARD_TONE`, `cardTop`, `cardLine`, `cardBottom`,
    `cardInnerWidth`, `renderCard`, `Card`.
  - `shell-sidebar.ts` — `sidebarState`, `SidebarRail`.
  - `shell-sidebar-layout.ts` — `installSidebar`, `invalidateSidebar`.
- Mount idiom: the coach's existing `setWidget` component factory is the
  persistent hook that first provides `tui`/`theme` (the same idiom
  gentle-shell uses with `setFooter`). `mountCoachSidebar` runs there once per
  terminal, guarded by a `Symbol.for("language-coach.sidebar.marker")` marker
  stored on the terminal (not module state).
- Double-install guard: `installSidebar` is NOT re-entrant safe (a second call
  stacks another `root[NODE]` override and interval). The coach skips it when
  gentle-shell already owns the sidebar (`sidebarState(tui).parts.has("footer")`
  or `state.active`) and only registers its part. Disposed on
  `session_shutdown` (and when mode = off).
- Data freshness: the rail declares a `digest()` (size + mtime of
  log/vocab/vocab-reviews files), and `invalidateSidebar(tui)` also runs on
  `message_end` after data changes.

### API deviations (observed against gentle-shell@65841d79)

1. **Rail section keys are hardcoded.** `installSidebar`'s `prepare()` renders
   only the parts registered under keys `"footer"`, `"agents"`, `"todo"` (plus
   the separate `"header"` slot); a part under a custom key like
   `"language-coach"` would never paint. The coach registers its rail under
   `"agents"`, which no shipped gentle-shell extension currently registers
   (gentle-agents explicitly stopped being a rail part; gentle-todo owns
   `"todo"`). If gentle-shell reintroduces an `"agents"` rail part, whichever
   component registers last wins the Map slot.
2. **Parts registered before/after installSidebar behave identically** —
   `prepare()` re-reads `state.parts` on every invalidation — but only for the
   three hardcoded keys (see deviation 1).
3. **Coexistence race.** If gentle-shell's `setFooter` factory runs after the
   coach's mount, gentle-shell calls `installSidebar` unconditionally, which
   stacks a second layout override (second interval; the later override wins;
   both share `state.parts`, so rendering stays correct; both disposers run at
   their own session end). Detection at the coach's mount point cannot rule
   this out; a lib-level re-entrancy guard would fix it.
4. **`ShellBarTheme` structural compatibility:** pi's `Theme` (method
   bivariance on `fg`) satisfies both `ShellBarTheme` and `CardTheme`, so the
   theme object from the widget factory is passed through directly.

### Translator fix (with harness evidence)

Diagnostic harness `/tmp/lc-translate-diag.ts` (throwaway, not in the repo)
replicated `openTranslator`'s `runRequest` headless
(`pi -p "say hi" -e /tmp/lc-translate-diag.ts`) and wrote the full outcome to
`/tmp/lc-translate-diag.json`:

- `model`: `{ provider: "nan", id: "glm5.3-flash", api: "openai-completions" }`.
- `getProviderAuth("nan")` → truthy `AuthResult` (keys `auth`, `source`) with
  no top-level `apiKey`; the panel's `if (!auth) throw` gate therefore passes.
- `getApiKeyForProvider("nan")` → the configured key; `getApiKeyAndHeaders(model)`
  → `{ ok: true }` — the registry resolves auth internally for `complete()`.
- `complete()` → `stopReason: "stop"`, content `[{type:"thinking"}, {type:"text",
  text: "Hello world, this is a test."}]`; extraction →
  `"Hello world, this is a test."` from Spanish input.

So the request path was never the bug. Root cause (in the panel):
`TranslatorPanel.translate()` mutated `state`/`history` but never rebuilt the
pre-baked `Container` (`rebuild()` ran only in the constructor and
`invalidate()`), and `render()` returned the stale children — so a completed
translation never appeared. Fix: `render()` now composes the card lines from
live state on every call (card frame via `cardTop`/`cardLine`/`cardBottom`,
the `Input` rendered inside `cardInnerWidth(width)`), so `requestRender()`
after the async outcome paints the result. Hardening from the same evidence:
an empty result — e.g. an aborted run surfacing as an empty string — no
longer creates a history entry; it renders as an inline `empty response from
model` error.
The auth gate was left as `getProviderAuth` (evidence: truthy for the custom
provider; `getApiKeyForProvider` was not needed).

### Toggle overlay demoted to fallback

`/language panel` + alt+c keep working, restyled with the same card system
(`renderCard(coachCard(...), { expanded: true, hint: "esc to close" })`). They
remain the dashboard surface for narrow (< 140 cols) and non-fullscreen
terminals, where the lib's `SIDEBAR_BREAKPOINT = 140` disables the rail. The
translator overlay (`/language translate`, alt+t) got the same card frame.
Widget colors aligned with the card roles (first line `accent`, second
`muted`).

### Verification

- `npx --yes -p typescript@5 tsc -p /tmp/language-coach.tsconfig.json`:
  zero errors in `extensions/language-coach.ts` under `strict`. The 6
  remaining diagnostics are all inside `../../gentle-shell/lib/*.ts` and are
  pre-existing/environmental: upstream compiles the lib with `strict: false`,
  and against pi's bundled pi-tui 0.85.1 d.ts two of them (`TS2322`
  `handleMouse` variance, `TS2341` private `hideTransientScrollbar`) appear
  regardless of strictness. Proven independent of this change: a config
  compiling only the three lib files (no coach file) reproduces the identical
  error set. The /tmp tsconfig needed `module: esnext` +
  `moduleResolution: bundler`: gentle-shell's `"type": "module"` makes its lib
  resolve in ESM mode, where `nodenext` + `paths` failed to substitute the
  `@earendil-works/pi-tui` mapping (TS2307 cascade).
- Runtime: `pi -p` with the extension loads cleanly (jiti resolves the
  relative `.ts` lib imports; verified with a card-render probe and the full
  extension headless).
- Translator harness evidence above proves a real translation round-trip
  (Spanish input → English output).

## Verification and review (v2)
- tsc strict: `npx --yes -p typescript@5 tsc -p /tmp/language-coach.tsconfig.json` → exit 0.
- gentle-ai-verify (task muh8q7wn-2-0gxa): 6/6 PASS — rail registration and
  coexistence guard (installSidebar skipped when gentle-shell owns the
  sidebar), digest sensitivity to log/vocab/review changes, card rendering
  width-safe at 140/50/30 incl. empty data, translator live composition +
  history cap + abort/error paths, harness-proven model call
  (nan/glm5.3-flash → "Hello world, this is a test."), command safety
  (four pre-existing write sites only), headless guards.
- Rail key note: the part registers under sidebar key "agents" because
  gentle-shell's fullscreen layout only paints footer/agents/todo keys.
- Setup: node_modules/gentle-shell-lib symlink → ../../gentle-shell/lib
  (runtime); types/gentle-shell/*.d.ts stubs (compile time; gentle-shell
  compiles non-strict so its sources are not type-checked here).
- Translator root cause: the panel baked state into its Container once and
  never rebuilt it — completed translations never rendered. Fix: render()
  composes lines from live state.
- Commit: (this feature commit).
