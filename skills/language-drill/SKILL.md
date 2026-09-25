---
name: language-drill
description: Run a short targeted drill of the user's most frequent corrected mistakes in their target language, built from the coach log and mistake history. Use with /skill:language-drill [count] or when the user asks to practice their recurring mistakes.
---

# Language Drill

Read `~/.pi/agent/language-coach.json` for `nativeLanguage` and `targetLanguage`. If the file is missing or invalid, tell the user to run /language first and stop.

Build the drill from real data:
- Read `~/.pi/agent/language-coach-log.jsonl`. From entries with `"kind":"correction"`, collect the `**bold**` spans and rank them by frequency. Ignore single-character spans and pure numbers. Order ties by first appearance in the log; small ranking variations between runs are acceptable. If there are no corrections yet, say so and suggest /skill:language-interview instead.
- Optionally search Engram memories with topic_key `language-mistakes-<target language lowercased>` and merge any recurring-mistake notes with the log spans.

Run the drill:
- Default 5 exercises. If the skill argument sets a count, clamp it to the 1–10 range.
- Each exercise: one short, natural sentence scenario in the user's native language that specifically tempts one of the top mistakes (false friend, tense, article, preposition, etc.). The user writes the sentence in the target language.
- One exercise at a time. After each answer: mark it correct, or show the corrected sentence with the changed words in **bold**, plus a short explanation in the native language (max 2 sentences). Do not introduce corrections beyond the target mistake unless the sentence is clearly wrong.
- Keep score of first-try correct answers.
- At the end: summary with the score, which mistakes recurred, and one tip per recurring mistake. Save recurring mistakes with mem_save (type "preference", topic_key "language-mistakes-<target language lowercased>"). If mem_save is unavailable or fails, finish the summary anyway and say the mistake notes could not be saved.
- While the drill is active, skip the always-on Language Coach overlay prefix entirely (no 🎓 coach block); all feedback happens in the per-exercise feedback instead.
- The drill never changes or delays the user's actual technical work outside this exercise.
