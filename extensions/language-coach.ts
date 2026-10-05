import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import type { TUI, TuiMouseEvent, TuiMouseEventResult } from "@earendil-works/pi-tui";
import {
	CARD_TONE,
	renderCard,
	type Card,
} from "gentle-shell-lib/shell-card.ts";
import { sidebarState, type SidebarRail } from "gentle-shell-lib/shell-sidebar.ts";
import { installSidebar, invalidateSidebar } from "gentle-shell-lib/shell-sidebar-layout.ts";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
// Static type-only import: erased at runtime, so a missing/broken engine
// package can never break extension loading. The runtime module is loaded
// lazily via loadEngine(); null means "engine unavailable — degrade to the
// legacy behavior" (no 🏷️ protocol, no directives, no engine events).
import type * as EngineModule from "@language-coach/engine";

type CoachMode = "on" | "productivity" | "off";

interface CoachConfig {
	nativeLanguage: string;
	targetLanguage: string;
	mode: CoachMode;
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "language-coach.json");
const LOG_PATH = join(homedir(), ".pi", "agent", "language-coach-log.jsonl");
const DIGEST_PATH = join(homedir(), ".pi", "agent", "language-coach-digest.md");
const VOCAB_PATH = join(homedir(), ".pi", "agent", "language-coach-vocab.jsonl");
const VOCAB_REVIEWS_PATH = join(homedir(), ".pi", "agent", "language-coach-vocab-reviews.jsonl");
const TIPS_PATH = join(homedir(), ".pi", "agent", "language-coach-tips.jsonl");
const EXPORT_PATH = join(homedir(), ".pi", "agent", "language-coach-export.json");
const EXPORT_SCHEMA = "language-coach-export/v1";

// Engine data directory (Learner Model v2): events.jsonl + learner.json +
// pending-patterns.jsonl live here. The adapter owns all paths; the engine
// never hardcodes one. The legacy language-coach-*.jsonl files above stay
// exactly as they are — the engine log is a separate, append-only store.
const ENGINE_DATA_DIR = join(homedir(), ".pi", "agent", "language-coach");

type EngineApi = typeof EngineModule;
let engineModule: EngineApi | null | undefined;

async function loadEngine(): Promise<EngineApi | null> {
	if (engineModule !== undefined) return engineModule;
	try {
		engineModule = (await import("@language-coach/engine")) as EngineApi;
	} catch (error) {
		engineModule = null;
		// Load failures are cached; surface once, never break the session.
		console.error(`[language-coach] engine unavailable, coach degrades to legacy behavior: ${String(error)}`);
	}
	return engineModule;
}

function debugLog(message: string): void {
	if (process.env.GENTLE_PI_COACH_DEBUG) console.error(`[language-coach] ${message}`);
}
const MODES: readonly CoachMode[] = ["on", "productivity", "off"];
let warnedAboutConfig = false;

// Subagent children run as `pi --mode rpc` and inherit globally installed
// extensions, so every coach hook fires in them too. The coach is a
// main-session concern: overlay injection, data capture, and TUI surfaces
// are all gated on the main interactive session (mode "tui").
function isMainSession(ctx: ExtensionContext): boolean {
	return ctx.mode === "tui";
}

function loadConfig(): CoachConfig | null {
	try {
		if (!existsSync(CONFIG_PATH)) return null;
		const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as Record<string, unknown>;
		if (typeof raw.nativeLanguage !== "string" || typeof raw.targetLanguage !== "string") return null;
		const mode: CoachMode = MODES.includes(raw.mode as CoachMode) ? (raw.mode as CoachMode) : "on";
		return { nativeLanguage: raw.nativeLanguage, targetLanguage: raw.targetLanguage, mode };
	} catch (error) {
		if (!warnedAboutConfig) {
			warnedAboutConfig = true;
			// Deferred notify is not available here; surface via setStatus instead.
			console.error(`[language-coach] invalid config at ${CONFIG_PATH}: ${String(error)}`);
		}
		return null;
	}
}

function saveConfig(config: CoachConfig): void {
	writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * Engine-derived overlay additions, computed once per turn (best effort):
 * the closed pattern-id list the model may classify against, and the policy
 * directive lines rendered from the learner model. Null when the engine is
 * unavailable or fails — the overlay then degrades to today's shape.
 */
interface OverlayEngineContext {
	patternIds: string[];
	directives: string[];
}

function buildOverlay(config: CoachConfig, engineContext: OverlayEngineContext | null = null): string {
	const { nativeLanguage: native, targetLanguage: target } = config;
	const targetLower = target.toLowerCase();
	const lines = [
		`## Language Coach (native: ${native} → target: ${target})`,
		`The user is a native ${native} speaker practicing professional ${target} for software engineering work.`,
		`- Coach block: START every reply with a blockquote block (consecutive lines starting with "> ") exactly in this shape, then a horizontal rule (---) on its own line, then a blank line, then the main response:\n  > 🎓 "the user's original message, verbatim, natural-language part only (skip code, commands, paths, logs)"\n  >\n  > ✏️ "the corrected sentence in ${target}, with the changed words wrapped in **bold**". After the ✏️ line, when the correction reveals a generalizable pattern, add one more blockquote line: > 💡 <tip about the pattern, max 12 words> — only for reusable rules, never for typos or one-off mistakes.\n  For ${native}-language input, use > 🌐 on the first line and put the natural, professional ${target} translation on the ✏️ line instead of a correction. After the ✏️ line, if the translation contains 1–2 notable multi-word ${target} phrases worth keeping, add one more blockquote line per phrase: > 📚 "the phrase" — ${native} gloss (never for single words, never more than two). The coach block is an explicit exception to any reply-language rule. Never translate word-by-word.${engineContext ? classificationInstruction(engineContext) : ""}`,
		`- If the user's ${target} message is already natural: keep the 🎓 echo line, and on the ✏️ line say it is correct and optionally give at most one more natural alternative, bolding the changed words. If no alternative adds value, say so briefly. Do not invent corrections.`,
		`- If the user writes in any other language: reply in that language; no coaching.`,
		`- Never translate or rewrite code, commands, identifiers, logs, file paths, commit messages, or delegated artifacts.`,
		`- Coach ONLY the user's latest natural-language message; never quote or coach your own thinking, tool output, or partial/steered responses; when there is no new user message, write no coach block.`,
		`- Coaching is one coach block max; never let it delay or reshape the technical task. The echo line quotes the user's own words; never quote code or file paths in it.`,
		`- On noticing a recurring mistake, save one short line with mem_save (type "preference", topic_key "language-mistakes-${targetLower}").`,
		`- When the user asks for a review or progress report: read the recent entries in ${LOG_PATH} and search memories with that topic_key, then summarize compactly: recurring mistakes, weekly correction volume, what improved, and 2-3 focus points for the coming period.`,
	];
	if (engineContext && engineContext.directives.length > 0) {
		lines.push(
			`- Learner-model directives (computed deterministically by the coach engine; follow them, never re-derive or re-score):\n${engineContext.directives.map((directive) => `  - ${directive}`).join("\n")}`,
		);
	}
	if (config.mode === "productivity") {
		lines.push(`(productivity mode: give only the coach block, with no alternatives or commentary.)`);
	}
	return lines.join("\n");
}

/**
 * 🏷️ classification instruction appended to the coach-block bullet when the
 * engine is available. Rides the existing coach block: the model classifies
 * each real correction against the closed pattern list (plus active/due ids
 * from the learner model); translations and already-correct replies never
 * carry a 🏷️ line.
 */
function classificationInstruction(engineContext: OverlayEngineContext): string {
	const ids = engineContext.patternIds.join(", ");
	return ` If the ✏️ line actually changes words, add exactly ONE more blockquote line immediately after it: > 🏷️ pattern: <patternId> | severity: <low|medium|high>. Choose <patternId> ONLY from this list: ${ids} — or the literal uncategorized, and with uncategorized, when a clear reusable pattern exists, append | proposed: <2-4 words> at the end. Never add the 🏷️ line for 🌐 translation replies or when the sentence is already correct.`;
}

/**
 * Compute the overlay's engine additions for one turn. Every step is guarded:
 * any failure (missing engine, unreadable store, broken snapshot) returns
 * null and the coach degrades to today's behavior.
 */
async function overlayEngineContext(config: CoachConfig): Promise<OverlayEngineContext | null> {
	try {
		const engine = await loadEngine();
		if (!engine) return null;
		const seed = { languagePair: { native: config.nativeLanguage, target: config.targetLanguage } };
		const now = new Date();
		const snapshot = await engine.readSnapshot(ENGINE_DATA_DIR);
		let model: EngineModule.LearnerModel;
		if (snapshot) {
			model = snapshot;
		} else {
			// No snapshot: rebuild from the event log (createEmptyModel + fold
			// when the log is empty or missing).
			const store = engine.createEventStore(ENGINE_DATA_DIR);
			const { events } = await store.readEvents();
			model = engine.rebuildEvents(events, seed, now);
		}
		const context = engine.selectContext(model, engine.DEFAULT_CONTEXT_CAPS, now);
		const candidateIds = [
			...new Set([...context.dueMistakes.map((entry) => entry.profile.patternId), ...context.activePatternIds]),
		];
		const patternIds = [...new Set([...engine.listPatternIds(), ...candidateIds])].slice(
			0,
			engine.DEFAULT_CONTEXT_CAPS.maxDueMistakes + engine.DEFAULT_CONTEXT_CAPS.maxActivePatterns,
		);
		const directiveEntries: DirectiveEntry[] = candidateIds
			.slice(0, engine.DEFAULT_CONTEXT_CAPS.maxDueMistakes)
			.map((patternId) => {
				const decision = engine.decideCorrection(model, { patternId }, now);
				const profile = model.mistakes[patternId];
				return {
					patternId,
					action: decision.action,
					masteryPct: profile ? engine.toMasteryPercent(profile.mastery) : null,
				};
			});
		const directives = buildPolicyDirectives(directiveEntries, engine.DEFAULT_CONTEXT_CAPS.maxDueMistakes);
		return { patternIds, directives };
	} catch (error) {
		debugLog(`overlay engine context failed: ${String(error)}`);
		return null;
	}
}

function applyStatus(ctx: ExtensionContext, config: CoachConfig | null): void {
	if (config && config.mode !== "off") {
		ctx.ui.setStatus("language-coach", `${config.nativeLanguage} → ${config.targetLanguage} (${config.mode})`);
	} else {
		ctx.ui.setStatus("language-coach", "");
	}
}

function coachBlockFrom(text: string): { block: string; kind: "correction" | "translation" | "unmarked" } | null {
	const lines = text.split("\n").map((l) => l.trim());
	const start = lines.findIndex((l) => l.length > 0);
	if (start === -1) return null;
	const firstLine = lines[start];
	let kind: "correction" | "translation" | "unmarked" | null = null;
	if (firstLine.startsWith("> 🎓")) kind = "correction";
	else if (firstLine.startsWith("> 🌐")) kind = "translation";
	else if (firstLine.startsWith('"')) kind = "unmarked"; // fallback when the marker is missing
	if (!kind) return null;
	const blockLines = [firstLine];
	if (kind !== "unmarked") {
		for (let i = start + 1; i < lines.length; i++) {
			if (!lines[i].startsWith(">")) break;
			blockLines.push(lines[i]);
		}
	}
	return { block: blockLines.join("\n"), kind };
}

// ---------------------------------------------------------------------------
// Learner Model v2 — classification protocol (pure helpers)
//
// The model classifies each real correction by riding one extra blockquote
// line in the coach block: `> 🏷️ pattern: <id> | severity: <low|medium|high>`
// (optionally ` | proposed: <2-4 words>` when the id is uncategorized). The
// helpers below parse that line and render the policy directives; all event
// creation/persistence goes through the engine (see recordCoachEvents).
// ---------------------------------------------------------------------------

/** Parsed 🏷️ classification line from a coach block. */
export interface ClassificationLine {
	patternId: string;
	severity: "low" | "medium" | "high";
	/** Present only for `uncategorized` lines with a `proposed:` segment. */
	proposed?: string;
}

const CLASSIFICATION_LINE_RE =
	/^> 🏷️\s+pattern:\s*(\S+)\s*\|\s*severity:\s*(low|medium|high)(?:\s*\|\s*proposed:\s*(\S.*?))?\s*$/u;

/** Parse one 🏷️ blockquote line; null when it is not a valid classification line. */
export function parseClassificationLine(line: string): ClassificationLine | null {
	const match = CLASSIFICATION_LINE_RE.exec(line.trim());
	if (!match) return null;
	const proposed = match[3]?.trim();
	return {
		patternId: match[1],
		severity: match[2] as ClassificationLine["severity"],
		...(proposed ? { proposed } : {}),
	};
}

/** Find the (single) 🏷️ classification line in a coach block; null when absent/unparseable. */
export function classificationFromBlock(block: string): ClassificationLine | null {
	for (const line of block.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("> 🏷️")) continue;
		const parsed = parseClassificationLine(trimmed);
		if (parsed) return parsed;
	}
	return null;
}

function stripBold(text: string): string {
	return text.replace(/\*\*/g, "");
}

/** Text after a blockquote marker (e.g. "> 🎓"), or null when the line is absent. */
function blockLineText(block: string, marker: string): string | null {
	for (const line of block.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith(marker)) return trimmed.slice(marker.length).trim();
	}
	return null;
}

function stripWrappingQuotes(text: string): string {
	const trimmed = text.trim();
	return trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2 ? trimmed.slice(1, -1).trim() : trimmed;
}

function normalizeForCompare(text: string): string {
	return stripBold(text)
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase()
		.replace(/[.!?…]+$/, "");
}

/** The learner's original sentence from the 🎓 line (wrapping quotes stripped). */
function originalFromBlock(block: string): string {
	const text = blockLineText(block, "> 🎓");
	return text ? stripWrappingQuotes(text) : "";
}

/** The corrected sentence from the ✏️ line (bold markers and quotes stripped). */
function correctedFromBlock(block: string): string {
	const text = blockLineText(block, "> ✏️");
	return text ? stripBold(stripWrappingQuotes(text)) : "";
}

/**
 * Heuristic: a correction block "actually changes words" when the ✏️ line
 * bolds at least one span AND the bold-stripped ✏️ text differs from the
 * 🎓 original (normalized). Already-correct replies echo or affirm the
 * original, so they compare equal or carry no bold. The overlay instructs
 * the model to bold exactly the changed words.
 */
export function isWordChangingCorrection(block: string): boolean {
	const original = originalFromBlock(block);
	const corrected = blockLineText(block, "> ✏️");
	if (!original || !corrected) return false;
	if (!/\*\*[^*]+\*\*/.test(corrected)) return false;
	return normalizeForCompare(original) !== normalizeForCompare(corrected);
}

/** One capped due/active pattern with its engine decision, ready to render. */
export interface DirectiveEntry {
	patternId: string;
	action: EngineModule.CorrectionAction;
	/** Integer mastery percent from the engine; null when no trusted profile exists. */
	masteryPct: number | null;
}

/**
 * Render the overlay's policy directive lines from engine decisions. Pure:
 * the engine decides the action; this only renders compact prompt prose.
 * Output is capped at `maxLines` (the adapter passes maxDueMistakes).
 */
export function buildPolicyDirectives(entries: readonly DirectiveEntry[], maxLines: number): string[] {
	const lines: string[] = [];
	for (const entry of entries) {
		if (lines.length >= maxLines) break;
		if (entry.masteryPct === null) {
			lines.push(`Pattern "${entry.patternId}": unrecognized — offer a conservative hint.`);
			continue;
		}
		switch (entry.action) {
			case "ignore":
				lines.push(`Pattern "${entry.patternId}": mastery ${entry.masteryPct}% — do not interrupt for this unless asked.`);
				break;
			case "correct":
				lines.push(`Pattern "${entry.patternId}": mastery ${entry.masteryPct}% — actively teach this pattern when it appears.`);
				break;
			case "challenge":
				lines.push(`Pattern "${entry.patternId}": mastery ${entry.masteryPct}% — regressed; challenge with a targeted drill when it appears.`);
				break;
			case "hint":
				lines.push(`Pattern "${entry.patternId}": mastery ${entry.masteryPct}% — give a brief hint when it appears.`);
				break;
		}
	}
	return lines;
}

/** Map a typed engine factory error onto the closed analysis reason codes. */
function rejectionFromFactoryError(
	engine: EngineApi,
	error: unknown,
	timestamp: string,
): EngineModule.AnalysisRejectedEvent {
	const reason: EngineModule.AnalysisReasonCode = error instanceof engine.UnknownPatternError
		? "unknown_pattern"
		: "missing_fields";
	const summary = error instanceof Error ? error.message : String(error);
	return engine.makeAnalysisRejected({ reason, summary }, timestamp);
}

/**
 * Record the engine events for one correction coach block (best effort):
 *
 * - word-changing correction + parseable 🏷️ + registry patternId
 *     → `mistake_detected` (category/severity from the catalog) +
 *       `mistake_corrected`, then the snapshot is refolded and persisted.
 * - 🏷️ `uncategorized` + `proposed`  → pending-store append, NO mistake event
 *     (closed-vocabulary rule); uncategorized without a proposal →
 *     `analysis_rejected` (missing_fields).
 * - missing/unparseable 🏷️, or a patternId outside the registry
 *     → `analysis_rejected` (missing_fields / unknown_pattern).
 * - translations and already-correct replies record nothing.
 *
 * Everything is wrapped so an engine failure can never alter the visible
 * coach behavior; the legacy JSONL append above stays untouched.
 */
async function recordCoachEvents(config: CoachConfig, block: string): Promise<void> {
	try {
		const engine = await loadEngine();
		if (!engine) return;
		if (!isWordChangingCorrection(block)) return;
		const timestamp = new Date().toISOString();
		const classification = classificationFromBlock(block);
		const events: EngineModule.LanguageEvent[] = [];
		if (!classification) {
			events.push(
				engine.makeAnalysisRejected(
					{ reason: "missing_fields", summary: `coach block has no parseable 🏷️ classification line: ${toOneLine(block, 160)}` },
					timestamp,
				),
			);
		} else if (classification.patternId === "uncategorized") {
			if (!classification.proposed) {
				events.push(
					engine.makeAnalysisRejected(
						{ reason: "missing_fields", summary: "uncategorized classification without a proposed pattern" },
						timestamp,
					),
				);
			} else {
				try {
					const result = engine.makeMistakeDetected({
						verdict: "uncategorized",
						proposedPattern: classification.proposed,
						original: originalFromBlock(block),
						timestamp,
					});
					if (result.kind === "pending-proposal") {
						await engine.createPendingStore(ENGINE_DATA_DIR).append(result.proposal);
					}
				} catch (error) {
					events.push(rejectionFromFactoryError(engine, error, timestamp));
				}
			}
		} else {
			try {
				const result = engine.makeMistakeDetected({
					verdict: "classified",
					patternId: classification.patternId,
					severity: classification.severity,
					original: originalFromBlock(block),
					corrected: correctedFromBlock(block),
					timestamp,
				});
				if (result.kind === "event") {
					events.push(result.event);
					events.push(engine.makeMistakeCorrected({ patternId: classification.patternId, timestamp }));
				}
			} catch (error) {
				events.push(rejectionFromFactoryError(engine, error, timestamp));
			}
		}
		if (events.length > 0) {
			const store = engine.createEventStore(ENGINE_DATA_DIR);
			for (const event of events) await store.append(event);
			// Cheapest correct persist: the model is a full fold of the log (no
			// incremental fold exists), so refold once after appending.
			await engine.rebuildSnapshot(
				ENGINE_DATA_DIR,
				{ languagePair: { native: config.nativeLanguage, target: config.targetLanguage } },
				new Date(),
			);
		}
	} catch (error) {
		debugLog(`engine event recording failed: ${String(error)}`);
	}
}

/**
 * Run one `/language drill` session (M4). Deterministic drills only: mistake
 * exercises come from the taxonomy catalog and are graded by code
 * (engine.checkAnswer); vocabulary items are self-graded flashcards. Every
 * answered item is appended as a `drill_completed` event through the engine
 * factory and persisted with a full snapshot refold — exactly like
 * recordCoachEvents' degradation discipline: any persistence failure keeps
 * the drill running but notifies once. The legacy JSONL files are read
 * (stored vocabulary meanings) but never written.
 */
async function runDrillSession(
	ctx: ExtensionContext,
	config: CoachConfig,
	engine: EngineApi,
): Promise<void> {
	const seed = { languagePair: { native: config.nativeLanguage, target: config.targetLanguage } };
	// Load the learner model: cached snapshot, else rebuild from the event log.
	let model: EngineModule.LearnerModel;
	try {
		const snapshot = await engine.readSnapshot(ENGINE_DATA_DIR);
		if (snapshot) {
			model = snapshot;
		} else {
			const store = engine.createEventStore(ENGINE_DATA_DIR);
			const { events } = await store.readEvents();
			model = engine.rebuildEvents(events, seed, new Date());
		}
	} catch (error) {
		ctx.ui.notify(`Language Coach: could not load the learner model (${String(error)})`, "warning");
		return;
	}

	let items: EngineModule.DrillItem[];
	try {
		items = engine.selectDrillItems(model, engine.DRILL_CAPS, new Date());
	} catch (error) {
		ctx.ui.notify(`Language Coach: drill selection failed (${String(error)})`, "warning");
		return;
	}
	if (items.length === 0) {
		ctx.ui.notify("Nothing due — mastery is healthy.", "info");
		return;
	}

	// Stored vocabulary meanings for the self-graded flashcards: read-only
	// lookup in the legacy vocab store (latest translation wins). The engine
	// model carries no translation field, and the legacy files stay untouched.
	const meanings = new Map<string, string>();
	try {
		if (existsSync(VOCAB_PATH)) {
			for (const entry of parseVocabEntries(readFileSync(VOCAB_PATH, "utf8"))) {
				meanings.set(entry.phrase.toLowerCase(), entry.translation);
			}
		}
	} catch {
		// Meanings are a nicety; a failed read just means "no stored translation".
	}

	// Mastery percent per practiced pattern BEFORE the session, for the summary.
	const masteryBefore = new Map<string, number>();
	for (const item of items) {
		if (item.kind !== "mistake") continue;
		const profile = model.mistakes[item.id];
		masteryBefore.set(item.id, profile ? engine.toMasteryPercent(profile.mastery) : 0);
	}

	let attempted = 0;
	let correct = 0;
	const practiced = new Set<string>();
	let saveFailureNotified = false;
	let latestModel = model; // refreshed from each successful snapshot refold
	const store = engine.createEventStore(ENGINE_DATA_DIR);

	for (const item of items) {
		let successful: boolean;
		if (item.kind === "mistake" && item.exercise) {
			ctx.ui.notify(`${item.reason} — pattern: ${item.id}`, "info");
			const answer = await ctx.ui.input(
				item.exercise.cloze,
				item.exercise.hint ? `Hint: ${item.exercise.hint}` : "Type the missing word or phrase",
			);
			if (answer === undefined || answer.trim() === "") break; // cancelled — end the session
			const result = engine.checkAnswer(item, answer);
			attempted++;
			successful = result.correct;
			if (result.correct) {
				correct++;
				ctx.ui.notify("Correct!", "info");
			} else {
				ctx.ui.notify(`Not quite — expected: "${result.expected}"`, "warning");
			}
		} else {
			ctx.ui.notify(`${item.reason} — phrase: ${item.id}`, "info");
			const recall = await ctx.ui.input(`Recall the meaning of: "${item.id}"`, "Freeform recall attempt (not graded)");
			if (recall === undefined) break; // cancelled — end the session
			attempted++;
			const meaning = meanings.get(item.id.toLowerCase());
			successful = await ctx.ui.confirm(
				`Did you recall "${item.id}" correctly?`,
				meaning ? `Stored meaning: ${meaning}` : "No stored translation found for this phrase.",
			);
			if (successful) correct++;
		}
		practiced.add(item.id);

		// Persist after EACH answered item: append the factory-validated event,
		// then refold + write the snapshot. Degrades like recordCoachEvents.
		try {
			await store.append(engine.drillResultEvent(item, successful, new Date().toISOString()));
			const summary = await engine.rebuildSnapshot(ENGINE_DATA_DIR, seed, new Date());
			latestModel = summary.model;
		} catch (error) {
			if (!saveFailureNotified) {
				saveFailureNotified = true;
				ctx.ui.notify("Language Coach: could not save drill progress — the drill continues, but this session may not persist.", "warning");
			}
			debugLog(`drill persistence failed: ${String(error)}`);
		}
	}

	// Summary — every count comes from data, never invented.
	const lines = [
		`Drill session complete: ${attempted} attempted, ${correct} correct, ${practiced.size} pattern${practiced.size === 1 ? "" : "s"} practiced`,
	];
	const masteryChanges: string[] = [];
	for (const patternId of practiced) {
		const before = masteryBefore.get(patternId);
		const profile = latestModel.mistakes[patternId];
		if (before !== undefined && profile) {
			masteryChanges.push(`${patternId} ${before}% → ${engine.toMasteryPercent(profile.mastery)}%`);
		}
	}
	if (masteryChanges.length > 0) lines.push(`Mastery: ${masteryChanges.join(", ")}`);
	if (saveFailureNotified) lines.push("⚠ Some drill results could not be saved");
	ctx.ui.notify(lines.join("\n"), "info");
}

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text" ? String((c as { text?: unknown }).text ?? "") : ""))
			.join("\n");
	}
	return "";
}

function appendLog(config: CoachConfig, block: string, kind: "correction" | "translation" | "unmarked"): void {
	try {
		const entry = { ts: new Date().toISOString(), kind, native: config.nativeLanguage, target: config.targetLanguage, line: block };
		appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
	} catch {
		// Logging must never break the session.
	}
}

interface LogEntry {
	ts: string;
	kind: "correction" | "translation" | "unmarked";
	native: string;
	target: string;
	line: string;
}

interface WeekBucket {
	label: string;
	corrections: number;
	// Monday ISO date (local YYYY-MM-DD) of the bucket start, so consumers
	// (the web app export) can chart without reimplementing week math.
	startISO: string;
}

interface StatsSummary {
	total: number;
	kinds: Record<"correction" | "translation" | "unmarked", number>;
	weeks: WeekBucket[];
	trend: "improving" | "stable" | "rising";
	topCorrections: Array<{ span: string; count: number }>;
	recent: Array<{ kind: string; when: string; line: string }>;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function startOfWeek(date: Date): Date {
	// Monday-based ISO week start, local time.
	const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
	return d;
}

function formatDate(d: Date): string {
	return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// Local-date ISO form (YYYY-MM-DD), not Date.toISOString(): that one is UTC
// and could shift a local Monday to Sunday in offsets behind UTC.
function toISODate(d: Date): string {
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${mm}-${dd}`;
}

function formatDayTime(d: Date): string {
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return `${formatDate(d)} ${hh}:${mm}`;
}

function parseLogDate(ts: string): Date | null {
	// Log entries always write `new Date().toISOString()` (UTC ISO 8601).
	// Parse strictly instead of trusting Date's lenient, implementation-defined
	// fallbacks ("Sep 22 2026", "2026-09-22 19:01", etc.).
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(ts)) return null;
	const d = new Date(ts);
	return Number.isNaN(d.getTime()) ? null : d;
}

function toOneLine(text: string, max = 80): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function extractBoldSpans(line: string): string[] {
	const spans: string[] = [];
	const re = /\*\*([^*]+)\*\*/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(line)) !== null) spans.push(match[1].toLowerCase());
	return spans;
}

function parseLogEntries(raw: string): { entries: LogEntry[]; skipped: number } {
	const entries: LogEntry[] = [];
	let skipped = 0;
	for (const line of raw.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		try {
			const parsed = JSON.parse(t) as Record<string, unknown>;
			if (
				typeof parsed.ts === "string" &&
				(parsed.kind === "correction" || parsed.kind === "translation" || parsed.kind === "unmarked") &&
				typeof parsed.line === "string"
			) {
				entries.push({
					ts: parsed.ts,
					kind: parsed.kind,
					native: typeof parsed.native === "string" ? parsed.native : "",
					target: typeof parsed.target === "string" ? parsed.target : "",
					line: parsed.line,
				});
			} else {
				skipped++;
			}
		} catch {
			// Malformed lines never break stats (R3-003), but they are counted
			// so the summary can surface data-quality issues.
			skipped++;
		}
	}
	return { entries, skipped };
}

export function aggregateStats(entries: LogEntry[]): StatsSummary {
	const kinds = { correction: 0, translation: 0, unmarked: 0 };
	const currentWeekStart = startOfWeek(new Date());
	const weekStarts: Date[] = [];
	// 4 displayed buckets [current-21d … current] plus one DST-safe upper
	// bound for the current week (current+7d), used only as weekStarts[4].
	// All boundaries built with setDate so they follow local-time rules;
	// fixed WEEK_MS arithmetic is not, per review finding R3-002.
	for (let i = 3; i >= 0; i--) {
		const ws = new Date(currentWeekStart);
		ws.setDate(ws.getDate() - 7 * i);
		weekStarts.push(ws);
	}
	const currentWeekEnd = new Date(currentWeekStart);
	currentWeekEnd.setDate(currentWeekEnd.getDate() + 7);
	weekStarts.push(currentWeekEnd);
	const weeks: WeekBucket[] = weekStarts.slice(0, 4).map((ws) => {
		const we = new Date(ws);
		we.setDate(we.getDate() + 6);
		return { label: `${formatDate(ws)}–${formatDate(we)}`, corrections: 0, startISO: toISODate(ws) };
	});

	const spanCounts = new Map<string, number>();
	for (const entry of entries) {
		kinds[entry.kind]++;
		if (entry.kind !== "correction") continue;
		const date = parseLogDate(entry.ts);
		if (date) {
			const t = date.getTime();
			for (let i = 0; i < 4; i++) {
				if (t >= weekStarts[i].getTime() && t < weekStarts[i + 1].getTime()) {
					weeks[i].corrections++;
					break;
				}
			}
		}
		for (const span of extractBoldSpans(entry.line)) {
			spanCounts.set(span, (spanCounts.get(span) ?? 0) + 1);
		}
	}

	const [w0, w1, w2, current] = weeks.map((w) => w.corrections);
	const avgPrevious = (w0 + w1 + w2) / 3;
	let trend: "improving" | "stable" | "rising" = "stable";
	if (avgPrevious > 0) {
		if (current < 0.7 * avgPrevious) trend = "improving";
		else if (current > 1.3 * avgPrevious) trend = "rising";
	} else if (current > 0) {
		trend = "rising";
	}

	const topCorrections = [...spanCounts.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([span, count]) => ({ span, count }));

	const recent = entries.slice(-5).map((e) => {
		const date = parseLogDate(e.ts);
		return { kind: e.kind, when: date ? formatDayTime(date) : "?", line: toOneLine(e.line) };
	});

	return { total: entries.length, kinds, weeks, trend, topCorrections, recent };
}

function renderStats(stats: StatsSummary): string {
	const kindLine = `${stats.kinds.correction} corrections, ${stats.kinds.translation} translations, ${stats.kinds.unmarked} unmarked`;
	const weeksLine = stats.weeks.map((w) => `${w.label}: ${w.corrections}`).join(" | ");
	const avgPrevious = (stats.weeks[0].corrections + stats.weeks[1].corrections + stats.weeks[2].corrections) / 3;
	const topLine = stats.topCorrections.length
		? stats.topCorrections.map((t) => `"${t.span}" ×${t.count}`).join(", ")
		: "none recorded";
	const lines = [
		`Language Coach stats — ${stats.total} blocks (${kindLine})`,
		`Corrections by week: ${weeksLine}`,
		`Trend: ${stats.trend} (this week ${stats.weeks[3].corrections} vs avg ${avgPrevious.toFixed(1)} of previous 3)`,
		`Top corrections: ${topLine}`,
	];
	if (stats.recent.length > 0) {
		lines.push("Recent:");
		for (const r of stats.recent) lines.push(`  [${r.kind}] ${r.when} — ${r.line}`);
	}
	return lines.join("\n");
}

interface VocabCapture {
	ts: string;
	phrase: string;
	translation: string;
}

interface VocabReview {
	ts: string;
	phrase: string;
	correct: boolean;
}

interface VocabStatus {
	phrase: string;
	translation: string;
	lastCorrect: string | null;
	streak: number;
	due: boolean;
}

// Spaced-repetition intervals (days) indexed by consecutive-correct streak,
// clamped to the last entry.
const VOCAB_INTERVALS = [2, 4, 7, 14, 30];
const DAY_MS = 24 * 60 * 60 * 1000;

// Capture 📚 vocab lines from an assistant reply. Mechanical parse of the
// overlay's optional third coach-block line: `> 📚 "english phrase" — gloss`.
function vocabFromText(text: string): Array<{ phrase: string; translation: string }> {
	const found: Array<{ phrase: string; translation: string }> = [];
	for (const line of text.split("\n")) {
		const t = line.trim();
		if (!t.startsWith("> 📚")) continue;
		const match = /^> 📚\s+"([^"]+)"\s+—\s+(.+)$/.exec(t);
		if (!match) continue;
		const phrase = match[1].trim();
		const translation = match[2].trim();
		// Phrases must be multi-word and non-empty; the gloss must be non-empty.
		if (!phrase || !phrase.includes(" ") || !translation) continue;
		found.push({ phrase, translation });
	}
	return found;
}

function appendVocab(entries: Array<{ phrase: string; translation: string }>): void {
	try {
		for (const e of entries) {
			const entry = { ts: new Date().toISOString(), phrase: e.phrase, translation: e.translation, source: "translation" as const };
			appendFileSync(VOCAB_PATH, `${JSON.stringify(entry)}\n`, "utf8");
		}
	} catch {
		// Vocab capture must never break the session.
	}
}

function parseVocabEntries(raw: string): VocabCapture[] {
	const entries: VocabCapture[] = [];
	for (const line of raw.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		try {
			const parsed = JSON.parse(t) as Record<string, unknown>;
			if (typeof parsed.ts === "string" && typeof parsed.phrase === "string" && typeof parsed.translation === "string") {
				entries.push({ ts: parsed.ts, phrase: parsed.phrase, translation: parsed.translation });
			}
		} catch {
			// Malformed lines never break the vocab summary.
		}
	}
	return entries;
}

interface TipRecord {
	ts: string;
	span: string;
	tip: string;
}

interface TipCapture {
	span: string;
	tip: string;
}

// Capture 💡 tip lines from a correction coach block, pairing each tip with
// the first **bold** span of the block's ✏️ line (same regex family as
// extractBoldSpans). Blocks without 💡 lines or without a bold span capture
// nothing.
function tipsFromBlock(block: string): TipCapture[] {
	const lines = block.split("\n").map((l) => l.trim());
	const editLine = lines.find((l) => l.startsWith("> ✏️"));
	if (!editLine) return [];
	const bold = /\*\*([^*]+)\*\*/.exec(editLine);
	if (!bold) return [];
	const span = bold[1].trim();
	if (!span) return [];
	const tips: TipCapture[] = [];
	for (const line of lines) {
		const match = /^> 💡\s*(.+)$/.exec(line);
		if (!match) continue;
		const tip = match[1].trim();
		if (!tip || tip.length > 120) continue;
		tips.push({ span, tip });
	}
	return tips;
}

function appendTips(entries: TipCapture[]): void {
	try {
		for (const e of entries) {
			const entry = { ts: new Date().toISOString(), span: e.span, tip: e.tip };
			appendFileSync(TIPS_PATH, `${JSON.stringify(entry)}\n`, "utf8");
		}
	} catch {
		// Tip capture must never break the session.
	}
}

function parseTipEntries(raw: string): TipRecord[] {
	const entries: TipRecord[] = [];
	for (const line of raw.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		try {
			const parsed = JSON.parse(t) as Record<string, unknown>;
			if (typeof parsed.ts === "string" && typeof parsed.span === "string" && typeof parsed.tip === "string") {
				entries.push({ ts: parsed.ts, span: parsed.span, tip: parsed.tip });
			}
		} catch {
			// Malformed lines never break the rail.
		}
	}
	return entries;
}

// Pure lookup: the most frequent tip recorded for a span (case-insensitive
// span match); ties break toward the most recent record. Returns undefined
// when no tip was recorded for the span.
export function topTipFor(span: string, tips: TipRecord[]): string | undefined {
	const target = span.toLowerCase();
	const stats = new Map<string, { count: number; last: number }>();
	for (let i = 0; i < tips.length; i++) {
		const record = tips[i];
		if (record.span.toLowerCase() !== target) continue;
		const existing = stats.get(record.tip);
		if (existing) {
			existing.count++;
			existing.last = i;
		} else {
			stats.set(record.tip, { count: 1, last: i });
		}
	}
	let best: { tip: string; count: number; last: number } | undefined;
	for (const [tip, s] of stats) {
		if (!best || s.count > best.count || (s.count === best.count && s.last > best.last)) {
			best = { tip, count: s.count, last: s.last };
		}
	}
	return best?.tip;
}

function parseVocabReviews(raw: string): VocabReview[] {
	const reviews: VocabReview[] = [];
	for (const line of raw.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		try {
			const parsed = JSON.parse(t) as Record<string, unknown>;
			if (typeof parsed.ts === "string" && typeof parsed.phrase === "string" && typeof parsed.correct === "boolean" && parseLogDate(parsed.ts)) {
				reviews.push({ ts: parsed.ts, phrase: parsed.phrase, correct: parsed.correct });
			}
		} catch {
			// Malformed lines never break the vocab summary.
		}
	}
	return reviews;
}

// Pure scheduling: dedupe captures by phrase (most recent translation wins),
// replay reviews chronologically to compute the consecutive-correct streak,
// and mark a phrase due when it was never reviewed or the interval since its
// last correct review has elapsed. A miss (latest review incorrect) resets
// the streak to 0 and makes the phrase due again after one day.
function vocabSchedule(entries: VocabCapture[], reviews: VocabReview[], now: Date): VocabStatus[] {
	const latestTranslation = new Map<string, string>();
	for (const e of entries) latestTranslation.set(e.phrase, e.translation);
	const byPhrase = new Map<string, VocabReview[]>();
	for (const r of reviews) {
		const list = byPhrase.get(r.phrase);
		if (list) list.push(r);
		else byPhrase.set(r.phrase, [r]);
	}
	return [...latestTranslation.entries()].map(([phrase, translation]) => {
		const list = byPhrase.get(phrase) ?? [];
		let streak = 0;
		let lastCorrect: string | null = null;
		for (const r of list) {
			if (r.correct) {
				streak++;
				lastCorrect = r.ts;
			} else {
				streak = 0;
			}
		}
		if (list.length === 0) {
			return { phrase, translation, lastCorrect, streak, due: true };
		}
		const latest = list[list.length - 1];
		if (!latest.correct) {
			const sinceMiss = now.getTime() - (parseLogDate(latest.ts)?.getTime() ?? now.getTime());
			return { phrase, translation, lastCorrect, streak: 0, due: Math.floor(sinceMiss / DAY_MS) >= 1 };
		}
		// First correct review (streak 1) schedules the next review in 2 days;
		// each further consecutive correct advances through [4, 7, 14, 30].
		const interval = VOCAB_INTERVALS[Math.min(Math.max(streak - 1, 0), VOCAB_INTERVALS.length - 1)];
		const sinceCorrect = now.getTime() - (parseLogDate(lastCorrect ?? latest.ts)?.getTime() ?? now.getTime());
		return { phrase, translation, lastCorrect, streak, due: Math.floor(sinceCorrect / DAY_MS) >= interval };
	});
}

// ---------------------------------------------------------------------------
// Persistent dashboard rail (gentle-shell fullscreen sidebar)
// ---------------------------------------------------------------------------

// Terminal whose sidebar the coach mounted (for invalidation and shutdown).
let railTui: TUI | undefined;
// Registered collapse keybinding (set by the extension entry point before any
// mount can happen); undefined means click-only, no hint in the top rule.
let railKeybinding: string | undefined;
// Rail collapse and title-control hover state. The rail is a singleton per
// terminal (component-local), and both reset on session_shutdown.
let railCollapsed = false;
let railHovered = false;

function toggleCoachRail(): void {
	railCollapsed = !railCollapsed;
	// The digest carries the collapsed flag, so the next frame re-renders the
	// section; requestRender is what produces that frame.
	try {
		railTui?.requestRender();
	} catch {
		// Toggling must never break the session.
	}
}

// The setWidget component factory is the only non-interactive hook through
// which tui/theme first become reachable (the same idiom gentle-shell uses
// with setFooter), so the rail mounts through it once per terminal. The
// factory runs synchronously inside setWidget and the empty widget is
// cleared right after, so nothing is painted above the editor: the status
// widget was retired here in favor of the persistent rail (2026-09-25).
function mountCoachRail(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;
	try {
		ctx.ui.setWidget("language-coach", (tui, theme) => {
			mountCoachSidebar(tui, theme);
			return {
				render() {
					return [];
				},
				invalidate() {},
			};
		});
		ctx.ui.setWidget("language-coach", undefined);
	} catch {
		// Rail mount is best-effort; the session works without it.
	}
}
// gentle-shell stores sidebar state on the terminal, so the coach's marker
// lives there too: extension hosts may isolate modules, while Pi keeps the
// terminal across sessions and regular/fullscreen transitions.
const COACH_SIDEBAR_MARKER = Symbol.for("language-coach.sidebar.marker");

// The fullscreen layout only renders the hardcoded rail section keys
// "footer" / "agents" / "todo" (shell-sidebar-layout.ts prepare()); a custom
// key like "language-coach" would never paint. "agents" is not registered by
// any shipped gentle-shell extension, so the coach uses it in both ownership
// modes: alone when it owns the sidebar, or as one more part next to
// gentle-shell's "footer" shell bar when that extension is running.
const RAIL_PART_KEY = "agents";

// Rail collapse keybinding, mirroring the Todos box's mechanism: a registered
// shortcut (default ctrl+shift+l; GENTLE_PI_COACH_KEY overrides, "" or "off"
// disables) plus a click on the title control. ctrl+shift+l is free: pi's
// built-ins claim ctrl+shift+up/down/f/g, gentle-shell claims ctrl+shift+t
// (Todos) and ctrl+shift+a (Agents).
const RAIL_COLLAPSE_KEY_DEFAULT = "ctrl+shift+l";

function railCollapseKey(env: NodeJS.ProcessEnv): string | undefined {
	const value = env.GENTLE_PI_COACH_KEY?.trim();
	if (value === undefined) return RAIL_COLLAPSE_KEY_DEFAULT;
	return value === "" || value.toLowerCase() === "off" ? undefined : value;
}

interface CoachSidebarMarker {
	installed: boolean;
	part: SidebarRail | undefined;
	uninstall: (() => void) | undefined;
}

function coachSidebarMarker(tui: TUI): CoachSidebarMarker {
	const terminal = tui.terminal as unknown as Record<symbol, CoachSidebarMarker | undefined>;
	const existing = terminal[COACH_SIDEBAR_MARKER];
	if (existing) return existing;
	const created: CoachSidebarMarker = { installed: false, part: undefined, uninstall: undefined };
	terminal[COACH_SIDEBAR_MARKER] = created;
	return created;
}

// Cheap digest of the live data the rail paints: file sizes and mtimes. The
// fullscreen layout memo re-renders a part only when its digest changes, so
// a change to any of the three data files repaints the rail without an
// explicit invalidation (invalidateSidebar on message_end covers same-mtime
// writes).
function fileSignature(path: string): string {
	try {
		if (!existsSync(path)) return "0";
		const stats = statSync(path);
		return `${stats.size}:${stats.mtimeMs}`;
	} catch {
		return "0";
	}
}

function coachDigest(): string {
	// Collapsed and hovered ride along so toggling or hovering the title
	// control repaints through the section memo without bumping the shared
	// sidebar revision (which would re-render every rail section).
	return `${[LOG_PATH, VOCAB_PATH, VOCAB_REVIEWS_PATH, TIPS_PATH].map(fileSignature).join("|")}|${railCollapsed ? "1" : "0"}${railHovered ? "1" : "0"}`;
}

function mountCoachSidebar(tui: TUI, theme: Theme): void {
	if (!tui.terminal) return;
	const marker = coachSidebarMarker(tui);
	if (marker.installed) return;
	marker.installed = true;
	railTui = tui;
	const state = sidebarState(tui);
	// gentle-shell owns the sidebar when its shell bar part is already
	// registered or the fullscreen layout is active; the coach then only adds
	// its own part so both rails coexist. installSidebar is not re-entrant
	// safe (a second call stacks a second layout override and interval), so it
	// must be skipped when another owner is present.
	const gentleShellOwns = state.parts.has("footer") || state.active;
	if (!gentleShellOwns) {
		try {
			marker.uninstall = installSidebar(tui, theme);
		} catch {
			// Without the layout hook the rail part stays registered; it simply
			// paints only if another owner's layout picks it up.
			marker.uninstall = undefined;
		}
	}
	const rail: SidebarRail = {
		render(width: number): string[] {
			try {
				return renderCard(
					coachCard(loadPanelData(), theme, width, { collapsed: railCollapsed, hovered: railHovered, collapseKey: railKeybinding }),
					theme,
					width,
					{ expanded: true, hint: collapseHint(railKeybinding, railCollapsed) },
				);
			} catch {
				// The rail must never take the sidebar layout down.
				return [];
			}
		},
		invalidate() {
			railHovered = false;
		},
		digest() {
			try {
				return coachDigest();
			} catch {
				return "";
			}
		},
		// Mouse wiring mirrors the Todos card's NativePointerRegion: the whole
		// title row (y === 0) is the control -- hovering paints the shared hover
		// role, a left click toggles collapse. The fullscreen layout's
		// dispatchPartMouse delivers section-relative coordinates, and hover
		// clears on invalidate or a move elsewhere in the card (the same
		// no-leave-into-the-transcript limitation the Todos control has).
		handleMouse(event: unknown): TuiMouseEventResult | undefined {
			try {
				const mouse = event as TuiMouseEvent;
				if (mouse.type === "move" && mouse.button === "none") {
					const next = mouse.y === 0;
					if (next === railHovered) return { handled: true };
					railHovered = next;
					return { handled: true, render: true };
				}
				if (mouse.type === "click") {
					if (mouse.button !== "left" || mouse.y !== 0) return undefined;
					toggleCoachRail();
					return { handled: true, render: true };
				}
				return undefined;
			} catch {
				// Mouse handling must never throw into the layout dispatch.
				return undefined;
			}
		},
	};
	try {
		state.parts.set(RAIL_PART_KEY, rail);
		marker.part = rail;
	} catch {
		// Rail registration is best-effort; the session works without it.
	}
}

function unmountCoachSidebar(tui: TUI | undefined): void {
	if (!tui?.terminal) return;
	const marker = coachSidebarMarker(tui);
	if (!marker.installed) return;
	try {
		const state = sidebarState(tui);
		if (marker.part && state.parts.get(RAIL_PART_KEY) === marker.part) state.parts.delete(RAIL_PART_KEY);
		marker.uninstall?.();
	} catch {
		// Unmounting must never break shutdown.
	} finally {
		marker.part = undefined;
		marker.uninstall = undefined;
		marker.installed = false;
		railCollapsed = false;
		railHovered = false;
	}
	if (railTui === tui) railTui = undefined;
}

// ---------------------------------------------------------------------------
// Dashboard card (rail)
// ---------------------------------------------------------------------------

// Inline mirror of gentle-shell's lib/shell-hover.ts: one shared role swap on
// hover for every clickable surface, so the collapse control reads the same
// way as every other clickable text. Not imported because this repo's
// compile-time contract (types/gentle-shell/*.d.ts) does not cover that module.
const HOVER_ROLE = "warning" as const;

function paintHoverable(theme: Theme, text: string, hovered: boolean, idleRole?: ThemeColor): string {
	if (hovered) return theme.fg(HOVER_ROLE, text);
	return idleRole === undefined ? text : theme.fg(idleRole, text);
}

// Right-aligned hint for the card's top rule, mirroring the Todos card:
// `<key> collapse` when expanded, `<key> expand` when collapsed, and no hint
// at all when the keybinding is disabled.
function collapseHint(collapseKey: string | undefined, collapsed: boolean): string | undefined {
	return collapseKey ? `${collapseKey} ${collapsed ? "expand" : "collapse"}` : undefined;
}

const PREPOSITION_SPANS = new Set(["in", "on", "at", "to", "for", "over"]);

// Pure heuristic mapping a recurring corrected span to one short, actionable
// recommendation. No model, no fs: derives everything from the span itself so
// it stays trivially testable.
export function errorRecommendation(span: string, count: number): string {
	if (span === "i") return `Capitalize "I" in every sentence.`;
	if (PREPOSITION_SPANS.has(span)) {
		return `Double-check prepositions — write the phrase, then verify the preposition.`;
	}
	if (span === "let's") return `Use "let's" for suggestions; avoid "let us" in speech.`;
	if (!span.includes(" ") && span.endsWith("ly")) return `Check adjective vs adverb after verbs.`;
	return `Practice "${span}" — it is your most frequent fix (×${count}).`;
}

interface CoachCardOptions {
	collapsed: boolean;
	hovered: boolean;
	collapseKey: string | undefined;
}

// Mirror of the Todos card's collapsedRow(): the most relevant compact line —
// a due phrase when one is due, else this week's summary.
function collapsedCoachRow(data: PanelData): string {
	const due = data.due[0];
	if (due) return `${toOneLine(due.phrase, 30)} — ${toOneLine(due.translation, 30)}`;
	if (data.stats?.weeks.length) return `${data.stats.weeks.at(-1)!.corrections} corrections this week · ${data.stats.trend}`;
	return "no coaching data yet";
}

// Slim, error-focused body (2026-09-25 slim-down): common errors with one
// recommendation each and compact due vocabulary. Weekly buckets, the Recent
// section, and the final Recommendations hint line (removed 2026-09-26) are
// gone; the trend stays visible in the card subtitle and /language stats.
function expandedCoachBody(data: PanelData, width: number): string[] {
	const stats = data.stats;
	const body: string[] = [];
	body.push("", "Common errors");
	const top = stats ? stats.topCorrections.slice(0, 4) : [];
	if (top.length === 0) {
		body.push("  No corrections recorded yet");
	} else {
		for (const t of top) {
			body.push(`  ${toOneLine(t.span, 30)} ×${t.count}`);
			// A learned tip recorded for this span wins over the generic
			// heuristic; both stay on one line within the card width.
			const tip = topTipFor(t.span, data.tips) ?? errorRecommendation(t.span, t.count);
			body.push(`  ${toOneLine(tip, Math.max(12, width - 6))}`);
		}
	}
	body.push("", "Vocabulary");
	if (data.trackedTotal === 0) {
		body.push("  No vocabulary captured yet");
	} else if (data.dueTotal === 0) {
		body.push("  All caught up");
	} else {
		body.push(`  ${data.dueTotal} due now`);
		for (const s of data.due.slice(0, 2)) {
			body.push(`  ${toOneLine(s.phrase, 30)} — ${toOneLine(s.translation, 30)}`);
		}
	}
	return body;
}

function coachCard(data: PanelData, theme: Theme, width: number, options: CoachCardOptions): Card {
	const stats = data.stats;
	// The title control mirrors the Todos card: `▾ Collapse` when expanded,
	// `▸ Expand` when collapsed, the label dropped under width 28, painted in
	// the shared hover role while hovered (idle role matches the INFO title's
	// own accent role).
	const action = options.collapsed ? "expand" : "collapse";
	const actionLabel = action[0]!.toUpperCase() + action.slice(1);
	const icon = options.collapsed ? "▸" : "▾";
	const control = `${icon} ${width >= 28 ? actionLabel : ""}`.trimEnd();
	return {
		title: `Language Coach ${paintHoverable(theme, control, options.hovered, "accent")}`,
		subtitle: stats?.weeks.length ? `${stats.weeks.at(-1)!.corrections} this week · ${stats.trend}` : undefined,
		body: options.collapsed ? [collapsedCoachRow(data)] : expandedCoachBody(data, width),
		tone: CARD_TONE.INFO,
	};
}

interface PanelData {
	stats: StatsSummary | null;
	due: VocabStatus[];
	dueTotal: number;
	trackedTotal: number;
	tips: TipRecord[];
}

function loadPanelData(): PanelData {
	const data: PanelData = { stats: null, due: [], dueTotal: 0, trackedTotal: 0, tips: [] };
	try {
		if (existsSync(LOG_PATH)) {
			const { entries } = parseLogEntries(readFileSync(LOG_PATH, "utf8"));
			if (entries.length > 0) data.stats = aggregateStats(entries);
		}
	} catch {
		// Stats load failure renders the rail's "no data yet" state.
	}
	try {
		if (existsSync(VOCAB_PATH)) {
			const captures = parseVocabEntries(readFileSync(VOCAB_PATH, "utf8"));
			const reviews = existsSync(VOCAB_REVIEWS_PATH) ? parseVocabReviews(readFileSync(VOCAB_REVIEWS_PATH, "utf8")) : [];
			const statuses = vocabSchedule(captures, reviews, new Date());
			data.trackedTotal = statuses.length;
			const dueStatuses = statuses.filter((s) => s.due);
			data.dueTotal = dueStatuses.length;
			data.due = dueStatuses.slice(0, 5);
		}
	} catch {
		// Vocab load failure renders the rail's empty vocab section.
	}
	try {
		if (existsSync(TIPS_PATH)) data.tips = parseTipEntries(readFileSync(TIPS_PATH, "utf8"));
	} catch {
		// Tips load failure falls back to the heuristic recommendations.
	}
	return data;
}

export default function (pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env) {
	const collapseKey = railCollapseKey(env);
	railKeybinding = collapseKey;

	if (collapseKey) {
		pi.registerShortcut(collapseKey as Parameters<ExtensionAPI["registerShortcut"]>[0], {
			description: "Language Coach: collapse or expand the dashboard rail",
			handler: async () => {
				toggleCoachRail();
			},
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig();
		applyStatus(ctx, config && config.mode !== "off" ? config : null);
		if (config && config.mode !== "off" && isMainSession(ctx)) mountCoachRail(ctx);
		else unmountCoachSidebar(railTui);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!isMainSession(ctx)) return undefined;
		const config = loadConfig();
		if (!config || config.mode === "off") return;
		const base = event.systemPrompt ?? "";
		// Best effort: null when the engine is unavailable/failing → today's overlay.
		const engineContext = await overlayEngineContext(config);
		return { systemPrompt: `${base}\n\n${buildOverlay(config, engineContext)}` };
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		// Subagent replies never enter the user's data files.
		if (!isMainSession(ctx)) return;
		const config = loadConfig();
		if (!config || config.mode === "off") {
			unmountCoachSidebar(railTui);
			return;
		}
		// Aborted/steered partials and errored responses are never logged or
		// captured; only a fully completed assistant reply coaches.
		if (event.message.stopReason !== "stop") return;
		const text = textFromContent(event.message.content);
		const coach = coachBlockFrom(text);
		if (coach) {
			appendLog(config, coach.block, coach.kind);
			if (coach.kind === "correction") {
				const tips = tipsFromBlock(coach.block);
				if (tips.length > 0) appendTips(tips);
				// Learner Model v2: record engine events for real corrections.
				// Never throws; a failing engine degrades to legacy behavior.
				await recordCoachEvents(config, coach.block);
			}
		}
		const vocab = vocabFromText(text);
		if (vocab.length > 0) appendVocab(vocab);
		try {
			// Data changed: mark the terminal-owned sidebar output stale so the
			// fullscreen rail repaints on the next frame.
			if (railTui) invalidateSidebar(railTui);
		} catch {
			// Sidebar invalidation is best-effort.
		}
	});

	pi.on("session_shutdown", async () => {
		unmountCoachSidebar(railTui);
	});

	pi.registerCommand("language", {
		description: "Language Coach: show status, run setup, view stats, review vocabulary, run a drill session, write a digest, export a JSON snapshot, rebuild the learner model, or set mode (on | productivity | off)",
		handler: async (args, ctx) => {
			const trimmed = (args ?? "").trim().toLowerCase();

			if (!trimmed) {
				const config = loadConfig();
				if (config) {
					ctx.ui.notify(`Language Coach: ${config.nativeLanguage} → ${config.targetLanguage} (mode: ${config.mode})`, "info");
					return;
				}
				if (!ctx.hasUI) {
					ctx.ui.notify(`Language Coach: no config found at ${CONFIG_PATH}`, "warning");
					return;
				}
				const native = await ctx.ui.input("Language Coach — your native language:", "e.g. Spanish");
				if (!native || !native.trim()) return;
				const target = await ctx.ui.input("Language Coach — language you want to practice:", "e.g. English");
				if (!target || !target.trim()) return;
				const created: CoachConfig = {
					nativeLanguage: native.trim(),
					targetLanguage: target.trim(),
					mode: "on",
				};
				saveConfig(created);
				applyStatus(ctx, created);
				ctx.ui.notify(`Language Coach configured: ${created.nativeLanguage} → ${created.targetLanguage} (mode: on)`, "info");
				return;
			}

			if (trimmed === "stats") {
				const config = loadConfig();
				if (!config) {
					ctx.ui.notify("Run /language first to configure your native and target languages.", "warning");
					return;
				}
				try {
					const raw = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, "utf8") : "";
					if (!raw.trim()) {
						ctx.ui.notify("No coaching data yet", "warning");
						return;
					}
					const { entries, skipped } = parseLogEntries(raw);
					let summary = renderStats(aggregateStats(entries));
					if (skipped > 0) summary += `\n⚠ Skipped ${skipped} malformed log line${skipped === 1 ? "" : "s"}`;
					if (ctx.hasUI) ctx.ui.notify(summary, "info");
					else console.log(summary);
				} catch (error) {
					ctx.ui.notify(`Language Coach: failed to compute stats (${String(error)})`, "warning");
				}
				return;
			}

			if (trimmed === "vocab") {
				const config = loadConfig();
				if (!config) {
					ctx.ui.notify("Run /language first to configure your native and target languages.", "warning");
					return;
				}
				try {
					const raw = existsSync(VOCAB_PATH) ? readFileSync(VOCAB_PATH, "utf8") : "";
					if (!raw.trim()) {
						ctx.ui.notify("No vocabulary captured yet", "warning");
						return;
					}
					const reviewsRaw = existsSync(VOCAB_REVIEWS_PATH) ? readFileSync(VOCAB_REVIEWS_PATH, "utf8") : "";
					const captures = parseVocabEntries(raw);
					const statuses = vocabSchedule(captures, parseVocabReviews(reviewsRaw), new Date());
					const due = statuses.filter((s) => s.due).length;
					const lines = [`Vocabulary: ${statuses.length} phrases tracked, ${due} due now`];
					const recent = captures.slice(-5);
					if (recent.length > 0) {
						lines.push("Recent:");
						for (const c of recent) lines.push(`  ${toOneLine(c.phrase)} — ${toOneLine(c.translation)}`);
					}
					const summary = lines.join("\n");
					if (ctx.hasUI) ctx.ui.notify(summary, "info");
					else console.log(summary);
				} catch (error) {
					ctx.ui.notify(`Language Coach: failed to compute vocabulary summary (${String(error)})`, "warning");
				}
				return;
			}

			if (trimmed === "digest") {
				const config = loadConfig();
				if (!config) {
					ctx.ui.notify("Run /language first to configure your native and target languages.", "warning");
					return;
				}
				try {
					const raw = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, "utf8") : "";
					if (!raw.trim()) {
						ctx.ui.notify("No coaching data yet", "warning");
						return;
					}
					const { entries } = parseLogEntries(raw);
					const summary = renderStats(aggregateStats(entries));
					// Last `## Digest — ` header in the existing digest file marks the
					// previous run; corrections strictly after it are counted as new.
					let previousTs: number | null = null;
					if (existsSync(DIGEST_PATH)) {
						const digestRaw = readFileSync(DIGEST_PATH, "utf8");
						for (const line of digestRaw.split("\n")) {
							if (!line.startsWith("## Digest — ")) continue;
							const date = parseLogDate(line.slice("## Digest — ".length).trim());
							if (date) previousTs = date.getTime();
						}
					}
					const section = [`## Digest — ${new Date().toISOString()}`, "", summary];
					if (previousTs !== null) {
						const since = entries.filter(
							(e) => e.kind === "correction" && (parseLogDate(e.ts)?.getTime() ?? -Infinity) > previousTs,
						).length;
						section.push(`Since last digest: ${since} corrections`);
					}
					if (existsSync(VOCAB_PATH)) {
						const vocabRaw = readFileSync(VOCAB_PATH, "utf8");
						const reviewsRaw = existsSync(VOCAB_REVIEWS_PATH) ? readFileSync(VOCAB_REVIEWS_PATH, "utf8") : "";
						const statuses = vocabSchedule(parseVocabEntries(vocabRaw), parseVocabReviews(reviewsRaw), new Date());
						const due = statuses.filter((s) => s.due).length;
						section.push(`Vocabulary: ${statuses.length} tracked, ${due} due now`);
					}
					try {
						appendFileSync(DIGEST_PATH, `${section.join("\n")}\n`, "utf8");
					} catch (error) {
						ctx.ui.notify(`Language Coach: could not write digest (${String(error)})`, "warning");
						return;
					}
					const done = `Digest saved to ${DIGEST_PATH}`;
					if (ctx.hasUI) ctx.ui.notify(done, "info");
					else console.log(done);
				} catch (error) {
					ctx.ui.notify(`Language Coach: failed to write digest (${String(error)})`, "warning");
				}
				return;
			}

			if (trimmed === "export") {
				const config = loadConfig();
				if (!config) {
					ctx.ui.notify("Run /language first to configure your native and target languages.", "warning");
					return;
				}
				try {
					const raw = existsSync(LOG_PATH) ? readFileSync(LOG_PATH, "utf8") : "";
					if (!raw.trim()) {
						ctx.ui.notify("No coaching data yet", "warning");
						return;
					}
					const { entries } = parseLogEntries(raw);
					const stats = aggregateStats(entries);
					const vocab = existsSync(VOCAB_PATH) ? parseVocabEntries(readFileSync(VOCAB_PATH, "utf8")) : [];
					const reviews = existsSync(VOCAB_REVIEWS_PATH) ? parseVocabReviews(readFileSync(VOCAB_REVIEWS_PATH, "utf8")) : [];
					const tips = existsSync(TIPS_PATH) ? parseTipEntries(readFileSync(TIPS_PATH, "utf8")) : [];
					// Single consolidated snapshot for the separate web app; every
					// source store stays read-only and only EXPORT_PATH is written.
					const snapshot = {
						schema: EXPORT_SCHEMA,
						generatedAt: new Date().toISOString(),
						nativeLanguage: config.nativeLanguage,
						targetLanguage: config.targetLanguage,
						stats: {
							total: stats.total,
							kinds: stats.kinds,
							weeks: stats.weeks.map((w) => ({ label: w.label, corrections: w.corrections, startISO: w.startISO })),
							trend: stats.trend,
						},
						log: entries,
						vocab,
						reviews,
						tips,
					};
					try {
						writeFileSync(EXPORT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
					} catch (error) {
						ctx.ui.notify(`Language Coach: could not write export (${String(error)})`, "warning");
						return;
					}
					const done = `Export saved to ${EXPORT_PATH}`;
					if (ctx.hasUI) ctx.ui.notify(done, "info");
					else console.log(done);
				} catch (error) {
					ctx.ui.notify(`Language Coach: failed to write export (${String(error)})`, "warning");
				}
				return;
			}

			if (trimmed === "rebuild") {
				const config = loadConfig();
				if (!config) {
					ctx.ui.notify("Run /language first to configure your native and target languages.", "warning");
					return;
				}
				const engine = await loadEngine();
				if (!engine) {
					ctx.ui.notify("Language Coach: engine unavailable; cannot rebuild the learner model.", "warning");
					return;
				}
				try {
					const snapshotPath = join(ENGINE_DATA_DIR, "learner.json");
					if (existsSync(snapshotPath) && ctx.hasUI) {
						const ok = await ctx.ui.confirm(
							"Rebuild learner model?",
							`This overwrites ${snapshotPath} with the model rebuilt from events.jsonl. Continue?`,
						);
						if (!ok) return;
					}
					const summary = await engine.rebuildSnapshot(
						ENGINE_DATA_DIR,
						{ languagePair: { native: config.nativeLanguage, target: config.targetLanguage } },
						new Date(),
					);
					const done = `Learner model rebuilt: ${summary.eventCount} event${summary.eventCount === 1 ? "" : "s"}, ${summary.skippedLines} skipped line${summary.skippedLines === 1 ? "" : "s"} → ${snapshotPath}`;
					if (ctx.hasUI) ctx.ui.notify(done, "info");
					else console.log(done);
				} catch (error) {
					ctx.ui.notify(`Language Coach: rebuild failed (${String(error)})`, "warning");
				}
				return;
			}

			if (trimmed === "drill") {
				const config = loadConfig();
				if (!config) {
					ctx.ui.notify("Run /language first to configure your native and target languages.", "warning");
					return;
				}
				const engine = await loadEngine();
				if (!engine) {
					ctx.ui.notify("Language Coach: engine unavailable; cannot run drills.", "warning");
					return;
				}
				await runDrillSession(ctx, config, engine);
				return;
			}

			if (!MODES.includes(trimmed as CoachMode)) {
				ctx.ui.notify("Usage: /language [on | productivity | off] (no args shows status or runs setup)", "warning");
				return;
			}

			const config = loadConfig();
			if (!config) {
				ctx.ui.notify("Run /language first to configure your native and target languages.", "warning");
				return;
			}
			config.mode = trimmed as CoachMode;
			saveConfig(config);
			applyStatus(ctx, config);
			ctx.ui.notify(`Language Coach mode: ${config.mode}`, "info");
		},
	});
}
