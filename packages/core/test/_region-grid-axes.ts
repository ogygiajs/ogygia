/** Where in the page a region renders: what the regions above it set. */
export const AT = ['page', 'island', 'live-snippet', 'lake', 'answer', 'woken-answer'] as const;
/** The render root above it: none (an isolated render), Kit's page pass, a region below a region in
 *  Kit's pass, or a root ogygia started (its own render, with the request's event). */
export const KIT = ['none', 'pass', 'pass-inner', 'ogygia'] as const;
/** Whether the document is one Kit hydrates (csr=true). */
export const CSR = ['off', 'on'] as const;
/** A page render, or an error page's. */
export const PAGE = ['ok', 'error'] as const;
export const ENV = ['dev', 'prod'] as const;

export type Place = {
	at: (typeof AT)[number];
	kit: (typeof KIT)[number];
	csr: (typeof CSR)[number];
	page: (typeof PAGE)[number];
	env: (typeof ENV)[number];
};
export type ClientPlace = Pick<Place, 'at' | 'csr' | 'env'>;

/** The cartesian product of `axes`, the first axis slowest. */
export function product<K extends string>(
	axes: Record<K, readonly string[]>
): Array<Record<K, string>> {
	let out: Array<Record<string, string>> = [{}];
	for (const [name, values] of Object.entries(axes) as Array<[K, readonly string[]]>) {
		const next: Array<Record<string, string>> = [];
		for (const row of out) for (const v of values) next.push({ ...row, [name]: v });
		out = next;
	}
	return out as Array<Record<K, string>>;
}

/** Every place, in a fixed order. */
export const PLACES: readonly Place[] = product({
	at: AT,
	kit: KIT,
	csr: CSR,
	page: PAGE,
	env: ENV
}) as Place[];

/** Every place a region is created in the browser: where in the page, on which document, dev or
 *  production. (The render root and an error page are the server's: the browser reads neither.) */
export const CLIENT_PLACES: readonly ClientPlace[] = product({
	at: AT,
	csr: CSR,
	env: ENV
}) as ClientPlace[];

/** The places a browser HYDRATES a region over the server's HTML: Kit's hydration of a csr=true
 *  document (a page and an error page), an island's hydration of what is nested in it (on either
 *  document), a live snippet's body, and a woken hole's answer. Each with the server place that
 *  rendered it. */
export const HYDRATE_PLACES: ReadonlyArray<{ client: ClientPlace; server: Place }> = ENV.flatMap(
	(env) =>
		(
			[
				['page', 'on', 'pass', 'ok'],
				['page', 'on', 'pass', 'error'],
				['island', 'off', 'pass', 'ok'],
				['island', 'on', 'pass', 'ok'],
				['live-snippet', 'off', 'pass', 'ok'],
				['live-snippet', 'on', 'pass', 'ok'],
				['woken-answer', 'off', 'ogygia', 'ok'],
				['woken-answer', 'on', 'ogygia', 'ok']
			] as const
		).map(([at, csr, kit, page]) => ({
			client: { at, csr, env },
			server: { at, csr, kit, page, env }
		}))
);

/** A kind's axes, in name order, each value list in a fixed order; and the axes the harness reads
 *  on the server only (no client counterpart). */
export type KindAxes = {
	axes: Record<string, readonly string[]>;
	server_only?: readonly string[];
};

const WAKES = ['load', 'idle', 'visible', 'visible-margin', 'interaction', 'media'] as const;
const HELD_WAKES = ['none', 'load', 'idle', 'visible', 'interaction', 'media'] as const;
const PROPS = ['absent', 'empty', 'json', 'devalue', 'snippet', 'live', 'ref'] as const;
const SNIPPETS = ['none', 'text', 'island', 'hole'] as const;

export const KIND_AXES: Readonly<Record<string, KindAxes>> = {
	island: {
		axes: {
			wake: WAKES,
			keep: ['none', 'nav'],
			children: SNIPPETS,
			component: ['tiny', 'wrap', 'late', 'tiny+late'],
			props: PROPS,
			ttl: ['0', '60'],
			known: ['no', 'yes']
		},
		server_only: ['known']
	},
	hole: {
		axes: {
			when: ['load', 'idle', 'visible'],
			wake: ['none', 'module-only', 'load', 'idle', 'visible', 'interaction', 'media'],
			attrs: ['none', 'all'],
			ttl: ['0', '60'],
			fallback: SNIPPETS,
			props: ['absent', 'empty', 'json', 'devalue', 'snippet'],
			component: ['tiny', 'none'],
			building: ['no', 'yes'],
			page_version: ['no', 'yes']
		},
		server_only: ['building', 'page_version']
	},
	lake: {
		axes: {
			remount: ['cache', 'empty', 'swr'],
			when: ['none', 'idle'],
			max_age: ['none', '30'],
			on_expire: ['none', 'empty', 'fetch'],
			margin: ['none', '5px'],
			children: SNIPPETS,
			props: PROPS
		}
	},
	inline: {
		axes: {
			content: ['none', 'post-1', 'unknown'],
			component: ['tiny', 'wrap'],
			children: SNIPPETS,
			placeholder: ['none', 'text']
		}
	},
	dual: {
		axes: {
			wake: HELD_WAKES,
			margin: ['none', '9px'],
			thenable: ['no', 'yes'],
			module: ['dual', 'none'],
			component: ['tiny', 'wrap'],
			children: SNIPPETS,
			placeholder: ['none', 'text']
		}
	},
	deferred: {
		axes: {
			html: ['none', 'live'],
			baked: ['no', 'yes'],
			wake: HELD_WAKES,
			margin: ['none', '3px'],
			module: ['none', 'held'],
			children: SNIPPETS,
			placeholder: ['none', 'text']
		}
	},
	promise: {
		axes: {
			settles: ['never', 'live', 'deferred', 'rejects'],
			children: SNIPPETS,
			placeholder: ['none', 'text']
		}
	},
	nothing: { axes: { children: SNIPPETS, placeholder: ['none', 'text'] } }
};
