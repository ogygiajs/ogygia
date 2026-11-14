// Test stub for `ogygia:server/region-deps` (real one is minted by the Vite plugin): the per-entry
// lookups Region.svelte reads while it emits its graph and CSS — empty in unit tests. Each `set_*`
// sets what one lookup answers. A list lookup answers a list or nothing, as the real `pick` does
// (a key like `valueOf` is no entry of the map).
const list = (map: Record<string, string[]>, key: string): string[] => {
	const v = map[key];
	return Array.isArray(v) ? v : [];
};
let deps_by_entry: Record<string, string[]> = {};
export const region_deps = (entry: string): string[] => list(deps_by_entry, entry);
export function set_island_deps(map: Record<string, string[]>) {
	deps_by_entry = map;
}
let css_by_entry: Record<string, string[]> = {};
export const region_css = (entry: string): string[] => list(css_by_entry, entry);
export function set_island_css(map: Record<string, string[]>) {
	css_by_entry = map;
}
let css_by_content: Record<string, string[]> = {};
export const content_css = (id: string): string[] => list(css_by_content, id);
export function set_content_css(map: Record<string, string[]>) {
	css_by_content = map;
}
// (null = link it)
let inline_css: Record<string, string> = {};
export const region_css_inline = (href: string): string | null =>
	typeof inline_css[href] === 'string' ? inline_css[href] : null;
export function set_inline_css(map: Record<string, string>) {
	inline_css = map;
}
// (fail-open true)
let reads_page = true;
export const region_reads_page = (_entry: string): boolean => reads_page;
export function set_reads_page(v: boolean) {
	reads_page = v;
}
// (fail-open null = ship all)
let page_keys: string[] | null = null;
export const region_page_keys = (_entry: string): string[] | null => page_keys;
export function set_page_keys(v: string[] | null) {
	page_keys = v;
}
export const region_page_why = (
	_entry: string
): { file: string; line: number | null; why: string }[] | null => null;
// (fail-open null = may call anything)
let remotes: string[] | null = null;
export const region_remotes = (_entry: string): string[] | null => remotes;
export function set_island_remotes(v: string[] | null) {
	remotes = v;
}
type Interactivity = {
	handlers: number;
	state: number;
	effects: number;
	binds: number;
	actions: number;
	files: number;
};
let interactivity: Record<string, Interactivity> = {};
export const region_interactivity = (entry: string): Interactivity | null =>
	interactivity[entry] ?? null;
export function set_island_interactivity(map: Record<string, Interactivity>) {
	interactivity = map;
}
let contents_by_chunk: Record<string, string[]> = {};
export const chunk_contents = (href: string): string[] | null => contents_by_chunk[href] ?? null;
export function set_chunk_contents(map: Record<string, string[]>) {
	contents_by_chunk = map;
}
let entry_locations: Record<string, string> = {};
export const entry_location = (identity: string): string | null => {
	const v = identity ? entry_locations[identity] : null;
	return typeof v === 'string' ? v : null;
};
export function set_entry_locations(map: Record<string, string>) {
	entry_locations = map;
}
let map_file: string | null = null;
export const location_map = (): string | null => map_file;
export function set_location_map(file: string | null) {
	map_file = file;
}
let heavy_by_chunk: Record<string, { total: number; top: { name: string; bytes: number }[] }> = {};
export const chunk_heavy = (
	href: string
): { total: number; top: { name: string; bytes: number }[] } | null => heavy_by_chunk[href] ?? null;
export function set_chunk_heavy(map: typeof heavy_by_chunk) {
	heavy_by_chunk = map;
}
let barrels_by_chunk: Record<string, { name: string; fanout: number }[]> = {};
export const chunk_barrels = (href: string): { name: string; fanout: number }[] | null =>
	barrels_by_chunk[href] ?? null;
export function set_chunk_barrels(map: typeof barrels_by_chunk) {
	barrels_by_chunk = map;
}
let chunk_dupes:
	| { name: string; copies: { file: string; bytes: number; from?: string }[] }[]
	| null = null;
export const chunk_duplicates = () => chunk_dupes;
export function set_chunk_dupes(v: typeof chunk_dupes) {
	chunk_dupes = v;
}
type StubHazard = {
	file: string;
	line: number;
	code: string;
	kind: 'await' | 'browser';
	reads?: string;
};
let hazards_by_entry: Record<string, StubHazard[]> = {};
export const region_hazards = (entry: string): StubHazard[] | null =>
	hazards_by_entry[entry] ?? null;
export function set_island_hazards(map: typeof hazards_by_entry) {
	hazards_by_entry = map;
}
// (hooks.ts reads it; Vite's alias lets a missing export through, plain Node's linker does not)
export const fn_manifest = (): Record<string, string> | null => null;
type StubProblem = { kind: 'missing' | 'unreadable'; tried: string[]; error?: string };
let problem: StubProblem | null = null;
export const handoff_problem = (): StubProblem | null => problem;
export function set_handoff_problem(p: StubProblem | null) {
	problem = p;
}
