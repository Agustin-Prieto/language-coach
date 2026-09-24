# Feature: Package language-coach as a Pi package

## Goal
Convert the hand-installed extension+skill (two symlinks) into a proper Pi
package so pi manages discovery, updates, and enable/disable via its package
system.

## Design
- Rename `extension/` -> `extensions/` (pi convention directory).
- Add `package.json` with a `pi` manifest: extensions `./extensions`,
  skills `./skills`; `private: true` until an npm publish decision.
- Install via `pi install ~/projects/language-coach` (local path:
  added to settings without copying — dev loop unchanged).
- Remove the old symlinks in `~/.pi/agent/extensions` and
  `~/.pi/agent/skills` after install to avoid double-loading the overlay.
- Data files stay in `~/.pi/agent` (language-coach.json, log JSONL).

## Tasks
- [x] T1 — Rename extension/ to extensions/ (git mv).
- [x] T2 — Add package.json pi manifest + README install update.
- [x] T3 — Commit conversion.
- [x] T4 — Switch installation (pi install, remove symlinks, verify load).

## Evidence
- `pi install ~/projects/language-coach` → registered in
  `~/.pi/agent/settings.json` packages as `../../projects/language-coach`;
  `pi list` shows it as a user package.
- Old symlinks removed (`~/.pi/agent/extensions/language-coach.ts`,
  `~/.pi/agent/skills/language-interview`); `pi list` shows exactly one load
  path, so no double overlay.
- End-to-end: headless `pi -p "hello"` from `/tmp` → reply starts with the
  `> 🎓` coach block (overlay injected via the package load).
- Commit `9f6c08f` (manifest + rename + README + this record).

## Native review
- Lineage `review-1f8cdd18d4464503`, medium tier, lens `review-reliability`,
  candidate `7fd2b81..98f9aff` (5 paths, 804 lines — rename counted as
  delete+add) — **approved**, acknowledged, authority burned.
- Advisory, non-blocking: R3-load-path (package.json manifest paths,
  SUGGESTION), R3-ops-boundary (README install wording, WARNING,
  informational), R3-verify-gap (docs, SUGGESTION). Possible later polish.

## Notes
- The running session still uses the old symlink-loaded extension until the
  next pi start; verify the package load then.
- Verified 2026-09-24: package load confirmed in a fresh headless session.
- `private: true` prevents accidental npm publish; remove when the publish
  decision is made. Publishing would also warrant a LICENSE file and a
  versioned release flow.
