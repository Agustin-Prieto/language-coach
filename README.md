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
