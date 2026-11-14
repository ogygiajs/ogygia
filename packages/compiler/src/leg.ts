import { machine, type Machine } from '@ogygia/machine';
import { barrel_left_table, type BarrelLeftTable } from './exports/left.ts';

type LegStates = { open: {}; closed: {} };
const LEG_STEPS = { open: ['closed'], closed: [] } as const;
const LEG = machine<LegStates>()({ name: 'build leg', initial: 'open', steps: LEG_STEPS });

export interface BuildLeg {
	/** The bundler environment's name (`ssr`, `client`, or the app's own). */
	readonly name: string;
	/** A server environment (its output runs in Node, not the browser). */
	readonly server: boolean;
	readonly life: Machine<LegStates, typeof LEG_STEPS>;
	/** Each emitted island entry's ref, by island id (one emit per island per leg). */
	readonly island_entry_refs: Map<string, string>;
	runtime_entry_ref: string | null;
	/** The location map's served path, once `location_maps` wrote it. */
	location_map_url: string | null;
	/** Each file's compiled tree CSS (null: none), compiled once per leg however many roots reach it. */
	readonly compiled_css: Map<string, string | null>;
	/** Emitted CSS asset refs: router page (`rcss:<rel>`), server hole (island id), content module. */
	readonly router_css_refs: Map<string, string>;
	readonly hole_css_refs: Map<string, string>;
	readonly content_css_refs: Map<string, string>;
	/** A server leg's regions found after it wrote `server-regions`: each one's emitted chunk ref, by
	 *  island id (link/server-manifest.ts). */
	readonly late_server_regions: Map<string, string>;
	/** Each relocation's patches in this leg's chunks, by name (link/relocations.ts). */
	readonly relocated: Map<string, number>;
	/** Why a barrel stayed, by transform stage (exports/left.ts). */
	barrels_left(stage: string): BarrelLeftTable;
	/** The stage's table, if any module said anything in it. */
	barrels_said(stage: string): BarrelLeftTable | undefined;
}

export function new_leg(name: string, server: boolean): BuildLeg {
	const barrels = new Map<string, BarrelLeftTable>();
	return {
		name,
		server,
		life: LEG.create(),
		island_entry_refs: new Map(),
		runtime_entry_ref: null,
		location_map_url: null,
		compiled_css: new Map(),
		router_css_refs: new Map(),
		hole_css_refs: new Map(),
		content_css_refs: new Map(),
		late_server_regions: new Map(),
		relocated: new Map(),
		barrels_left(stage) {
			let table = barrels.get(stage);
			if (table === undefined) barrels.set(stage, (table = barrel_left_table()));
			return table;
		},
		barrels_said: (stage) => barrels.get(stage)
	};
}
