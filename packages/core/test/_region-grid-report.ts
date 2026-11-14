// How a region grid writes what it saw. A case's output has parts (the server's head, body, tail,
// early holes, page records, devtools events, what reached the console; the browser's body, live
// values, console). For each part, every distinct value IN FULL (hashes as numbered placeholders),
// each with the cases that give it. A case list is written as products of axis values
// (`wake=load|idle keep=* …`, `*` for every value), folded without loss: together the lines name
// exactly the cases that gave that value. Under a value, each set of real hashes its placeholders
// stood for, with the cases that had them. A case's whole output is its value in every part. So a
// change to any byte of any case shows as a value's text, or that case moving to another value, by
// name; and a part that did not change does not move.
import { normalized_with_hashes } from './_normalize-hashes.ts';

/** Sets of value indices, one per axis: the cases are their product. */
type Block = number[][];

/**
 * `tuples` (each a value index per axis) folded into blocks whose products are exactly them: two
 * blocks equal on every axis but one become one, over and over, until none do.
 */
export function fold(tuples: readonly number[][], axes: number): Block[] {
	let blocks: Block[] = tuples.map((t) => t.map((v) => [v]));
	for (let changed = true; changed;) {
		changed = false;
		for (let a = axes - 1; a >= 0; a--) {
			const by = new Map<string, Block>();
			for (const b of blocks) {
				const key = b.map((s, i) => (i === a ? '' : s.join(','))).join('|');
				const found = by.get(key);
				if (found) {
					found[a] = [...found[a], ...b[a]].sort((x, y) => x - y);
					changed = true;
				} else
					by.set(
						key,
						b.map((s) => [...s])
					);
			}
			blocks = [...by.values()];
		}
	}
	return blocks;
}

type Group = { count: number; hashes: Map<string, number[][]> };

/** One grid file's outputs, as cases come in. */
export class GridReport {
	readonly #axes: ReadonlyArray<readonly [name: string, values: readonly string[]]>;
	readonly #parts = new Map<string, Map<string, Group>>();
	readonly #whole = new Set<string>();
	#cases = 0;

	/** `axes`: every axis a case names, in the order its lines list them. */
	constructor(axes: Record<string, readonly string[]>) {
		this.#axes = Object.entries(axes);
	}

	/** A case (its value on each axis) and its output, part by part, raw. */
	add(values: Record<string, string>, parts: Record<string, string>): void {
		const tuple = this.#axes.map(([name, vs]) => {
			const i = vs.indexOf(values[name]);
			if (i < 0) throw new Error(`no value ${values[name]} on the axis ${name}`);
			return i;
		});
		const whole: string[] = [];
		for (const [part, raw] of Object.entries(parts)) {
			const { text, hashes } = normalized_with_hashes(raw);
			whole.push(part, text);
			let groups = this.#parts.get(part);
			if (!groups) this.#parts.set(part, (groups = new Map()));
			let g = groups.get(text);
			if (!g) groups.set(text, (g = { count: 0, hashes: new Map() }));
			g.count++;
			const key = hashes.join(' ');
			const list = g.hashes.get(key);
			if (list) list.push(tuple);
			else g.hashes.set(key, [tuple]);
		}
		this.#whole.add(whole.join('\0'));
		this.#cases++;
	}

	get cases(): number {
		return this.#cases;
	}
	/** How many distinct whole outputs (every part) the cases gave. */
	get distinct(): number {
		return this.#whole.size;
	}

	#line(block: Block): string {
		return block
			.map((set, a) => {
				const [name, vs] = this.#axes[a];
				return `${name}=${set.length === vs.length ? '*' : set.map((i) => vs[i]).join('|')}`;
			})
			.join(' ');
	}

	/** The file: a heading, then each part's values (in the order first seen) with their cases. */
	render(title: string): string {
		const out = [
			`# ${title}`,
			`# ${this.#cases} cases, ${this.#whole.size} distinct outputs; per part: ${[...this.#parts]
				.map(([p, g]) => `${p} ${g.size}`)
				.join(', ')}.`,
			`# axes: ${this.#axes.map(([n, vs]) => `${n}=${vs.join('|')}`).join(' ')}`,
			''
		];
		for (const [part, groups] of this.#parts) {
			out.push(`################ ${part} · ${groups.size} distinct ################`, '');
			let n = 0;
			for (const [text, g] of groups) {
				out.push(`════ ${part} ${++n} · ${g.count} case${g.count === 1 ? '' : 's'} ════`);
				out.push(text);
				for (const [hashes, tuples] of g.hashes) {
					out.push(`──── ${hashes ? `with ${hashes}` : 'no hashes'} · ${tuples.length}:`);
					for (const block of fold(tuples, this.#axes.length)) out.push(this.#line(block));
				}
				out.push('');
			}
		}
		return out.join('\n');
	}
}
