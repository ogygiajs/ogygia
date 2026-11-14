import path from 'node:path';
import type { RegionsSeam } from '@ogygia/compiler/vite';

const SCRIPT_RE = /\.[cm]?[jt]s$/;
const BACKSLASH_G = /\\/g;
const QUERY_RE = /[?#].*$/;
const NUL = '\0';
const UNSAFE_NAME_G = /[^A-Za-z0-9_-]+/g;

/** A module id as the bundler names it, without its NUL prefix, query or backslashes. */
export function clean_id(id: string): string {
	const bare = id.startsWith(NUL) ? id.slice(1) : id;
	return bare.replace(QUERY_RE, '').replace(BACKSLASH_G, '/');
}

/** The chunk of the app modules a registry shares with the rest of the app. Outside
 *  {@link REGISTRY_CHUNK_RE}, so no registry's name can be it. */
export const SHARED_CHUNK = 'shared';

/** Every registry chunk's name: `regions-` and the registry's file name, sanitized to these
 *  characters. A reserved chunk's name never matches it. */
export const REGISTRY_CHUNK_RE: RegExp = /^regions-[A-Za-z0-9_-]+$/;

const by_key = <T>([a]: [string, T], [b]: [string, T]): number => Number(a > b) - Number(a < b);

/**
 * The region registries of the app and the server chunk each one gets. A registry is a script
 * module (`.ts`, `.js`) that marks region imports: a block registry. Its chunk holds the registry,
 * the components its regions render and the modules ogygia mints for them, so only a page that
 * imports the registry loads it. A component that a Svelte module also marks stays where the
 * bundler puts it, and one two registries share goes with the first by path.
 */
export class RegionGroups {
	readonly #seam: Pick<RegionsSeam, 'hosts'>;
	#groups: Map<string, string> | null = null;
	#members: Set<string> | null = null;
	#shared = new Set<string>();

	constructor(seam: Pick<RegionsSeam, 'hosts'>) {
		this.#seam = seam;
	}

	/** The group of the module `id` (a clean id), or null when it is in no registry's. */
	group(id: string): string | null {
		return this.#table().get(id) ?? null;
	}

	/** Is the module `id` (a clean id) a host of regions, or one a region is built from? */
	member(id: string): boolean {
		return this.#all().has(id);
	}

	/** Forget what was read: the next question reads the region table again (a new build). */
	reset(): void {
		this.#groups = null;
		this.#members = null;
		this.#shared = new Set();
	}

	/** Is the module `id` (a clean id) app code that a registry and the rest of the app both import
	 *  (it goes in {@link SHARED_CHUNK}, so a page outside the registry never loads the registry)? */
	shared(id: string): boolean {
		return this.#shared.has(id);
	}

	/**
	 * Reads the server's module graph once it is built: `graph` is each module (by its raw id) with
	 * whether it is an entry and what it imports statically, `dependency` says which modules go in the
	 * framework chunk. A module that a registry's group reaches and that an entry reaches without
	 * passing through any registry's group is shared.
	 */
	shape(
		graph: ReadonlyMap<string, { entry: boolean; imports: readonly string[] }>,
		dependency: (id: string) => boolean
	): void {
		const table = this.#table();
		const from_registries = new Set<string>();
		const outside = new Set<string>();
		const seeds = [...graph.keys()].filter((raw) => table.has(clean_id(raw)));
		const entries = [...graph].filter(([raw, m]) => m.entry && !table.has(clean_id(raw)));
		const out_of_reach = (raw: string): boolean => dependency(raw) || table.has(clean_id(raw));
		RegionGroups.#reach(
			graph,
			seeds.flatMap((raw) => graph.get(raw)?.imports ?? []),
			from_registries,
			out_of_reach
		);
		RegionGroups.#reach(
			graph,
			entries.map(([raw]) => raw),
			outside,
			out_of_reach
		);
		const shared = new Set<string>();
		for (const clean of from_registries) if (outside.has(clean)) shared.add(clean);
		this.#shared = shared;
	}

	#all(): Set<string> {
		if (this.#members) return this.#members;
		const members = new Set<string>();
		for (const [host, ids] of this.#seam.hosts()) {
			members.add(clean_id(host));
			for (const id of ids) members.add(clean_id(id));
		}
		this.#members = members;
		return members;
	}

	#table(): Map<string, string> {
		if (this.#groups) return this.#groups;
		const hosts = [...this.#seam.hosts()].sort(by_key);
		const marked_in_svelte = new Set<string>();
		for (const [host, ids] of hosts)
			if (!SCRIPT_RE.test(host)) for (const id of ids) marked_in_svelte.add(clean_id(id));
		const registries = hosts.filter(([host]) => SCRIPT_RE.test(host));
		const names = RegionGroups.#names(registries.map(([host]) => host));
		const groups = new Map<string, string>();
		for (const [host, ids] of registries) {
			const name = names.get(host)!;
			const own = clean_id(host);
			if (!groups.has(own)) groups.set(own, name);
			for (const raw of ids) {
				const id = clean_id(raw);
				if (!marked_in_svelte.has(id) && !groups.has(id)) groups.set(id, name);
			}
		}
		this.#groups = groups;
		return groups;
	}

	static #reach(
		graph: ReadonlyMap<string, { imports: readonly string[] }>,
		start: readonly string[],
		into: Set<string>,
		stop: (raw: string) => boolean
	): void {
		const stack = [...start];
		while (stack.length > 0) {
			const raw = stack.pop()!;
			const clean = clean_id(raw);
			if (into.has(clean) || stop(raw)) continue;
			into.add(clean);
			for (const next of graph.get(raw)?.imports ?? []) stack.push(next);
		}
	}

	static #names(hosts: readonly string[]): Map<string, string> {
		const names = new Map<string, string>();
		const taken = new Set<string>();
		for (const host of hosts) {
			const base = path.posix.basename(clean_id(host)).replace(SCRIPT_RE, '');
			const stem = `regions-${base.replace(UNSAFE_NAME_G, '-') || 'registry'}`;
			let name = stem;
			for (let n = 2; taken.has(name); n++) name = `${stem}-${n}`;
			taken.add(name);
			names.set(host, name);
		}
		return names;
	}
}
