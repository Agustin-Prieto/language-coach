# Feature: Package language-coach as a Pi package

## Goal
Convert the hand-installed extension+skill (two symlinks) into a proper Pi
package so pi manages discovery, updates, and enable/disable via its package
system.

## Design
- Rename `extension/` -> `extensions/` (pi convention directory).
- Add `package.json` with a `pi` manifest: extensions `./extensions`,
  skills `./skills`; `private: true` until an npm publish decision.
- Install via `pi install /home/ubuntu/projects/language-coach` (local path:
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
- `pi install /home/ubuntu/projects/language-coach` → registered in
  `~/.pi/agent/settings.json` packages as `../../projects/language-coach`;
  `pi list` shows it as a user package.
- Old symlinks removed (`~/.pi/agent/extensions/language-coach.ts`,
  `~/.pi/agent/skills/language-interview`); `pi list` shows exactly one load
  path, so no double overlay.
- End-to-end: headless `pi -p "hello"` from `/tmp` → reply starts with the
  `> 🎓` coach block (overlay injected via the package load).
- Commit `9f6c08f` (manifest + rename + README + this record).

## Notes
- The running session still uses the old symlink-loaded extension until the
  next pi start; verify the package load then.
- Verified 2026-09-24: package load confirmed in a fresh headless session.
- `private: true` prevents accidental npm publish; remove when the publish
  decision is made. Publishing would also warrant a LICENSE file and a
  versioned release flow.
