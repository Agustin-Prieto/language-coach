# Feature: Language Coach (generic language-learning overlay)

## Goal
Lightweight, always-on language coaching for Pi conversations: user writes in
native language → one-line translation into target language; user writes in
target language → one-line correction. Fully generic (any native → any target).

## Constraints
- Minimal token cost: compressed overlay (~200 tokens), prompt-cache stable,
  zero cost when mode = off.
- No interference with gentle-ai/gentle-shell: overlay is parent-session only,
  explicit exception for reply-language rule, never touches code artifacts,
  commits, subagent outputs, or SDD files.
- Not part of gentle-shell package: standalone global extension + skill.

## Design
- Extension: `~/.pi/agent/extensions/language-coach.ts`
  - `before_agent_start`: appends overlay to system prompt when enabled.
  - Config: `~/.pi/agent/language-coach.json`
    `{ "nativeLanguage": "Spanish", "targetLanguage": "English", "mode": "on" }`
  - `/language` → status or interactive setup; `/language on|productivity|off`
    → set mode (persisted in config file).
  - Inert (zero cost) when config missing/invalid or mode = off.
- Skill: `~/.pi/agent/skills/language-interview/SKILL.md`
  - Mock technical interview in the configured target language, loaded
    on-demand (progressive disclosure).
- Mistake tracking: model saves recurring mistakes via mem_save
  (topic_key `language-mistakes-<target>`); review on request.

## Tasks
- [x] T1: Implement extension `language-coach.ts` (overlay + commands + config).
- [x] T2: Create skill `language-interview`.
- [x] T3: Verify TypeScript compiles cleanly; report evidence.
- [x] T4: Seed config `language-coach.json` (Spanish → English, mode on).

## Evidence
- T3: `npx --yes -p typescript@5 tsc -p /tmp/language-coach.tsconfig.json` → exit 0
  (strict, target es2022, module nodenext, types mapped to the pi package).
- T1/T2/T4: implemented inline by parent — `gentle-ai-worker` rejected the
  surfaces because they are outside any git repo (validator requires
  repository-relative paths); no native `Agent` tool available → documented
  fallback to inline execution.

## Iterations
- v2: corrections bold the changed words (user request).
- v3: coach line rendered as `> 🎓 "..."` blockquote block for visual
  separation (user choice); extension logs every coach line via
  `message_end` to `~/.pi/agent/language-coach-log.jsonl` (ts, native,
  target, line) for progress tracking; overlay review instructions read
  the log + Engram history. tsc exit 0. Requires /reload.
- v4: split corrections vs translations — markers `> 🎓` (correction) and
  `> 🌐` (translation), `kind` field in log entries. tsc exit 0.
- v6: fixed coach detection — assistant content is a block array (thinking +
  text), extracted text can start with blank lines; detection now skips them.
  Diagnosed with temporary message_end instrumentation; first real log entry
  confirmed. Diagnostics removed. Commit `4067ac0`.
- v5: project moved to dedicated git repo `~/projects/language-coach`
  (extension/, skills/, docs/odd/, README); symlinks from
  `~/.pi/agent/extensions` and `~/.pi/agent/skills`; data files stay in
  `~/.pi/agent`. Initial commit: `6f0ca31`.

- v7: coach block echoes the user's original message (natural-language part)
  above the correction/translation ✏️ line; `---` horizontal rule separates
  the coach section from the response; logging captures the full block
  (verified against correction/translation/unmarked shapes). tsc exit 0.

- v8 (display): custom theme `~/.pi/agent/themes/Language-Coach.json`
  (Gentleman-Cute copy) with mdQuote/mdQuoteBorder set to amber 214 so the
  coach blockquote renders in a distinct color. Selected via /theme.

## Commits
- `6f0ca31` feat: initial language-coach extension and interview skill
- `4067ac0` fix: detect coach block across message block arrays

## Notes
- Work lives under `~/.pi/agent` (not a git repo) → no work-unit commits;
  file contents recorded in Engram mirror instead.
