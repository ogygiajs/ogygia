/**
 * Reactive column sort shared by the profiler's tables (was report.ts's TABLE_SORT_JS DOM hack).
 * Give it a getter for the rows and the initial numeric key; it owns the sort state and holds the
 * sorted view + a click handler. Svelte runes in a `.svelte.ts` module — imported by the table
 * islands, one instance each.
 */
// `T` is unconstrained (a typed row interface like `FrameStat` has no index signature, so it can't
// satisfy `Record<string, unknown>`); the string `key` indexes through a local cast, and `sorted`
// stays `T[]` so the tables read `row.name` etc. with real types.
export class Sortable<T> {
	#rows: () => T[];
	#key = $state('');
	#dir = $state<'asc' | 'desc'>('desc');
	#sorted = $derived.by(() =>
		[...this.#rows()].sort((a, b) => {
			const x = Number((a as Record<string, unknown>)[this.#key]) || 0;
			const y = Number((b as Record<string, unknown>)[this.#key]) || 0;
			return this.#dir === 'asc' ? x - y : y - x;
		})
	);

	constructor(rows: () => T[], initial_key: string) {
		this.#rows = rows;
		this.#key = initial_key;
	}

	get key(): string {
		return this.#key;
	}

	get sorted(): T[] {
		return this.#sorted;
	}

	click(k: string): void {
		if (this.#key === k) this.#dir = this.#dir === 'asc' ? 'desc' : 'asc';
		else {
			this.#key = k;
			this.#dir = 'desc';
		}
	}

	/** The little arrow for a header: ▲/▼ when it's the active column, else empty. */
	arrow(k: string): string {
		if (this.#key !== k) return '';
		return this.#dir === 'asc' ? ' ▲' : ' ▼';
	}

	/** The header's `aria-sort`: what a screen reader says the arrow means. */
	aria(k: string): 'ascending' | 'descending' | 'none' {
		if (this.#key !== k) return 'none';
		return this.#dir === 'asc' ? 'ascending' : 'descending';
	}
}
