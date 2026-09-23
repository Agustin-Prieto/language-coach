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
