# Language Coach

A generic, lightweight language-learning coach for [Pi](https://github.com/badlogic/pi-mono) coding sessions: continuous, low-cost coaching in any language pair (native → target).

## How it works

- **Extension** (`extensions/language-coach.ts`): injects a ~200-token, prompt-cache-stable overlay into the system prompt via `before_agent_start`. The model then:
  - Coach block at the top of every reply: echo of the user's original message, then the correction (`> 🎓`) or translation (`> 🌐`) on a ✏️ line, then a `---` rule separating the coach section from the answer.
  - Logs every coach block mechanically (zero model cost) for progress tracking.
- **Skill** (`skills/language-interview/`): on-demand mock technical interviews in the target language (progressive disclosure).
- **Skill** (`skills/language-drill/`): on-demand targeted drills built from the user's own recurring corrected mistakes (coach log + mistake history), including due vocabulary from captured phrases.

The coach never applies to code, commands, commit messages, delegated subagent artifacts, or SDD files.

## Install

Local development install (local paths are added to settings without copying, so edits take effect on the next pi start; `pi remove` / `pi config` manage it from there):

```bash
pi install ~/projects/language-coach
```

(Adjust the path to wherever you cloned this repository.)

If you previously used symlinks, remove them from `~/.pi/agent/extensions` and `~/.pi/agent/skills` after installing to avoid double-loading.

Data files live in `~/.pi/agent` (environment, not source) and are unaffected by the install method:

| File | Purpose |
|---|---|
| `language-coach.json` | `{ nativeLanguage, targetLanguage, mode: "on" \| "productivity" \| "off" }` |
| `language-coach-log.jsonl` | One entry per coach block: `{ ts, kind: correction\|translation\|unmarked, native, target, line }` |
| `language-coach-digest.md` | Appended digest sections written by /language digest |
| `language-coach-vocab.jsonl` | Captured phrases from 🌐 translations: `{ ts, phrase, translation, source }` |
| `language-coach-vocab-reviews.jsonl` | Review records appended by drills: `{ ts, phrase, correct }` |

## Commands

- `/language` — show status, or interactive setup if no config exists.
- `/language on|productivity|off` — set mode (persisted). `off` injects nothing (zero cost).
- `/language stats` — progress dashboard from the coach log: block counts by kind, corrections per week for the last 4 ISO weeks with a trend label (improving / stable / rising), top recurring corrections (the `**bold**` spans), and the last 5 blocks. Read-only; headless sessions print the summary to the console.
- `/language digest` — append a dated digest section (totals, weekly trend, top corrections, "since last digest" count) to `~/.pi/agent/language-coach-digest.md`
- `/language vocab` — summary of tracked vocabulary phrases (from 🌐 translations) and which are due for review now; shows the 5 most recent captures. Read-only; headless sessions print the summary to the console.
- `/skill:language-interview [topic]` — start a mock interview.
- `/skill:language-drill [count]` — targeted practice of your most frequent corrected mistakes (default 5 exercises).

## TUI extras

Three TUI-only extras (guarded by `ctx.hasUI`; headless sessions fall back to a notification or ignore them). All are read-only over the existing data files except the translator, which calls the model directly.

- **Status widget** — a 1–2 line `language-coach` widget above the editor (`corrections (7d)`, trend, vocabulary due, top correction + drill hint). Recomputed on session start and after every assistant message from the log/vocab files (zero model cost); cleared when mode is `off`. Painted with the card system's theme roles (accent headline, muted detail).
- **Dashboard rail (persistent)** — the coach now docks a gentle-shell-style card rail automatically in fullscreen terminals: it appears whenever the terminal is wide enough per gentle-shell's breakpoint (≥ 140 columns) and live-updates from the log/vocab files after every assistant message (weekly corrections + trend, due vocabulary (up to 5), top corrections (up to 5), the 3 most recent blocks, and a Recommendations line). `/language panel` + **alt+c** remain as the fallback overlay for narrow or non-fullscreen terminals.
- **Dashboard panel (narrow fallback)** — `/language panel` or **alt+c** opens the same dashboard as a card-styled overlay for narrow (< 140 cols) or non-fullscreen terminals. Anchored to the right edge on wide terminals, centered on narrow ones. `esc` closes.
- **Translator panel** — `/language translate` or **alt+t** opens a scratchpad overlay titled `Translate (native → target)` in the same card design. Type text, press `enter` to translate; the result renders in the panel with the previous pairs (most recent first, capped at 5). `esc` aborts an in-flight translation (shown as `cancelled`) and closes when idle. Provider, auth, and request errors render inline in the panel; an empty model response renders as an error instead of adding an empty history entry. Fixed: the panel previously baked state into its container once and never rebuilt it, so completed translations never rendered — results now render live. Translations are still direct model calls; nothing enters the session context.
  - **Privacy:** the translator calls the model directly through the active model's provider (resolved via `ctx.modelRegistry.getProvider` / `getProviderAuth`); nothing is sent to the session context — translations never enter the transcript, the coach log, or any data file.
  - **Active model:** translations use whichever model is currently active (and its configured provider auth); switch models with `/model` to change the translator's engine.

**Gentle Shell design** — the boxes use the local gentle-shell project's card/sidebar libraries, imported at runtime through a node_modules symlink. Required one-time setup from the repo root:

```bash
mkdir -p node_modules && ln -sfn ../../gentle-shell/lib node_modules/gentle-shell-lib
```

(`node_modules` is gitignored; without the symlink the extension fails to load. Compile-time types come from stub declarations in `types/gentle-shell/`.)

## Progress review

Ask the assistant for a "progress review": it reads recent `language-coach-log.jsonl` entries plus the Engram mistake history (`topic_key: language-mistakes-<target>`) and summarizes recurring mistakes, weekly volume, improvements, and focus points.

## Optional: coach block color

The TUI renders the coach block as a blockquote, so its color is theme-driven (`mdQuote` / `mdQuoteBorder` tokens). Example override — copy your current theme to `~/.pi/agent/themes/` and set both tokens to a distinct color (e.g. `"214"` amber):

```json
"mdQuote": "214",
"mdQuoteBorder": "214"
```

## Development

- Type check: `npx --yes -p typescript@5 tsc -p <tsconfig>` (strict, es2022, nodenext, types mapped to the pi package).
- Changes take effect after `/reload` or a session restart.
- Workflow: ODD feature doc in `docs/odd/`, one work-unit commit per closed task.
