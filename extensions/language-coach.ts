import type { ExtensionAPI, ExtensionContext, Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { Input, matchesKey, type OverlayOptions, type TUI, type TuiMouseEvent, type TuiMouseEventResult } from "@earendil-works/pi-tui";
import {
	CARD_TONE,
	cardBottom,
	cardInnerWidth,
	cardLine,
	cardTop,
	renderCard,
	type Card,
} from "gentle-shell-lib/shell-card.ts";
import { sidebarState, type SidebarRail } from "gentle-shell-lib/shell-sidebar.ts";
import { installSidebar, invalidateSidebar } from "gentle-shell-lib/shell-sidebar-layout.ts";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
const MODES: readonly CoachMode[] = ["on", "productivity", "off"];
let warnedAboutConfig = false;

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

function buildOverlay(config: CoachConfig): string {
	const { nativeLanguage: native, targetLanguage: target } = config;
	const targetLower = target.toLowerCase();
	const lines = [
		`## Language Coach (native: ${native} → target: ${target})`,
		`The user is a native ${native} speaker practicing professional ${target} for software engineering work.`,
		`- Coach block: START every reply with a blockquote block (consecutive lines starting with "> ") exactly in this shape, then a horizontal rule (---) on its own line, then a blank line, then the main response:\n  > 🎓 "the user's original message, verbatim, natural-language part only (skip code, commands, paths, logs)"\n  >\n  > ✏️ "the corrected sentence in ${target}, with the changed words wrapped in **bold**"\n  For ${native}-language input, use > 🌐 on the first line and put the natural, professional ${target} translation on the ✏️ line instead of a correction. After the ✏️ line, if the translation contains 1–2 notable multi-word ${target} phrases worth keeping, add one more blockquote line per phrase: > 📚 "the phrase" — ${native} gloss (never for single words, never more than two). The coach block is an explicit exception to any reply-language rule. Never translate word-by-word.`,
		`- If the user's ${target} message is already natural: keep the 🎓 echo line, and on the ✏️ line say it is correct and optionally give at most one more natural alternative, bolding the changed words. If no alternative adds value, say so briefly. Do not invent corrections.`,
		`- If the user writes in any other language: reply in that language; no coaching.`,
		`- Never translate or rewrite code, commands, identifiers, logs, file paths, commit messages, or delegated artifacts.`,
		`- Coaching is one coach block max; never let it delay or reshape the technical task. The echo line quotes the user's own words; never quote code or file paths in it.`,
		`- On noticing a recurring mistake, save one short line with mem_save (type "preference", topic_key "language-mistakes-${targetLower}").`,
		`- When the user asks for a review or progress report: read the recent entries in ${LOG_PATH} and search memories with that topic_key, then summarize compactly: recurring mistakes, weekly correction volume, what improved, and 2-3 focus points for the coming period.`,
	];
	if (config.mode === "productivity") {
		lines.push(`(productivity mode: give only the coach block, with no alternatives or commentary.)`);
	}
	return lines.join("\n");
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
		return { label: `${formatDate(ws)}–${formatDate(we)}`, corrections: 0 };
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
		// Rail mount is best-effort; the /language panel fallback works.
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
// (Todos) and ctrl+shift+a (Agents), and the coach already owns alt+c/alt+t.
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
	return `${[LOG_PATH, VOCAB_PATH, VOCAB_REVIEWS_PATH].map(fileSignature).join("|")}|${railCollapsed ? "1" : "0"}${railHovered ? "1" : "0"}`;
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
		// Rail registration is best-effort; the /language panel fallback works.
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
// Dashboard card (shared by the rail and the overlay fallback)
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

function recommendations(data: PanelData): string[] {
	const hints: string[] = [];
	if (data.dueTotal > 0) {
		hints.push(`${data.dueTotal} due — /skill:language-drill`);
	}
	if (data.stats?.trend === "rising") {
		hints.push("rising — /language digest");
	}
	if (!data.stats || data.stats.kinds.correction === 0) {
		hints.push("no corrections yet — /skill:language-interview");
	}
	return hints;
}

function addCardSection(body: string[], title: string, lines: string[], empty: string): void {
	body.push("", title);
	if (lines.length === 0) {
		body.push(`  ${empty}`);
		return;
	}
	for (const line of lines) body.push(`  ${line}`);
}

interface CoachCardOptions {
	collapsed: boolean;
	hovered: boolean;
	collapseKey: string | undefined;
}

// One compact line per displayed week bucket; the current (last) bucket
// carries the theme's accent role — an existing role, no new colors.
function weeklyRows(stats: StatsSummary, theme: Theme): string[] {
	return stats.weeks.map((week, index) => {
		const line = `${week.label}  ${week.corrections}`;
		return index === stats.weeks.length - 1 ? theme.fg("accent", line) : line;
	});
}

// Mirror of the Todos card's collapsedRow(): the most relevant compact line —
// a due phrase when one is due, else this week's summary.
function collapsedCoachRow(data: PanelData): string {
	const due = data.due[0];
	if (due) return `${toOneLine(due.phrase, 30)} — ${toOneLine(due.translation, 30)}`;
	if (data.stats?.weeks.length) return `${data.stats.weeks.at(-1)!.corrections} corrections this week · ${data.stats.trend}`;
	return "no coaching data yet";
}

function expandedCoachBody(data: PanelData, theme: Theme): string[] {
	const stats = data.stats;
	const body: string[] = [];
	if (stats) {
		for (const line of weeklyRows(stats, theme)) body.push(line);
	} else {
		body.push("No coaching data yet");
	}
	addCardSection(
		body,
		"Due vocabulary",
		data.due.map((s) => `${toOneLine(s.phrase, 30)} — ${toOneLine(s.translation, 30)}${s.streak > 0 ? ` · streak ${s.streak}` : ""}`),
		"No vocabulary captured yet",
	);
	addCardSection(
		body,
		"Top corrections",
		stats ? stats.topCorrections.map((t) => `${toOneLine(t.span, 30)} ×${t.count}`) : [],
		"No corrections recorded yet",
	);
	addCardSection(
		body,
		"Recent",
		stats ? stats.recent.slice(-3).map((r) => `[${r.kind}] ${r.when} — ${r.line}`) : [],
		"No recent blocks",
	);
	const hints = recommendations(data);
	addCardSection(body, "Recommendations", hints.length > 0 ? [hints.join(" · ")] : [], "keep practicing!");
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
		body: options.collapsed ? [collapsedCoachRow(data)] : expandedCoachBody(data, theme),
		tone: CARD_TONE.INFO,
	};
}

// ---------------------------------------------------------------------------
// Dashboard panel (overlay fallback for narrow / non-fullscreen terminals)
// ---------------------------------------------------------------------------

const PANEL_MAX_WIDTH = 48;

interface PanelData {
	stats: StatsSummary | null;
	due: VocabStatus[];
	dueTotal: number;
}

function loadPanelData(): PanelData {
	const data: PanelData = { stats: null, due: [], dueTotal: 0 };
	try {
		if (existsSync(LOG_PATH)) {
			const { entries } = parseLogEntries(readFileSync(LOG_PATH, "utf8"));
			if (entries.length > 0) data.stats = aggregateStats(entries);
		}
	} catch {
		// Stats load failure renders the panel's "no data yet" state.
	}
	try {
		if (existsSync(VOCAB_PATH)) {
			const captures = parseVocabEntries(readFileSync(VOCAB_PATH, "utf8"));
			const reviews = existsSync(VOCAB_REVIEWS_PATH) ? parseVocabReviews(readFileSync(VOCAB_REVIEWS_PATH, "utf8")) : [];
			const statuses = vocabSchedule(captures, reviews, new Date()).filter((s) => s.due);
			data.dueTotal = statuses.length;
			data.due = statuses.slice(0, 5);
		}
	} catch {
		// Vocab load failure renders the panel's empty vocab section.
	}
	return data;
}

class CoachPanel {
	private readonly data: PanelData;
	private readonly onClose: () => void;

	constructor(private readonly theme: Theme, data: PanelData, onClose: () => void) {
		this.data = data;
		this.onClose = onClose;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape")) this.onClose();
	}

	render(width: number): string[] {
		// Lines are composed from live state on every render; no cached children
		// to invalidate. Same card look as the persistent rail, always expanded
		// (the overlay has no collapse control).
		try {
			return renderCard(
				coachCard(this.data, this.theme, width, { collapsed: false, hovered: false, collapseKey: undefined }),
				this.theme,
				width,
				{ expanded: true, hint: "esc to close" },
			);
		} catch {
			// An overlay must never throw out of render.
			return [];
		}
	}

	invalidate(): void {}
}

async function openDashboardPanel(ctx: ExtensionContext): Promise<void> {
	// Resolved inside the factory once the TUI (and its terminal width) is known;
	// overlayOptions is read after the factory runs.
	let options: OverlayOptions = { anchor: "center", width: PANEL_MAX_WIDTH, margin: 1, maxHeight: "80%" };
	await ctx.ui.custom((_tui, theme, _keybindings, done) => {
		const cols = _tui.terminal.columns;
		// Right-anchor on wide terminals, fall back to centered on narrow ones;
		// width stays within min(48, cols - 4).
		options = {
			anchor: cols >= 80 ? "right-center" : "center",
			width: Math.max(24, Math.min(PANEL_MAX_WIDTH, cols - 4)),
			margin: 1,
			maxHeight: "80%",
		};
		return new CoachPanel(theme, loadPanelData(), () => done(undefined));
	}, { overlay: true, overlayOptions: () => options });
}

// ---------------------------------------------------------------------------
// Translator panel (overlay, direct model call)
// ---------------------------------------------------------------------------

const TRANSLATOR_MAX_WIDTH = 60;
const TRANSLATOR_HISTORY_LIMIT = 5;

interface TranslatorDeps {
	request: (text: string, signal: AbortSignal) => Promise<string>;
	requestRender: () => void;
	onClose: () => void;
}

class TranslatorPanel {
	private readonly input: Input;
	private history: Array<{ source: string; result: string }> = [];
	private state: "idle" | "loading" | "error" | "cancelled" = "idle";
	private error = "";
	private controller: AbortController | null = null;
	private focusedInternal = false;

	constructor(private readonly theme: Theme, private readonly config: CoachConfig, private readonly deps: TranslatorDeps) {
		this.input = new Input({ prompt: "> " });
		this.input.onSubmit = (value) => {
			const text = value.trim();
			// Empty input submits nothing; a request in flight is never stacked.
			if (!text || this.state === "loading") return;
			this.input.setValue("");
			void this.translate(text);
		};
		this.input.onEscape = () => {
			// Esc while a request is in flight aborts it and keeps the panel open
			// so the "cancelled" state is visible; otherwise esc closes the panel.
			if (this.controller) {
				this.controller.abort();
				this.controller = null;
				this.state = "cancelled";
				this.deps.requestRender();
				return;
			}
			this.deps.onClose();
		};
	}

	// Focusable propagation (IME support): forward focus state to the child Input.
	get focused(): boolean {
		return this.focusedInternal;
	}
	set focused(value: boolean) {
		this.focusedInternal = value;
		this.input.focused = value;
	}

	handleInput(data: string): void {
		this.input.handleInput(data);
	}

	render(width: number): string[] {
		// Lines are composed from live state on every render. This is the core of
		// the translator fix: the previous implementation baked state and history
		// into a Container once in the constructor and never rebuilt it, so a
		// completed translation never appeared.
		try {
			return this.buildLines(width);
		} catch {
			// An overlay must never throw out of render.
			return [];
		}
	}

	invalidate(): void {}

	private async translate(text: string): Promise<void> {
		const controller = new AbortController();
		this.controller = controller;
		this.state = "loading";
		this.error = "";
		this.deps.requestRender();
		try {
			const result = await this.deps.request(text, controller.signal);
			if (controller.signal.aborted) {
				this.state = "cancelled";
			} else if (!result) {
				// An empty response (e.g. an aborted run surfacing as "") must never
				// become a history entry.
				this.state = "error";
				this.error = "empty response from model";
			} else {
				this.history.unshift({ source: text, result });
				if (this.history.length > TRANSLATOR_HISTORY_LIMIT) this.history.pop();
				this.state = "idle";
			}
		} catch (error) {
			// Provider, auth, and request errors render inline; never throw out of the component.
			if (controller.signal.aborted) {
				this.state = "cancelled";
			} else {
				this.state = "error";
				this.error = error instanceof Error ? error.message : String(error);
			}
		} finally {
			if (this.controller === controller) this.controller = null;
			this.deps.requestRender();
		}
	}

	private buildLines(width: number): string[] {
		const theme = this.theme;
		const card: Card = {
			title: `Translate (${this.config.nativeLanguage} → ${this.config.targetLanguage})`,
			body: [],
			tone: CARD_TONE.INFO,
		};
		const lines = [cardTop(card, theme, width, "esc close · enter translate")];
		const inner = cardInnerWidth(width);
		const pushBody = (text: string) => {
			for (const line of text.split("\n")) lines.push(cardLine(line, card.tone, theme, width));
		};
		for (const inputLine of this.input.render(inner)) pushBody(inputLine);
		if (this.state === "loading") pushBody(theme.fg("dim", "Translating…"));
		else if (this.state === "cancelled") pushBody(theme.fg("warning", "cancelled"));
		else if (this.state === "error") pushBody(theme.fg("error", `Error: ${this.error}`));
		for (const pair of this.history) {
			lines.push(cardLine("", card.tone, theme, width));
			pushBody(theme.fg("muted", `▸ ${pair.source}`));
			pushBody(theme.fg("text", `→ ${pair.result}`));
		}
		lines.push(cardBottom(card.tone, theme, width));
		return lines;
	}
}

async function openTranslator(ctx: ExtensionContext, config: CoachConfig): Promise<void> {
	const runRequest = async (text: string, signal: AbortSignal): Promise<string> => {
		// Direct pi-ai call through the active model; nothing touches the session
		// context, so translations never enter the transcript or coach log.
		const model = ctx.model;
		if (!model) throw new Error("no active model; select one with /model");
		const provider = ctx.modelRegistry.getProvider(model.provider);
		if (!provider) throw new Error(`provider "${model.provider}" not available`);
		const auth = await ctx.modelRegistry.getProviderAuth(model.provider);
		if (!auth) throw new Error(`no authentication configured for provider "${model.provider}"`);
		const messages = [
			{
				role: "user" as const,
				content: `Translate the following ${config.nativeLanguage} text to ${config.targetLanguage}. Output ONLY the translation, no quotes, no notes.\n\n${text}`,
				timestamp: Date.now(),
			},
		];
		const response = await ctx.modelRegistry.complete(model, { messages }, { signal });
		if (response.stopReason === "aborted") return "";
		return response.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();
	};

	let options: OverlayOptions = { anchor: "center", width: TRANSLATOR_MAX_WIDTH, margin: 1, maxHeight: "80%" };
	await ctx.ui.custom((tui, theme, _keybindings, done) => {
		const cols = tui.terminal.columns;
		options = {
			anchor: "center",
			width: Math.max(32, Math.min(TRANSLATOR_MAX_WIDTH, cols - 4)),
			margin: 1,
			maxHeight: "80%",
		};
		return new TranslatorPanel(theme, config, {
			request: runRequest,
			requestRender: () => tui.requestRender(),
			onClose: () => done(undefined),
		});
	}, { overlay: true, overlayOptions: () => options });
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
		if (config && config.mode !== "off") mountCoachRail(ctx);
		else unmountCoachSidebar(railTui);
	});

	pi.on("before_agent_start", async (event) => {
		const config = loadConfig();
		if (!config || config.mode === "off") return;
		const base = event.systemPrompt ?? "";
		return { systemPrompt: `${base}\n\n${buildOverlay(config)}` };
	});

	pi.on("message_end", async (event, _ctx) => {
		if (event.message.role !== "assistant") return;
		const config = loadConfig();
		if (!config || config.mode === "off") {
			unmountCoachSidebar(railTui);
			return;
		}
		const text = textFromContent(event.message.content);
		const coach = coachBlockFrom(text);
		if (coach) appendLog(config, coach.block, coach.kind);
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

	// Dashboard panel and translator shortcuts. alt+c / alt+t are free: the
	// built-in keymap (docs/keybindings.md) claims alt+b/f/d/y/v/q, alt+arrows,
	// alt+enter/backspace/delete, and ctrl+<letter> combos, but no alt+c/alt+t.
	pi.registerShortcut("alt+c", {
		description: "Language Coach: open the dashboard panel",
		handler: async (ctx) => {
			if (!ctx.hasUI) {
				console.log("The dashboard panel requires the TUI");
				return;
			}
			await openDashboardPanel(ctx);
		},
	});

	pi.registerShortcut("alt+t", {
		description: "Language Coach: open the translator panel",
		handler: async (ctx) => {
			if (!ctx.hasUI) {
				console.log("Translator requires the TUI");
				return;
			}
			const config = loadConfig();
			if (!config) {
				ctx.ui.notify("Run /language first to configure your native and target languages.", "warning");
				return;
			}
			await openTranslator(ctx, config);
		},
	});

	pi.registerCommand("language", {
		description: "Language Coach: show status, run setup, view stats, review vocabulary, write a digest, open the dashboard panel or translator, or set mode (on | productivity | off)",
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

			if (trimmed === "panel") {
				if (!ctx.hasUI) {
					console.log("The dashboard panel requires the TUI");
					return;
				}
				await openDashboardPanel(ctx);
				return;
			}

			if (trimmed === "translate") {
				if (!ctx.hasUI) {
					console.log("Translator requires the TUI");
					return;
				}
				const config = loadConfig();
				if (!config) {
					ctx.ui.notify("Run /language first to configure your native and target languages.", "warning");
					return;
				}
				await openTranslator(ctx, config);
				return;
			}

			if (!MODES.includes(trimmed as CoachMode)) {
				ctx.ui.notify("Usage: /language [on | productivity | off | panel | translate] (no args shows status or runs setup)", "warning");
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
