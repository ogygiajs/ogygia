import type { EnvironmentOptions, Plugin } from 'vite';
import type { RegionsSeam } from '@ogygia/compiler/vite';
import { Dependencies } from './dependencies.ts';
import { Externals } from './externals.ts';
import type { Options } from './options.ts';
import { RegionGroups, SHARED_CHUNK, clean_id } from './regions.ts';

const SERVER_ENVIRONMENT = 'ssr';
/** The chunk the framework and every dependency go in. */
export const SERVER_CHUNK = 'server';

const NO_REGIONS: Pick<RegionsSeam, 'hosts'> = { hosts: () => new Map() };

/** A server output chunk, as far as the external report reads it. */
export interface OutputChunk {
	type: 'chunk' | 'asset';
	imports?: readonly string[];
	dynamicImports?: readonly string[];
}

/**
 * The shape of the server build: the options the SSR environment gets, the two chunk groups and
 * what decides each module's group, and the external report at the end of the build.
 */
export class ServerChunks {
	readonly #options: Options;
	#regions = new RegionGroups(NO_REGIONS);
	#dependencies: Dependencies | null = null;
	#logged: ((line: string) => void) | null = null;

	constructor(options: Options) {
		this.#options = options;
	}

	/** The region table, from ogygia's build context. */
	attach(seam: Pick<RegionsSeam, 'hosts'>): void {
		this.#regions = new RegionGroups(seam);
	}

	/** The app's root: where its dependencies are read from. */
	root(root: string): void {
		this.#dependencies = new Dependencies(root);
	}

	/** The registries' groups. */
	get regions(): RegionGroups {
		return this.#regions;
	}

	/** Does the module `id` go in the framework chunk? A dependency that no region is built from. */
	framework(id: string): boolean {
		const clean = clean_id(id);
		if (this.#dependencies === null || !this.#dependencies.has(clean)) return false;
		return !this.#regions.member(clean);
	}

	/** The chunk the module `id` goes in, when it is one of a registry's. */
	region(id: string): string | null {
		return this.#regions.group(clean_id(id));
	}

	/** Does the module `id` go in the chunk a registry shares with the rest of the app? */
	shared(id: string): boolean {
		return this.#regions.shared(clean_id(id));
	}

	/** Reads the built server graph (`ids`, `info` as Rolldown's `getModuleIds`, `getModuleInfo`). */
	graph(
		ids: Iterable<string>,
		info: (id: string) => { isEntry: boolean; importedIds: readonly string[] } | null
	): void {
		const graph = new Map<string, { entry: boolean; imports: readonly string[] }>();
		for (const id of ids) {
			const m = info(id);
			if (m) graph.set(id, { entry: m.isEntry, imports: m.importedIds });
		}
		this.#regions.shape(graph, (id) => this.framework(id));
	}

	/** What the SSR environment of a build gets. */
	environment(): EnvironmentOptions {
		return {
			resolve: { noExternal: true, external: [...this.#options.external] },
			build: {
				rolldownOptions: {
					output: {
						codeSplitting: {
							groups: [
								{ name: SERVER_CHUNK, test: (id) => this.framework(id), priority: 3 },
								{ name: SHARED_CHUNK, test: (id) => this.shared(id), priority: 2 },
								{ name: (id) => this.region(id), priority: 1 }
							]
						}
					}
				}
			}
		};
	}

	/** The externals the server output `bundle` kept, with `config` the environment's own
	 *  `resolve.external`. */
	externals(bundle: Record<string, OutputChunk>, config: true | readonly string[]): Externals {
		const externals = new Externals(this.#options.external, config === true ? [] : config);
		for (const chunk of Object.values(bundle)) {
			if (chunk.type !== 'chunk') continue;
			for (const spec of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])])
				if (!(spec in bundle)) externals.add(spec);
		}
		return externals;
	}

	/** The Vite plugin: build only, the SSR environment only. */
	plugin(): Plugin {
		const environment = (name: string, command: string) =>
			name === SERVER_ENVIRONMENT && command === 'build' ? this.environment() : undefined;
		const resolved = (root: string, info: (line: string) => void) => {
			this.root(root);
			this.#logged = info;
		};
		const reset = () => this.#regions.reset();
		const graph = (ids: Iterable<string>, info: Parameters<ServerChunks['graph']>[1]) =>
			this.graph(ids, info);
		const report = (bundle: Record<string, OutputChunk>, config: true | readonly string[]) =>
			this.#logged?.(this.externals(bundle, config).report());
		return {
			name: '@ogygia/jumpstart:server',
			apply: 'build',
			configEnvironment: (name, _config, env) => environment(name, env.command),
			configResolved: (config) => resolved(config.root, (line) => config.logger.info(line)),
			buildStart() {
				if (this.environment.name === SERVER_ENVIRONMENT) reset();
			},
			buildEnd() {
				if (this.environment.name === SERVER_ENVIRONMENT)
					graph(this.getModuleIds(), (id) => this.getModuleInfo(id));
			},
			generateBundle(_output, bundle) {
				if (this.environment.name === SERVER_ENVIRONMENT)
					report(bundle, this.environment.config.resolve.external);
			}
		};
	}
}
