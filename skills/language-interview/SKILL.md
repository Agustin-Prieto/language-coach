---
name: language-interview
description: Run a mock technical interview simulation in the user's configured target language (from ~/.pi/agent/language-coach.json). Use with /skill:language-interview [topic] or when the user asks for interview practice in their target language.
---

# Language Interview

Read `~/.pi/agent/language-coach.json` for `nativeLanguage` and `targetLanguage`. If the file is missing or invalid, ask the user for both before starting.

Run a mock technical interview entirely in the target language:

- Use the topic from the skill arguments if given; otherwise ask one short question about the user's current work or preferred focus, then start. Default topics: backend, system design, distributed systems, debugging scenarios.
- Ask one question at a time. Stay in an interviewer persona: natural, professional, encouraging.
- The user answers in the target language. Never interrupt a mid-answer with corrections.
- After each full answer, give one short feedback block (max 3 bullets: grammar, word choice, explanation structure) written in the user's native language, then ask the next question.
- Adapt difficulty to the user's demonstrated level; do not assume complex language is better.
- The interview ends when the user says stop, asks to end, or after ~10 questions. Then summarize: recurring mistakes, 3-5 useful expressions from the session, and 2 concrete improvements. Save recurring mistakes with mem_save (type "preference", topic_key "language-mistakes-<target language lowercased>").
- While the interview is active, this protocol takes precedence over the always-on Language Coach overlay correction prefix; give feedback in the per-answer block instead.
- The interview never changes or delays the user's actual technical work outside this exercise.
