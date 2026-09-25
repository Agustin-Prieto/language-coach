// Type contract for the gentle-shell card system, which language-coach imports
// at runtime from ../../gentle-shell/lib/shell-card.ts (jiti resolves the real
// sources; gentle-shell's own sources are not type-checked under this repo's
// stricter config, so this stub is the compile-time contract).
export declare const CARD_TONE: {
	readonly INFO: "info";
	readonly SUCCESS: "success";
	readonly WARNING: "warning";
	readonly ERROR: "error";
};
export type CardTone = (typeof CARD_TONE)[keyof typeof CARD_TONE];
export interface Card {
	title: string;
	subtitle?: string;
	body: string[];
	tone: CardTone;
	glyph?: string;
}
export interface CardTheme {
	fg(color: string, text: string): string;
}
export interface CardRenderOptions {
	expanded: boolean;
	hint?: string;
}
export declare function renderCard(card: Card, theme: CardTheme, width: number, options?: CardRenderOptions): string[];
export declare function cardTop(card: Card, theme: CardTheme, width: number, hint?: string): string;
export declare function cardInnerWidth(width: number): number;
export declare function cardLine(line: string, tone: CardTone, theme: CardTheme, width: number): string;
export declare function cardBottom(tone: CardTone, theme: CardTheme, width: number): string;
