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
- Commit: `6e44710` (feature) + docs record.

## Review disposition (user decision, 2026-09-25)
- Native review lineage `review-edbc57ad0f20262c` (medium, lens
  review-reliability) could not close: the reviewer relay was refused twice
  at admission with an identical deterministic error ("reviewer payload
  contains no complete JSON object … scan ended at byte 4954") — the
  preserved payload (.git/gentle-ai/rejected-results/) shows a completed
  review with no blockers, so this looks like a gentle-ai admission-scanner
  defect, not a review finding. No authority was consumed; the lineage
  remains open.
- The user explicitly allowed this candidate to ship unreviewed (ordinary
  repository policy). Basis: independent verification 6/6 (task
  muh8q7wn-2-0gxa) + harness-proven translator fix + tsc strict clean.
- Follow-up: report the admission-scanner defect upstream and re-run a
  fresh review on the next candidate.

## Rail collapse and polish (2026-09-25)

The rail got the Todos card's collapse control plus a content polish pass.
Study sources: gentle-shell `lib/shell-todo.ts` (renderTodoCard collapsedRow),
`lib/shell-hover.ts` (shared hover role), `extensions/gentle-todo.ts`
(NativePointerRegion wiring), `lib/shell-sidebar-layout.ts` (dispatchPartMouse).

### Collapse control (Todos-mirrored)

- **Title control:** `✿ Language Coach ▾ Collapse` when expanded,
  `▸ Expand` when collapsed; the label is dropped under width 28
  (`${icon} ${width >= 28 ? actionLabel : ""}`), exactly like the Todos card.
- **Mouse:** the rail object now declares `handleMouse(event)` — the
  fullscreen layout's `dispatchPartMouse` delivers section-relative
  coordinates to it. Mirroring gentle-todo's NativePointerRegion: a `move`
  with `button: "none"` sets `hovered = (y === 0)` and returns
  `{ handled: true, render: true }` on change; a left `click` with `y === 0`
  toggles collapse. The whole title row is the control — gentle-shell does
  not compute an x-range for the Todos control, so none was computed here.
  Hover clears on `invalidate()` or a move elsewhere in the card; the same
  no-leave-into-the-transcript limitation the Todos control has applies.
  The handler is wrapped in try/catch — it never throws into the dispatch.
- **Keyboard:** same mechanism as Todos — `pi.registerShortcut` with default
  `ctrl+shift+l` (free: pi claims ctrl+shift+up/down/f/g, gentle-shell claims
  ctrl+shift+t/ctrl+shift+a, the coach owns alt+c/alt+t). Env override
  `GENTLE_PI_COACH_KEY`; `""` or `"off"` disables the shortcut and the top-rule
  hint (click-only control).
- **Repaint path (deliberate deviation from Todos):** gentle-todo's card has
  no digest, so its toggle bumps the shared sidebar revision
  (`invalidateSidebar`). The coach rail already declares a `digest()`, so
  `collapsed` and `hovered` are folded into it instead — the section memo
  re-renders only the coach section on toggle/hover, without the revision
  bump that would re-render every rail section. `toggleCoachRail()` also calls
  `railTui.requestRender()` for the shortcut path (the mouse path's
  `{ render: true }` already triggers a frame).
- **Collapsed render:** one summary line in place of the body (mirror of
  `collapsedRow`): the first due phrase `phrase — gloss` when one is due,
  else `N corrections this week · trend`, else `no coaching data yet`.
- **Hint elision (observed):** `cardTop` shows the top-rule hint only when
  title + hint fit. At the fixed 50-column rail width (48 content) the long
  `Language Coach` title usually crowds out `ctrl+shift+l collapse`, so the
  hint is often elided in the rail; the shortcut and control still work. The
  same fit rule governs the Todos hint (which fits because "Todos" is short).
- **State:** `railCollapsed`/`railHovered` are module-level component-local
  state (the rail is a singleton per terminal via the marker); both reset on
  `session_shutdown` (`unmountCoachSidebar`).

### Content polish (expanded; same data sources: log, vocab, reviews)

- Title subtitle: `N this week · rising|stable|improving` (Todos-style
  `done of total` placement; N = current week's corrections).
- Weekly stats: one line per week bucket `Sep 21–27  31`; the current week's
  line is painted in the theme's existing `accent` role (renderCard wraps body
  lines in the `text` role — nested `theme.fg` works, as the Todos body rows
  already rely on).
- Due vocabulary: `phrase — gloss` per line (max 5), review streak appended
  when > 0 (`· streak 2`).
- Top corrections: `span ×count` per line (max 5, span capped at 30 cols).
- Recent: unchanged shape, max 3, already toOneLine.
- Recommendations: tightened phrasing, joined into one line
  (`3 due — /skill:language-drill · rising — /language digest`).
- Roles used: text, muted (subtitle), accent (title/control idle + current
  week), warning (hover, the shared HOVER_ROLE), border (frame). No new
  colors.
- `paintHoverable` is an inline mirror of gentle-shell's `lib/shell-hover.ts`
  (HOVER_ROLE `"warning"`, idle role `"accent"`), not an import: this repo's
  compile-time contract (`types/gentle-shell/*.d.ts` + /tmp tsconfig paths)
  does not cover that module, and the allowed edit surfaces exclude adding a
  stub.
- The overlay fallback panel (`/language panel`, alt+c) renders the same
  polished card always-expanded, without the control, keeping its
  `esc to close` hint.

### Verification

- `npx --yes -p typescript@5 tsc -p /tmp/language-coach.tsconfig.json` →
  exit 0 (strict, zero diagnostics).
- Throwaway render probe (`/tmp/lc-card-probe.mjs`, not in the repo) against
  the real gentle-shell `renderCard`: 24 combinations (widths 48/30/27/12/1/0
  × collapsed × hovered) all render without throwing; inspected frames
  confirm the control, hover role swap, accent current-week line, streak
  suffix, and collapsed summary.
- Runtime mouse/hover/keyboard interaction is user-owned visual testing after
  /reload (same disposition as the v2 rail work).

## Rail collapse review (2026-09-25)
- Lineage `review-a286895b2e99b1be`, medium, lens review-reliability —
  first verdict **correction_required**: R3-001 CRITICAL, unguarded
  `stats.weeks[3]` index in the two rail summary/subtitle sites
  introduced by the polish.
- Bounded correction (4 diff lines, plan
  `review.capture-correction-plan`): both sites now use a length-guarded
  `weeks.at(-1)`; committed as `6265191`. The identical pre-existing
  access in renderStats (line ~290) is base-only and stays a follow-up.
- Targeted validator **approved**; acknowledged, authority burned. Two
  informational advisories (R3-002 WARNING :589, R3-003 SUGGESTION :627)
  recorded as later polish.

## Widget retirement (2026-09-25)

**User decision:** the persistent dashboard rail supersedes the status widget
above the editor; the widget is retired.

Removed from `extensions/language-coach.ts` (all widget-only):

- `WIDGET_ID` constant and the `widgetVisible` flag.
- `countCorrectionsLast7d` and `countDueVocab` — used only by
  `buildWidgetLines`; the rail and panel compute the same data through
  `loadPanelData` (`aggregateStats`, `vocabSchedule`).
- `buildWidgetLines`, `refreshWidget`, and `clearWidget`, plus their
  `session_start` / `message_end` wiring. `message_end` no longer touches the
  widget at all.

Kept, unchanged:

- `message_end` coach logging (`appendLog`) and vocab capture (`appendVocab`);
  the sidebar invalidation (`invalidateSidebar`) after data changes.
- `session_start` config/status handling (`applyStatus`); rail mount when the
  mode is active and `unmountCoachSidebar` when mode = off, on
  `session_shutdown`, and on mode-off transitions.
- The rail mount idiom: `setWidget`'s component factory remains the only
  non-interactive hook that provides `tui`/`theme` (the gentle-shell
  `setFooter` idiom). `mountCoachRail` mounts through it and immediately
  clears the empty widget, so nothing is painted above the editor. The
  never-throw policies of the remaining handlers are unchanged.

The `message_end` data flow is unchanged except the widget: log and vocab
writes still happen, and the rail still repaints through its digest plus the
explicit invalidation.

## Rail slim-down (2026-09-25)

**User decision:** the expanded rail carried too much information; the coach
rail should be slimmer and centered on recommendations derived from the
user's common errors.

### New expanded layout (in this order, everything else removed)

1. Card title "Language Coach" + subtitle as before (`N this week · trend`).
2. Section **Common errors** — the top recurring correction spans from the
   log (up to 4, same `span ×count` shape as the previous Top corrections
   data), each followed by ONE short recommendation line produced by a small
   pure-function heuristic.
3. Section **Vocabulary** — compact: one line `N due now` plus up to 2 due
   phrases (`phrase — gloss`); "No vocabulary captured yet" when nothing is
   tracked, "All caught up" when tracked but none due.
4. Final **Recommendations** line — unchanged drill/digest/interview hint
   logic, still joined into one line ("keep practicing!" when empty).

Removed: the per-week bucket lines (`weeklyRows`), the "Recent" section, the
review-streak suffix, and the old "No coaching data yet" placeholder (the
empty-log case now shows "No corrections recorded yet"). The collapsed
one-line summary is unchanged.

### Recommendation heuristic

`errorRecommendation(span, count)` (exported pure function in
`extensions/language-coach.ts`; no model, no fs):

- span `"i"` → `Capitalize "I" in every sentence.`
- span in {in, on, at, to, for, over} → `Double-check prepositions — write
  the phrase, then verify the preposition.`
- span `"let's"` → `Use "let's" for suggestions; avoid "let us" in speech.`
- single word ending in `ly` → `Check adjective vs adverb after verbs.`
- otherwise → `Practice "<span>" — it is your most frequent fix (×N).`

The weekly trend remains visible in the card subtitle and in
`/language stats` (which keeps its full weekly breakdown and Recent list).
`loadPanelData` now also exposes `trackedTotal` to distinguish "no
vocabulary captured" from "all caught up".
