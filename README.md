# Language Coach

A generic, lightweight language-learning coach for [Pi](https://github.com/badlogic/pi-mono) coding sessions: continuous, low-cost coaching in any language pair (native → target).

## How it works

- **Extension** (`extension/language-coach.ts`): injects a ~200-token, prompt-cache-stable overlay into the system prompt via `before_agent_start`. The model then:
  - Coach block at the top of every reply: echo of the user's original message, then the correction (`> 🎓`) or translation (`> 🌐`) on a ✏️ line, then a `---` rule separating the coach section from the answer.
  - Logs every coach block mechanically (zero model cost) for progress tracking.
- **Skill** (`skills/language-interview/`): on-demand mock technical interviews in the target language (progressive disclosure).

The coach never applies to code, commands, commit messages, delegated subagent artifacts, or SDD files.

## Install

```bash
ln -s ~/projects/language-coach/extension/language-coach.ts ~/.pi/agent/extensions/language-coach.ts
ln -s ~/projects/language-coach/skills/language-interview ~/.pi/agent/skills/language-interview
```

Data files live in `~/.pi/agent` (environment, not source):

| File | Purpose |
|---|---|
| `language-coach.json` | `{ nativeLanguage, targetLanguage, mode: "on" \| "productivity" \| "off" }` |
| `language-coach-log.jsonl` | One entry per coach block: `{ ts, kind: correction\|translation\|unmarked, native, target, line }` |

## Commands

- `/language` — show status, or interactive setup if no config exists.
- `/language on|productivity|off` — set mode (persisted). `off` injects nothing (zero cost).
- `/skill:language-interview [topic]` — start a mock interview.

## Progress review

Ask the assistant for a "progress review": it reads recent `language-coach-log.jsonl` entries plus the Engram mistake history (`topic_key: language-mistakes-<target>`) and summarizes recurring mistakes, weekly volume, improvements, and focus points.

## Development

- Type check: `npx --yes -p typescript@5 tsc -p <tsconfig>` (strict, es2022, nodenext, types mapped to the pi package).
- Changes take effect after `/reload` or a session restart.
- Workflow: ODD feature doc in `docs/odd/`, one work-unit commit per closed task.
