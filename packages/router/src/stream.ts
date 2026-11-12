/**
 * STREAMED PAGES — `page(async function* (c, data) { yield region(...); ... })`.
 *
 * "The next state of a slot is a region" is the house law (`query.live` yields regions over the
 * push channel); this is the same vocabulary on the INITIAL response: the FIRST yield renders in
 * the document and the page flushes immediately; every later yield rides down the SAME response
 * as an inert `<template data-og-late>` chunk that swaps into the slot as it parses. One
 * connection, closed when the generator ends — no SSE, no second round trip, and no Svelte
 * streaming needed: each yield is an ordinary synchronous render, only the DOCUMENT is chunked.
 *
 * Islands inside late chunks need no orchestration: `<ogygia-region>` is a custom element, so
 * the moment swapped content lands in the DOM it upgrades, connects, and wakes on its own
 * schedule — the runtime never has to be told.
 *
 * Swapping is driven by ONE small classic inline script in the head (module scripts don't run
 * until parsing ENDS, which for a streamed document is the very thing we're not waiting for).
 * The slot, chunk and boot script are core's late wire (`ogygia/plugin`): core's `<Region
 * of={promise}>` emits the same slots and its runtime applies the same chunks. SPA navigations
 * fetch the COMPLETED stream, so there the runtime applies remaining templates after the body swap.
 *
 * Streaming's honest trades (documented): status/title/headers flush with the first yield — a
 * late error can't change an already-sent 200, and Server-Timing set after the flush is lost.
 */
import { lateChunk as late_chunk, LATE_BOOT_SCRIPT } from '@ogygia/core/plugin';
import { escapeText as escape_text } from '@ogygia/core/plugin/utils';
import { cleanup_failed, next_tag, OG_LATE_ERROR, text_of } from '@ogygia/core/internal/server';
import { scope, STALE, type Scope } from '@ogygia/machine';

/** The slot id for the page position (one streamed slot per page in v1). */
export const PAGE_SLOT_ID = 'pg';

/** Bake ANY yielded value to html: a string passes through, an inline region carries its html,
 *  a component/held region AWAITS into its bake (island shells + prefixed CSS links included —
 *  the same path federated widgets take). */
export async function bake_yield(v: unknown): Promise<string> {
	if (typeof v === 'string') return v;
	if (v && typeof v === 'object') {
		const o = v as {
			kind?: string;
			html?: unknown;
			props?: { html?: unknown };
			then?: unknown;
		};
		// A still-thenable region (yielded from a SYNC generator, or handed in directly): bake it.
		// NOTE an ASYNC generator's `yield` awaits thenables ITSELF, so the usual arrival here is
		// the RESOLVED shape — `{ kind, html }` with the bake done (this bit the e2e while the
		// string-only unit tests stayed green: test the real shapes).
		if (typeof o.then === 'function') return bake_yield(await (v as PromiseLike<unknown>));
		// resolved inline/dual carry top-level `html`; a raw og_html_region carries `props.html`
		const html = o.html ?? o.props?.html;
		if (html != null) return String(html);
		if (o.kind != null)
			// a region with NO html after resolution: an unmarked import in a server-only module
			// bakes nothing (no identity, no client leg — the round-1 `region: 'raw'` rule).
			throw new Error(
				"[@ogygia/router] a yielded region did not bake — mark its import (`with { region: 'raw' }` or a wake) so the component has an identity + client leg."
			);
	}
	throw new Error(
		'[@ogygia/router] a streamed page must yield regions (region(C, props) / og_html_region(html)) or html strings.'
	);
}

/** Is this page slot an async-generator function? (Svelte components are plain functions —
 *  never async generators — so this discriminator needs no brand.) */
export function is_stream_slot(v: unknown): v is (...args: never[]) => AsyncGenerator<unknown> {
	return Object.prototype.toString.call(v) === '[object AsyncGeneratorFunction]';
}

/** Where the document's head ends (its `</head` end tag), or -1 when it has none. */
function head_end(html: string): number {
	const head = next_tag(html, 'head', 0);
	const text = head === null ? null : text_of(html, head, 'head');
	return text === null ? -1 : head!.end + text.length;
}

const NO_TRANSFORM_RE = /no-transform/i;

/**
 * Turn a fully-rendered document (first yield in place) + the generator's REMAINING yields into
 * a streamed Response: flush everything up to `</body>` now, append one template chunk per
 * later yield, then the tail. A generator throw after the flush becomes an inline error-card
 * chunk (the page must never end broken) — the status is already on the wire, which is
 * streaming's documented trade.
 */
/** One late chunk headed for one slot — the multi-slot unit `stream_document` drains. */
export interface LateChunk {
	slot: string;
	html: string;
}

/** Adapt a page GENERATOR's remaining yields into page-slot chunks (bake included). */
export async function* page_slot_chunks(rest: AsyncGenerator<unknown>): AsyncGenerator<LateChunk> {
	for (;;) {
		const n = await rest.next();
		if (n.done) return;
		yield { slot: PAGE_SLOT_ID, html: await bake_yield(n.value) };
	}
}

export function stream_document(
	full_html: string,
	res: Response,
	rest: AsyncGenerator<LateChunk>,
	/** the slot an ERROR CARD lands in when the chunk source itself throws */
	error_slot: string = PAGE_SLOT_ID,
	/** the request's owner: its end (the visitor left) ends the stream too */
	request?: Scope
): Response {
	const at = head_end(full_html);
	const with_boot =
		at === -1 ? full_html : full_html.slice(0, at) + LATE_BOOT_SCRIPT + full_html.slice(at);
	const cut = with_boot.lastIndexOf('</body>');
	const head_part = cut === -1 ? with_boot : with_boot.slice(0, cut);
	const tail_part = cut === -1 ? '' : with_boot.slice(cut);
	const enc = new TextEncoder();

	// The response's owner, the request's child: the visitor leaving (the body cancelled, or the
	// request's signal) closes it, ends the chunk source (its generators' `finally` blocks run, and
	// a merged source ends the ones it holds) and drops what lands after (#284).
	const owner = scope(request);
	owner.defer(() => void rest.return(undefined).catch(cleanup_failed));
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			controller.enqueue(enc.encode(head_part));
			try {
				for (;;) {
					const n = await owner.task(() => rest.next());
					if (n === STALE) return;
					if (n.done) break;
					controller.enqueue(enc.encode(late_chunk(n.value.slot, n.value.html)));
				}
			} catch (e) {
				if (owner.closed) return;
				controller.enqueue(enc.encode(late_chunk(error_slot, error_card_html(e))));
			}
			controller.enqueue(enc.encode(tail_part));
			controller.close();
			owner.close();
		},
		cancel() {
			owner.close();
		}
	});

	const headers = new Headers(res.headers);
	headers.delete('content-length'); // a stream has none — a stale length truncates the document
	// no-transform: compressing intermediaries (CDNs, vite preview's gzip) BUFFER while they
	// compress, which collapses the stream back into one late paint — the flushed-first-chunk
	// point of this response. The standard header tells them to pass bytes through as-is.
	const cc = headers.get('cache-control');
	if (!cc) headers.set('cache-control', 'no-transform');
	else if (!NO_TRANSFORM_RE.test(cc)) headers.set('cache-control', `${cc}, no-transform`);
	return new Response(body, { status: res.status, headers });
}

/** The in-slot failure card (message escaped) — a stream must never end broken or empty. */
export function error_card_html(e: unknown): string {
	const msg = e instanceof Error ? e.message : String(e);
	return (
		`<div ${OG_LATE_ERROR} style="border:1px dashed #dc2626;border-radius:8px;padding:1rem;color:#dc2626">` +
		`This section failed to load. ${escape_text(msg)}</div>`
	);
}

/** Drain registered LATE REGIONS (`<Region of={promise}>` holes) in COMPLETION order — the slot
 *  that resolves first streams first. A rejection becomes that slot's error card; the others are
 *  unaffected (per-slot isolation, the same law as mounts). */
export async function* late_region_chunks(
	list: ReadonlyArray<{ id: string; promise: Promise<unknown> }>
): AsyncGenerator<LateChunk> {
	const pending = new Map(
		list.map(({ id, promise }) => [
			id,
			promise.then(
				async (v) => ({ id, html: await bake_yield(v) }),
				(e: unknown) => ({ id, html: error_card_html(e) })
			)
		])
	);
	while (pending.size) {
		const { id, html } = await Promise.race(pending.values());
		pending.delete(id);
		yield { slot: id, html };
	}
}

/**
 * Every late chunk of the document, until nothing new registers. A chunk bakes its region as its
 * promise settles, and a region baked there may hold a `<Region of={promise}>` of its own: it
 * registers then, after the document's list was taken. So after each chunk the request's late
 * regions are taken again (`take`), and whatever registered joins as one more source, in
 * completion order with the rest. It ends only when every source ended and a last take finds
 * none: no slot is left that nothing fills.
 */
export async function* until_drained(
	first: AsyncGenerator<LateChunk>,
	take: () => ReadonlyArray<{ id: string; promise: Promise<unknown> }> | null
): AsyncGenerator<LateChunk> {
	const sources: AsyncGenerator<LateChunk>[] = [];
	// oxlint-disable-next-line ogygia/no-promise-cache -- not a cache: each source's one pending next(), raced and replaced as each lands
	const nexts = new Map<number, Promise<{ i: number; r: IteratorResult<LateChunk> }>>();
	const add = (source: AsyncGenerator<LateChunk>) => {
		const i = sources.push(source) - 1;
		nexts.set(
			i,
			source.next().then((r) => ({ i, r }))
		);
	};
	const take_more = () => {
		const more = take();
		if (more?.length) add(late_region_chunks(more));
	};
	add(first);
	try {
		for (;;) {
			if (nexts.size === 0) {
				take_more();
				if (nexts.size === 0) return;
			}
			const { i, r } = await Promise.race(nexts.values());
			if (r.done) {
				nexts.delete(i);
				continue;
			}
			nexts.set(
				i,
				sources[i].next().then((res) => ({ i, r: res }))
			);
			yield r.value;
			take_more();
		}
	} finally {
		// ended early (the visitor left): every source it holds ends too
		end_all(sources);
	}
}

/** Ends each source (its `finally` runs once its pending step lands); one that already ended is
 *  left as it is. Nobody waits on that ending, so a `finally` that throws is said
 *  (`request_cleanup_failed`). */
function end_all(sources: readonly AsyncGenerator<LateChunk>[]): void {
	for (const s of sources) void s.return(undefined).catch(cleanup_failed);
}

/** Interleave chunk sources by READINESS (a page generator + the late-region pool run together;
 *  whichever has a chunk ready streams next). Ends when every source ends. */
export async function* merge_chunks(
	...sources: AsyncGenerator<LateChunk>[]
): AsyncGenerator<LateChunk> {
	const nexts = new Map(sources.map((s, i) => [i, s.next().then((r) => ({ i, r }))]));
	try {
		while (nexts.size) {
			const { i, r } = await Promise.race(nexts.values());
			if (r.done) nexts.delete(i);
			else {
				nexts.set(
					i,
					sources[i].next().then((res) => ({ i, r: res }))
				);
				yield r.value;
			}
		}
	} finally {
		// ended early (the visitor left): every source ends too
		end_all(sources);
	}
}
