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
		`- Coach lines: every translation or correction line MUST be the first line of the reply, rendered as its own blockquote block exactly in this shape: > 🎓 "..." for corrections of ${target} input, or > 🌐 "..." for translations of ${native} input — followed by a blank line before the rest of the reply. Never put anything else inside that block.`,
		`- If the user writes in ${native}: the coach block starts with > 🌐 and contains the user's intent translated to natural, professional ${target} as used by software engineers. This line is an explicit exception to any reply-language rule. Never translate word-by-word. Then continue the reply in ${native}.`,
		`- If the user writes in ${target}: if the message has grammar, word-choice, or phrasing errors, the coach block starts with > 🎓 and contains the corrected sentence with the corrected or changed words wrapped in **bold**, then continue the reply in ${target}. If it is correct but unnatural, the coach block says so briefly and gives at most one more natural alternative, bolding the changed words. If it is already natural, do not invent corrections.`,
		`- If the user writes in any other language: reply in that language; no coaching.`,
		`- Never translate or rewrite code, commands, identifiers, logs, file paths, commit messages, or delegated artifacts.`,
		`- Coaching is one coach block max; never let it delay or reshape the technical task.`,
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

function coachLineFrom(text: string): { line: string; kind: "correction" | "translation" | "unmarked" } | null {
	const lines = text.split("\n").map((l) => l.trim());
	const firstLine = lines.find((l) => l.length > 0) ?? "";
	if (!firstLine) return null;
	if (firstLine.startsWith("> 🎓")) return { line: firstLine, kind: "correction" };
	if (firstLine.startsWith("> 🌐")) return { line: firstLine, kind: "translation" };
	if (firstLine.startsWith('"')) return { line: firstLine, kind: "unmarked" }; // fallback when the marker is missing
	return null;
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

function appendLog(config: CoachConfig, line: string, kind: "correction" | "translation" | "unmarked"): void {
	try {
		const entry = { ts: new Date().toISOString(), kind, native: config.nativeLanguage, target: config.targetLanguage, line };
		appendFileSync(LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
	} catch {
		// Logging must never break the session.
	}
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
		const coach = coachLineFrom(textFromContent(event.message.content));
		if (coach) appendLog(config, coach.line, coach.kind);
	});

	pi.registerCommand("language", {
		description: "Language Coach: show status, run setup, or set mode (on | productivity | off)",
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
