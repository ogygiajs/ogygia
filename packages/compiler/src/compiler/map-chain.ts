import remapping, { type SourceMapInput } from '@jridgewell/remapping';

/** One pass's map from its output back to its input; `null` when the pass cannot say (a text-only plugin macro). */
export type StepMap = (() => SourceMapInput) | null;

/** The map of a module rewritten by several passes, each mapping its output back to its input. */
export class MapChain {
	readonly #steps: StepMap[] = [];

	/** A pass ran over the current text. */
	step(map: StepMap): void {
		this.#steps.push(map);
	}

	/** Several passes ran, in order. */
	steps(maps: readonly StepMap[]): void {
		for (const map of maps) this.#steps.push(map);
	}

	/** The output's map back to the file as read; empty mappings when a pass could not say. */
	result(source: string): { version: 3; sources: string[]; names: string[]; mappings: string } {
		const maps: SourceMapInput[] = [];
		for (let i = this.#steps.length - 1; i >= 0; i--) {
			const make = this.#steps[i]!;
			if (make === null) return { version: 3, sources: [source], names: [], mappings: '' };
			maps.push(make());
		}
		if (!maps.length) return { version: 3, sources: [source], names: [], mappings: '' };
		const map = remapping(maps.length === 1 ? maps[0]! : maps, () => null);
		return {
			version: 3,
			sources: map.sources.map(() => source),
			names: map.names,
			mappings: typeof map.mappings === 'string' ? map.mappings : ''
		};
	}
}
