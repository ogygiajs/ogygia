import type { Component } from 'svelte';
import { region_snippet } from './region-snippet.ts';
import { with_portable_forms } from './portable-form.ts';
import RawHtml from './RawHtml.svelte';
import { REGION_BRAND } from './region-brand.ts';
import { held_root_context, kit_page_facts_tail, kit_page_ready } from './server/kit-context.ts';
import { region_css_tags } from './server/html-scan.ts';
import { OgygiaError } from './messages/island.ts';

export { REGION_BRAND };

/** Schedule options for a held region. `wake` = when its JS runs; `margin` = IntersectionObserver
 * rootMargin for `wake: 'visible'`. Merged OVER the binding's baked schedule (from a `wake:` mark) —
 * anything set here WINS; a `region: 'raw'` binding bakes nothing, so this is the whole schedule. */
export type RegionOptions = { wake?: string; margin?: string };

/**
 * The `region()` schedule argument: a function handed the component's own props (its "generated
 * data") that returns the schedule. Always a function, never a bare object — the object case is the
 * baked `wake:` mark on the import. The function is for a registry of `region: 'raw'` components that
 * decides each one's timing from its data — e.g.
 * `region(block, data, (d) => ({ wake: d.interactive ? 'load' : undefined }))`.
 */
export type RegionSchedule<P = Record<string, unknown>> = (data: P) => RegionOptions;

/**
 * The `region()` data argument: `region(Card, props, { version: row.updatedAt })`. `version` is how
 * new the data behind this answer is: a number, a `Date`, or a date string. When two answers for the
 * same region reach the browser (two commands that both return it), the one with the newer version
 * stays on screen, whichever arrived last. Equal versions, or an answer without one, fall back to
 * arrival order. Only a held region has an address in the browser to order, so an inline region's
 * version has nothing to compare against.
 */
export type RegionData = { version?: number | Date | string };

function to_version(version: number | Date | string): number {
	const n =
		typeof version === 'number'
			? version
			: version instanceof Date
				? version.getTime()
				: Date.parse(version);
	if (!Number.isFinite(n))
		throw new OgygiaError('region_version_invalid', { version: String(version) });
	return n;
}

type AnyComponent = Component<Record<string, unknown>>;

/** A plain component. Renders in the current server pass; **awaiting** it bakes its SSR HTML so it
 *  can cross the wire as an HTML-only ticket (no chunk, no signer — nothing to fetch). */
export type InlineRegion = {
	readonly [REGION_BRAND]: true;
	readonly kind: 'inline';
	readonly component: AnyComponent;
	readonly props: Record<string, unknown>;
	/** Server-rendered HTML, present once the region has been awaited. What lets an inline region
	 *  (a content `body`) travel: the transport ships the markup, the runtime swaps it in and wakes
	 *  any islands inside it — the same machinery as body-swap navigation. */
	readonly html?: string;
	/** Content-body CSS key (`content_css_key`) for a `.svx`/`.md` body whose own scoped `<style>`
	 *  lives on no page stylesheet — the leak-free corpus is server-only, so its CSS never joins the
	 *  page's static import graph. Region.svelte resolves it through the handoff (`contentCss`) and
	 *  links the client CSS asset the plugin emitted. Absent for a body with no scoped `<style>`. */
	readonly content_id?: string;
};

/** A marked component: renders inline here, or becomes a signed ticket when it crosses the wire. */
export type DualRegion = {
	readonly [REGION_BRAND]: true;
	readonly kind: 'dual';
	readonly component: AnyComponent;
	readonly props: Record<string, unknown>;
	readonly id: string;
	readonly module: string;
	readonly hydrate?: string;
	readonly hydrateMargin?: string;
	/** Server signer, invoked by the transport at serialization. Never crosses the wire. `wakes`:
	 *  the component hydrates over the answer, so the endpoint renders it in its hydrate's context. */
	readonly sign: (id: string, props: Record<string, unknown>, wakes?: boolean) => string;
	/**
	 * Server-only renderer, invoked when the region is **awaited** (see {@link region}). Renders
	 * the component to HTML on the server so the ticket can travel with its markup — no client fetch.
	 * Provided by the SSR region-binding leg; never crosses the wire. `wakes`: the component hydrates
	 * over the HTML, so it renders in its hydrate's context.
	 */
	readonly renderHtml?: (
		props: Record<string, unknown>,
		wakes?: boolean
	) => string | Promise<string>;
	/** Server-rendered HTML, present once the region has been awaited. Rides the wire in the ticket. */
	readonly html?: string;
	/** The data version `region()` was given ({@link RegionData}), as a number. */
	readonly version?: number;
};

/** A held region that arrived over the wire: a signed capability, no component. */
export type DeferredRegion = {
	readonly [REGION_BRAND]: true;
	readonly kind: 'deferred';
	readonly id: string;
	readonly props: Record<string, unknown>;
	/** Signed `/__ogygia__?id&props&exp&sig` capability the runtime fetches. */
	readonly url: string;
	/** Client hydrate-module URL, imported after the HTML swaps in; `''` for a static region. */
	readonly module: string;
	/** Wake schedule ('load' | 'idle' | 'visible' | media); absent for a static region. */
	readonly hydrate?: string;
	/** IntersectionObserver rootMargin when `hydrate` is `'visible'`. */
	readonly hydrateMargin?: string;
	/**
	 * Server-rendered HTML baked into the ticket (the region was awaited before it crossed). When
	 * present the runtime swaps it in immediately and morphs across updates — no fetch. Absent → the
	 * runtime fetches the signed `url` as usual.
	 */
	readonly html?: string;
	/** The data version its server gave it ({@link RegionData}), as a number. */
	readonly version?: number;
};

export type RegionValue = InlineRegion | DualRegion | DeferredRegion;

/**
 * What {@link region} returns: a {@link RegionValue} you can render right now with `<Region of={…} />`,
 * AND a `PromiseLike<Region>` you can `await` to bake its server-rendered HTML into the ticket. In an
 * async generator (`query.live`) or async remote, `yield` / `return` awaits it for you.
 */
export type AwaitableRegion = RegionValue & PromiseLike<RegionValue>;

/** True for any value produced by {@link region} (or decoded from the wire). */
export function isRegion(value: unknown): value is RegionValue {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as Record<symbol, unknown>)[REGION_BRAND] === true
	);
}

type RegionBinding = {
	__ogRegion: string;
	__module: string;
	__hydrate?: string;
	__hydrateMargin?: string;
	__component?: Component<Record<string, unknown>>;
	__sign?: (entry: string, props: Record<string, unknown>, wakes?: boolean) => string;
	__renderHtml?: (props: Record<string, unknown>, wakes?: boolean) => string | Promise<string>;
};

function isBinding(value: unknown): value is RegionBinding {
	return (
		(typeof value === 'object' || typeof value === 'function') &&
		value !== null &&
		typeof (value as RegionBinding).__ogRegion === 'string'
	);
}

function make_region<P extends Record<string, unknown>>(
	component: Component<P>,
	props: P,
	opts?: RegionSchedule<P> | RegionData,
	content_id?: string
): AwaitableRegion {
	const p = (props ?? {}) as Record<string, unknown>;
	const o = typeof opts === 'function' ? opts(props) : undefined;
	const version =
		typeof opts === 'object' && opts?.version != null ? to_version(opts.version) : undefined;
	if (isBinding(component)) {
		if (!component.__component || !component.__sign) {
			if (typeof component === 'function') {
				const inlineWrap: InlineRegion = {
					[REGION_BRAND]: true,
					kind: 'inline',
					component: component as unknown as AnyComponent,
					props: p,
					...(content_id ? { content_id } : {})
				};
				return make_inline_awaitable(inlineWrap);
			}
			throw new OgygiaError('raw_region_on_client');
		}
		const hydrate = o?.wake ?? component.__hydrate;
		const hydrateMargin = o?.margin ?? component.__hydrateMargin;
		const dual: DualRegion = {
			[REGION_BRAND]: true,
			kind: 'dual',
			component: component.__component,
			props: p,
			id: component.__ogRegion,
			module: component.__module,
			...(hydrate ? { hydrate } : {}),
			...(hydrateMargin ? { hydrateMargin } : {}),
			sign: component.__sign,
			...(component.__renderHtml ? { renderHtml: component.__renderHtml } : {}),
			...(version === undefined ? {} : { version })
		};
		return make_awaitable(dual);
	}
	const inline: InlineRegion = {
		[REGION_BRAND]: true,
		kind: 'inline',
		component: component as unknown as AnyComponent,
		props: p,
		...(content_id ? { content_id } : {})
	};
	return make_inline_awaitable(inline);
}

function make_inline_awaitable(inline: InlineRegion): AwaitableRegion {
	// oxlint-disable-next-line unicorn/no-thenable -- a region is a thenable by design: `await region(C, props)` renders it
	Object.defineProperty(inline, 'then', {
		enumerable: false,
		configurable: true,
		writable: true,
		value(
			onFulfilled?: ((value: InlineRegion) => unknown) | null,
			onRejected?: ((reason: unknown) => unknown) | null
		) {
			const run = async (): Promise<InlineRegion> => {
				if (typeof document !== 'undefined') return { ...inline };
				if (inline.html != null) return { ...inline };
				// Plain static specifier — Vite MUST resolve this to the app's single `svelte/server`
				// instance. A computed/`@vite-ignore` specifier resolves to a SECOND instance whose
				// module-level `ssr_context` is disjoint from the page render's, so nested body renders
				// tear down the outer render's context → `push_element` reads null (a systemic 500). The
				// `typeof document` guard above already keeps this leg server-only.
				const { render } = await import('svelte/server');
				// A fresh root: hand it Kit's `__request__` context — the page of the render
				// (server/render-page.ts), awaited first: a region a remote call renders reads its page.
				// A held region's root: a lake's inside, with no head of its own (`held_root_context`).
				await kit_page_ready();
				const r = await render(inline.component, {
					props: inline.props,
					context: held_root_context()
				});
				// Keep nested regions' stylesheets — a body's server-picked blocks emit their region CSS
				// via head (a `<link>`, or an inline `<style>` under Kit's inlineStyleThreshold), and
				// dropping either form would ship them unstyled.
				const nested = region_css_tags(r.head);
				// Spread copies only enumerable own props → drops `then`, so `await` settles here.
				// (and the page facts its islands read, when it rendered for a page: server/render-page.ts)
				return { ...inline, html: nested + r.body + kit_page_facts_tail() };
			};
			return run().then(onFulfilled, onRejected);
		}
	});
	return inline as AwaitableRegion;
}

function make_awaitable(dual: DualRegion): AwaitableRegion {
	if (!dual.renderHtml) return dual as AwaitableRegion;
	// oxlint-disable-next-line unicorn/no-thenable -- a region is a thenable by design: `await region(C, props)` renders it
	Object.defineProperty(dual, 'then', {
		enumerable: false,
		configurable: true,
		writable: true,
		value(
			onFulfilled?: ((value: DualRegion) => unknown) | null,
			onRejected?: ((reason: unknown) => unknown) | null
		) {
			const run = async (): Promise<DualRegion> => {
				// `renderHtml` (generated per binding) already prefixes the component's stylesheet
				// `<link>`s — the page never imported this server-picked component, so its CSS is on no
				// page stylesheet; the client hoists those links to <head>.
				const html = dual.renderHtml
					? await dual.renderHtml(with_portable_forms(dual.props), !!dual.hydrate)
					: undefined;
				return { ...dual, ...(html != null ? { html } : {}) };
			};
			return run().then(onFulfilled, onRejected);
		}
	});
	return dual as AwaitableRegion;
}

/**
 * INTERNAL (content formats): an inline region whose SSR HTML is already known — a serialized-region
 * content body, baked at markdown-compile time. Renders like any inline region (the component is the
 * thin `{@html}` shell the emitter produced); awaiting it is a no-op because the HTML is present from
 * birth, so the wire crossing never pays a svelte/server render.
 */
export function prebaked_region(
	component: Component<Record<string, never>>,
	html: string,
	content_id?: string
): AwaitableRegion {
	const inline: InlineRegion = {
		[REGION_BRAND]: true,
		kind: 'inline',
		component: component as unknown as AnyComponent,
		props: {},
		html,
		...(content_id ? { content_id } : {})
	};
	return make_inline_awaitable(inline);
}

/**
 * Make a held region with type-checked props: a value you can pass around and render with
 * `<Region of={f} />`.
 *
 * - A plain component import → an **inline** region (renders in this pass; can't cross the wire).
 * - A component imported `with { region: 'raw' }` → a **dual** region: inline where it's made,
 *   a signed ticket where it travels (the transport drops the component and signs it, so it arrives
 *   as a **deferred** region). Minting the marked form is server-only (the signer lives on the SSR
 *   leg) — call it in a load / remote / render context; on the client it throws. A component marked
 *   with `wake:` is a binding too, and on the client it renders inline.
 *
 * **A dual region is awaitable.** `await region(Card, props)` renders the component to HTML on
 * the server (snippets in the props in their portable form) and bakes it into the ticket, so the
 * client swaps it in with no extra request. The awaited value is a plain copy, not a thenable. In an
 * async generator (`query.live`) or an async remote, `yield region(…)` / `return region(…)` is
 * awaited by the language, so the HTML travels automatically — LiveView over the channel you already
 * have. A held region you *don't* await renders inline where it lands (first paint, same SSR pass).
 * A dual region with no server renderer is not awaitable; an inline one awaited on the client
 * settles to a plain copy.
 *
 * `region.snippet()` is the snippet form of a region.
 */
export const region: typeof make_region & { snippet: typeof region_snippet } = Object.assign(
	make_region,
	{
		snippet: region_snippet
	}
);

/**
 * A pure-HTML region — what `import.meta.og.code()` / `.md()` inline. The html is baked at build
 * (Shiki / markdown), so this is an INLINE region whose component ({@link RawHtml}) simply renders
 * the html in the page's own SSR pass. Static by construction: it ships as HTML and no client JS of
 * its own. Rendered like any region: `<Region of={…} />`.
 */
export function og_html_region(html: string): InlineRegion {
	return {
		[REGION_BRAND]: true,
		kind: 'inline',
		component: RawHtml as AnyComponent,
		props: { html }
	};
}
