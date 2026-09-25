// Type contract for the gentle-shell sidebar state, imported at runtime from
// ../../gentle-shell/lib/shell-sidebar.ts (see shell-card.d.ts note).
export interface SidebarRail {
	render(width: number): string[];
	invalidate(): void;
	digest?(): string;
	dispose?(): void;
	handleMouse?(event: unknown): unknown;
}
export interface SidebarState {
	active: boolean;
	ownsHost?(): boolean;
	parts: Map<string, SidebarRail>;
}
export declare function sidebarState(tui: unknown): SidebarState;
