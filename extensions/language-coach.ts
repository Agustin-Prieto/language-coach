import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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
		`- Coach block: START every reply with a blockquote block (consecutive lines starting with "> ") exactly in this shape, then a horizontal rule (---) on its own line, then a blank line, then the main response:\n  > 🎓 "the user's original message, verbatim, natural-language part only (skip code, commands, paths, logs)"\n  >\n  > ✏️ "the corrected sentence in ${target}, with the changed words wrapped in **bold**"\n  For ${native}-language input, use > 🌐 on the first line and put the natural, professional ${target} translation on the ✏️ line instead of a correction. The coach block is an explicit exception to any reply-language rule. Never translate word-by-word.`,
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

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const config = loadConfig();
		applyStatus(ctx, config && config.mode !== "off" ? config : null);
	});

	pi.on("before_agent_start", async (event) => {
		const config = loadConfig();
		if (!config || config.mode === "off") return;
		const base = event.systemPrompt ?? "";
		return { systemPrompt: `${base}\n\n${buildOverlay(config)}` };
	});

	pi.on("message_end", async (event) => {
		if (event.message.role !== "assistant") return;
		const config = loadConfig();
		if (!config || config.mode === "off") return;
		const coach = coachBlockFrom(textFromContent(event.message.content));
		if (coach) appendLog(config, coach.block, coach.kind);
	});

	pi.registerCommand("language", {
		description: "Language Coach: show status, run setup, view stats, write a digest, or set mode (on | productivity | off)",
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
