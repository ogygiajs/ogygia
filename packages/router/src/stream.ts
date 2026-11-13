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
		if (typeof o.then === 'function') return bake_yield(await (v as PromiseLike<unknown>));
		const html = o.html ?? o.props?.html;
		if (html != null) return String(html);
		if (o.kind != null)
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

/**
 * Turns a fully rendered document (first yield in place) and the remaining chunks into a streamed
 * Response: everything up to `</body>` flushes now, each later chunk follows as an inert
 * `<template>` that core's late boot script swaps into its slot as it parses, then the tail. The
 * status and headers go out with the first flush, so a later throw cannot change them: it becomes
 * an error card in `error_slot`. The stream ends when the visitor leaves (the body is cancelled)
 * or `request` ends, and its chunk source is ended with it.
 */
export function stream_document(
	full_html: string,
	res: Response,
	rest: AsyncGenerator<LateChunk>,
	error_slot: string = PAGE_SLOT_ID,
	request?: Scope
): Response {
	const at = head_end(full_html);
	const with_boot =
		at === -1 ? full_html : `${full_html.slice(0, at)}${LATE_BOOT_SCRIPT}${full_html.slice(at)}`;
	const cut = with_boot.lastIndexOf('</body>'); // markup-ok: as document-assembly.ts (#1410)
	const head_part = cut === -1 ? with_boot : with_boot.slice(0, cut);
	const tail_part = cut === -1 ? '' : with_boot.slice(cut);
	const enc = new TextEncoder();

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
	headers.delete('content-length');
	// @why a compressing proxy or CDN buffers a response while it compresses it, which turns the stream into one late paint; `no-transform` tells it to pass the bytes through (test: test/router-stream.test.ts › sets cache-control: no-transform when the page set no cache-control)
	const cc = headers.get('cache-control');
	if (!cc) headers.set('cache-control', 'no-transform');
	else if (!NO_TRANSFORM_RE.test(cc)) headers.set('cache-control', `${cc}, no-transform`);
	return new Response(body, { status: res.status, headers });
}

/** The in-slot failure card (message escaped) — a stream must never end broken or empty. */
export function error_card_html(e: unknown): string {
	const msg = e instanceof Error ? e.message : String(e);
	return `<div ${OG_LATE_ERROR} style="border:1px dashed #dc2626;border-radius:8px;padding:1rem;color:#dc2626">This section failed to load. ${escape_text(msg)}</div>`;
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
		end_all(sources);
	}
}

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
		end_all(sources);
	}
}
