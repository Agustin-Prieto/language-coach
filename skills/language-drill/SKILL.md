---
name: language-drill
description: Run a short targeted drill of the user's most frequent corrected mistakes in their target language, built from the coach log and mistake history. Use with /skill:language-drill [count] or when the user asks to practice their recurring mistakes.
---

# Language Drill

Read `~/.pi/agent/language-coach.json` for `nativeLanguage` and `targetLanguage`. If the file is missing or invalid, tell the user to run /language first and stop.

Build the drill from real data:
- Read `~/.pi/agent/language-coach-log.jsonl`. From entries with `"kind":"correction"`, collect the `**bold**` spans and rank them by frequency. Ignore single-character spans and pure numbers. Order ties by first appearance in the log; small ranking variations between runs are acceptable. If there are no corrections yet, say so and suggest /skill:language-interview instead.
- Optionally search Engram memories with topic_key `language-mistakes-<target language lowercased>` and merge any recurring-mistake notes with the log spans.
- Read `~/.pi/agent/language-coach-vocab.jsonl` (captured phrases: `{ ts, phrase, translation, source }`) and `~/.pi/agent/language-coach-vocab-reviews.jsonl` (review records: `{ ts, phrase, correct }`). A phrase is due for review when it has never been reviewed or the days since its last correct review have reached its interval: [2,4,7,14,30] days by consecutive-correct streak (clamped to the last interval); a miss resets the streak and the phrase is due again after 1 day.

Run the drill:
- Default 5 exercises. If the skill argument sets a count, clamp it to the 1–10 range.
- Each exercise: one short, natural sentence scenario in the user's native language that specifically tempts one of the top mistakes (false friend, tense, article, preposition, etc.). The user writes the sentence in the target language.
- One exercise at a time. After each answer: mark it correct, or show the corrected sentence with the changed words in **bold**, plus a short explanation in the native language (max 2 sentences). When a miss matches one of the drill's top-error spans, also read `~/.pi/agent/language-coach-tips.jsonl` (learned tips: `{ ts, span, tip }`) and quote the most frequent recorded tip for that span as `Recorded tip: ...` after the corrected sentence, when present. Do not introduce corrections beyond the target mistake unless the sentence is clearly wrong.
- Mix exercises: roughly half mistake drills, half due-vocab exercises (when any are due). A vocab exercise gives the user's original sentence that contained the phrase — their original native-language sentence if reconstructable from context, otherwise a natural native-language sentence using its gloss — and asks the user to produce the English phrase. If the user cannot, offer one hint (first word + number of words) before accepting a revealed answer as incorrect.
- Keep score of first-try correct answers.
- At the end: summary with the score, which mistakes recurred, and one tip per recurring mistake. Save recurring mistakes with mem_save (type "preference", topic_key "language-mistakes-<target language lowercased>"). If mem_save is unavailable or fails, finish the summary anyway and say the mistake notes could not be saved.
- After the summary, append one review record per vocab exercise to `~/.pi/agent/language-coach-vocab-reviews.jsonl` via bash (`echo '<json>' >> ~/.pi/agent/language-coach-vocab-reviews.jsonl`), format `{"ts":"<ISO>","phrase":"<phrase>","correct":true|false}`. If any file write fails, finish the summary anyway and say the review records could not be saved.
- While the drill is active, skip the always-on Language Coach overlay prefix entirely (no 🎓 coach block); all feedback happens in the per-exercise feedback instead.
- The drill never changes or delays the user's actual technical work outside this exercise.
