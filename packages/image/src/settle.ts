/**
 * SETTLE: one signed recipe → its file. The original is read with Kit's `read()` (the image server
 * realm imports every image under `src/`, so each is one of the server's assets in dev, in the
 * prerender and on any adapter), checked against the id the recipe names (an original edited since
 * the page named it is not the source: 404, never its new pixels under the old name), encoded once,
 * and kept in the file store (./store.ts) by the recipe, so the next ask (this process, a restart,
 * the next build) is a file read, streamed. A file the
 * store could not keep (no store, or a write that failed) is kept in memory instead, the least
 * recently asked going first. Loaded on the first image request only: a server that never serves one
 * never loads sharp.
 *
 * Asks for one file share one encode. A few encodes run at once; on a live server a bounded line
 * waits behind them, for a bounded time, and an ask past it is answered 503 with a `retry-after`.
 * The build and the dev server queue every ask: their pages name each file once.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import os from 'node:os';
import { Readable } from 'node:stream';
import { read } from '$app/server';
import { clock, flights, queue, STALE, type Fresh, type Place } from '@ogygia/machine';
import { mime_of } from './layout.ts';
import { said, warn } from './messages.ts';
import { encode_recipe, VIPS_VERSION } from './pixels.ts';
import type { ParsedRecipe } from './recipe.ts';
import { build_handoff, FileStore, runtime_store, source_id } from './store.ts';

const MAX_ENCODES = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)));
const MAX_WAITING = 64;
const WAIT_MS = 30_000;
const RETRY_AFTER_S = 5;
const MEMORY_MAX = 64 * 1024 * 1024;

const handoff = build_handoff();
const store: FileStore | null = handoff
	? FileStore.shared(handoff.store)
	: runtime_store(VIPS_VERSION);
const live = handoff === null;

class Busy extends Error {}
class Changed extends Error {}

type Job = { run: () => Promise<void>; gone: () => void };
const encodes = queue<Job>({
	name: 'image encodes',
	max: MAX_ENCODES,
	start: (job: Job, place: Place) => {
		// oxlint-disable-next-line ogygia/no-silent-failures -- run() settles its caller's promise with the failure and never rejects itself
		void job.run().finally(() => place.release());
	},
	stale: (job: Job) => job.gone()
});

function limited<T>(work: () => Promise<T>): Promise<T> {
	if (live && encodes.waiting >= MAX_WAITING) {
		said.once('image_busy', () => warn('image_busy', { waiting: encodes.waiting }));
		return Promise.reject(new Busy());
	}
	if (encodes.waiting === 0) said.ok('image_busy');
	return new Promise<T>((resolve, reject) => {
		encodes.push(
			{ run: () => work().then(resolve, reject), gone: () => reject(new Busy()) },
			live ? clock.mono() + WAIT_MS : undefined
		);
	});
}

interface Made {
	data: Uint8Array;
	on_disk: boolean;
}

interface Ask {
	key: string;
	recipe: ParsedRecipe;
	original: string;
}

const makes = flights.keyed<Ask>()<'key', 'recipe' | 'original', Promise<Made>>({
	name: 'image files',
	key: ['key'],
	ignore: {
		recipe: 'the key is the recipe',
		original: 'the key names the source by content, and a run checks the original against it'
	},
	keep: (made: Fresh<Made>) => (made.on_disk ? 0 : Infinity),
	max: MEMORY_MAX,
	weigh: (made: Fresh<Made>) => made.data.byteLength,
	run: ({ key, recipe, original }: Ask): Promise<Made> =>
		limited(async (): Promise<Made> => {
			const bytes = new Uint8Array(await read(original).arrayBuffer());
			if (source_id(bytes) !== recipe.id) throw new Changed();
			const data = await encode_recipe(bytes, recipe);
			const on_disk = store !== null && (await store.keep(key, data));
			return { data, on_disk };
		})
});

/** Start making the file of `key` now (the prerender, as a page names it: the build's end finds it
 *  kept), unless it is kept. A failure is the build's end to report. */
export async function prepare(recipe: ParsedRecipe, key: string, original: string): Promise<void> {
	if (await store?.find(key)) return;
	await makes.get({ key, recipe, original });
}

const KEEP = 'public, max-age=31536000, immutable';

async function opened(key: string): Promise<{ stream: fs.ReadStream; size: number } | null> {
	const found = await store?.find(key);
	if (!found) return null;
	try {
		const handle = await fs.promises.open(found.file);
		return { stream: handle.createReadStream(), size: found.size };
		// oxlint-disable-next-line ogygia/no-silent-failures -- a file the store let go since it was found is a miss: it is made again
	} catch {
		return null;
	}
}

/** The response for one verified recipe (`key` its file, ../recipe.ts `recipe_file`; `original` the
 *  asset URL Kit's `read()` takes). */
export async function settle(
	recipe: ParsedRecipe,
	key: string,
	original: string
): Promise<Response> {
	const type = mime_of(recipe.format);
	try {
		const kept = await opened(key);
		if (kept) {
			const body = Readable.toWeb(kept.stream) as ReadableStream<Uint8Array>;
			return new Response(body, {
				headers: {
					'content-type': type,
					'content-length': String(kept.size),
					'cache-control': KEEP
				}
			});
		}
		const made = await makes.get({ key, recipe, original });
		if (made === STALE) return failed(key, 'the encode was dropped before it finished');
		return new Response(new Uint8Array(made.data), {
			headers: {
				'content-type': type,
				'content-length': String(made.data.byteLength),
				'cache-control': KEEP
			}
		});
	} catch (e) {
		if (e instanceof Busy)
			return new Response('the image endpoint is busy', {
				status: 503,
				headers: { 'cache-control': 'no-store', 'retry-after': String(RETRY_AFTER_S) }
			});
		if (e instanceof Changed) {
			warn('image_source_changed', { path: key, tail: recipe.tail });
			return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
		}
		return failed(key, (e as Error).message);
	}
}

function failed(key: string, reason: string): Response {
	warn('image_settle_failed', { path: key, reason });
	return new Response('image could not be made', {
		status: 500,
		headers: { 'cache-control': 'no-store' }
	});
}
