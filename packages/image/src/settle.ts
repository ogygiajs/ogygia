/**
 * SETTLE: one verified recipe → its file. The original is read (./reader.ts), made into the file by
 * the app's maker (`virtual:ogygia-image/maker`, ./maker.ts) and kept in the maker's store by the
 * recipe, so the next ask (this process, a restart, the next build) is a file read, streamed. A file
 * the store could not keep (no store, or a write that failed) is kept in memory instead, the least
 * recently asked going first. Loaded on the first image request only.
 *
 * Asks for one file share one make. A few makes run at once; on a live server a bounded line
 * waits behind them, for a bounded time, and an ask past it is answered 503 with a `retry-after`.
 * The build and the dev server queue every ask: their pages name each file once.
 *
 * @packageDocumentation
 */
import { bucket32 } from '@ogygia/core/contract';
import {
	cache,
	clock,
	flights,
	queue,
	STALE,
	type Fresh,
	type Place,
	type Queue
} from '@ogygia/machine';
import { make, parallel, store } from 'virtual:ogygia-image/maker';
import { build_handoff } from './handoff.ts';
import { mime_of } from './layout.ts';
import { said, said_each, warn } from './messages.ts';
import { remote as REMOTE, transport } from 'virtual:ogygia-image/remote';
import { card_original, draws, endpoint_images, NoCard } from './cards/read.ts';
import { RealmAnswer } from './cards/images.ts';
import { CannotMake, SourceUnreadable, type Kept } from './maker.ts';
import { Changed, read_original } from './reader.ts';
import { card_of_tail, remote_of_tail, type ParsedRecipe } from './recipe.ts';
import type { FailKind } from './remote-fetch.ts';

const MAX_WAITING = 64;
const FETCHES_MAX = 16;
const WAIT_MS = 30_000;
const RETRY_AFTER_S = 5;
const MEMORY_MAX = 64 * 1024 * 1024;

const live = build_handoff() === null;

class Busy extends RealmAnswer {}

type Job = { run: () => Promise<void>; gone: () => void };

class Line {
	readonly #name: string;
	readonly #jobs: Queue<Job>;

	constructor(name: string, max: number) {
		this.#name = name;
		this.#jobs = queue<Job>({
			name,
			max,
			start: (job: Job, place: Place) => {
				// oxlint-disable-next-line ogygia/no-silent-failures -- run() settles its caller's promise with the failure and never rejects itself
				void job.run().finally(() => place.release());
			},
			stale: (job: Job) => job.gone()
		});
	}

	run<T>(work: () => Promise<T>): Promise<T> {
		const waiting = this.#jobs.waiting;
		if (live && waiting >= MAX_WAITING) {
			said.once(`image_busy ${this.#name}`, () => warn('image_busy', { waiting }));
			return Promise.reject(new Busy());
		}
		if (waiting === 0) said.ok(`image_busy ${this.#name}`);
		return new Promise<T>((resolve, reject) => {
			this.#jobs.push(
				{ run: () => work().then(resolve, reject), gone: () => reject(new Busy()) },
				live ? clock.mono() + WAIT_MS : undefined
			);
		});
	}
}

const encodes = new Line('image encodes', parallel);
const fetches = new Line('image remote fetches', FETCHES_MAX);

interface Made {
	data: Uint8Array;
	on_disk: boolean;
	header: string;
	keep_ms: number;
}

interface Window {
	key: string;
	header: string;
	left: number;
}

interface Ask {
	key: string;
	recipe: ParsedRecipe;
	original: string;
	url: URL | null;
	card: boolean;
	window: Window | null;
	platform: unknown;
}

class Refused extends RealmAnswer {
	readonly status: number;
	readonly url: string | null;

	constructor(status: number, reason: string, url: string | null = null) {
		super(reason);
		this.status = status;
		this.url = url;
	}
}

const FAILED_KEEP_MS = 30_000;

const failed_remotes = cache<string, Refused>({
	name: 'image remote failures',
	max: 1024,
	keep: FAILED_KEEP_MS
});

function remembered(url: string, e: unknown): unknown {
	if (!(e instanceof Refused)) return e;
	const named = e.url === null ? new Refused(e.status, e.message, url) : e;
	failed_remotes.set(url, named);
	return named;
}

const STATUS_OF: Readonly<Record<FailKind, number>> = {
	status: 502,
	'no answer': 502,
	'not an image': 502,
	timeout: 504,
	'too large': 413,
	private: 404
};

const remote_originals = flights.keyed<{ url: string }>()<'url', never, Promise<Uint8Array>>({
	name: 'remote originals',
	key: ['url'],
	keep: 0,
	run: async ({ url }: { url: string }): Promise<Uint8Array> => {
		if (REMOTE === null || transport === null)
			throw new Refused(404, 'image({ remote }) is not set');
		const [{ fetch_image, HopRefused, RemoteFailed }, { RemoteHosts }, get] = await Promise.all([
			import('./remote-fetch.ts'),
			import('./remote-hosts.ts'),
			transport()
		]);
		try {
			const remote = REMOTE;
			const got = await fetches.run(() =>
				fetch_image({
					url: new URL(url),
					hosts: new RemoteHosts(remote.hosts),
					limits: remote,
					get
				})
			);
			return got!.bytes;
		} catch (e) {
			if (e instanceof HopRefused) throw new Refused(404, e.message);
			if (e instanceof RemoteFailed) throw new Refused(STATUS_OF[e.kind], e.message);
			throw e;
		}
	}
});

interface Original {
	bytes: Uint8Array;
	shown: boolean;
}

const card_originals = flights.keyed<{ tail: string; id: string }>()<
	'tail' | 'id',
	never,
	Promise<Original>
>({
	name: 'card originals',
	key: ['tail', 'id'],
	keep: 0,
	run: async ({ tail, id }: { tail: string; id: string }): Promise<Original> => {
		let shown = false;
		const images = endpoint_images(
			REMOTE === null
				? null
				: (url) => {
						shown = true;
						return remote_bytes(url);
					}
		);
		const bytes = await card_original(tail, id, images);
		return { bytes, shown };
	}
});

async function remote_bytes(url: URL): Promise<Uint8Array> {
	const failed = failed_remotes.get(url.href);
	if (failed !== undefined) throw failed;
	let bytes: Uint8Array | typeof STALE;
	try {
		bytes = await remote_originals.get({ url: url.href });
	} catch (e) {
		throw remembered(url.href, e);
	}
	if (bytes === STALE) throw new Refused(502, 'the fetch was dropped before it finished', url.href);
	said_each.ok(`image_remote_refused ${url.href}`);
	return bytes;
}

async function original_bytes(ask: Ask): Promise<Original> {
	if (ask.card) {
		const drawn = await card_originals.get({ tail: ask.recipe.tail, id: ask.recipe.id });
		if (drawn === STALE) throw new Error('the card was dropped before it was drawn');
		return drawn;
	}
	if (ask.url !== null) return { bytes: await remote_bytes(ask.url), shown: true };
	return { bytes: await read_original(ask.original, ask.recipe.id), shown: false };
}

const makes = flights.keyed<Ask>()<
	'key',
	'recipe' | 'original' | 'url' | 'card' | 'window' | 'platform',
	Promise<Made>
>({
	name: 'image files',
	key: ['key'],
	ignore: {
		recipe: 'the key is the recipe',
		original: 'the key names the source by content, and a run checks the original against it',
		url: "the key's tail names a remote source's URL, and its id the URL",
		card: "the key's id names a card's digest, size and props",
		window:
			"the asking time's remote.maxAge window: a make from remote bytes keeps its file under the window it started in, in memory to that window's end",
		platform: "one process's requests carry the same bindings"
	},
	keep: (made: Fresh<Made>) => (made.on_disk ? 0 : made.keep_ms),
	max: MEMORY_MAX,
	weigh: (made: Fresh<Made>) => made.data.byteLength,
	run: async (ask: Ask): Promise<Made> => {
		const fetched = ask.url === null ? null : await remote_bytes(ask.url);
		return encodes.run(async (): Promise<Made> => {
			const original: Original =
				fetched === null ? await original_bytes(ask) : { bytes: fetched, shown: true };
			const bytes = original.bytes;
			const window = original.shown ? ask.window : null;
			let data: Uint8Array;
			try {
				data = await make(bytes, ask.recipe, ask.platform);
			} catch (e) {
				if (ask.url === null || !(e instanceof SourceUnreadable)) throw e;
				throw remembered(
					ask.url.href,
					new Refused(502, `the image did not decode: ${(e as Error).message}`, ask.url.href)
				);
			}
			const file = window === null ? ask.key : `${ask.key}${window.key}`;
			const on_disk = store !== null && (await store.keep(file, data));
			return window === null
				? { data, on_disk, header: KEEP, keep_ms: Infinity }
				: { data, on_disk, header: window.header, keep_ms: window.left * 1000 };
		});
	}
});

const KEEP = 'public, max-age=31536000, immutable';

function spread(text: string, span: number): number {
	return bucket32(text) % span;
}

function remote_keep(max_age: number, now_s: number, url: string): Window {
	const span = Math.max(1, max_age);
	const at = Math.floor(now_s) + spread(url, span);
	const window = Math.floor(at / span);
	const left = Math.max(1, (window + 1) * span - at);
	return {
		key: `@${span}.${window}`,
		header: `public, max-age=${left}, stale-while-revalidate=${max_age}`,
		left
	};
}

async function kept_file(
	key: string,
	plain: boolean,
	window: Window | null
): Promise<{ file: Kept; header: string } | null> {
	if (store === null) return null;
	const own = plain ? await store.open(key) : null;
	if (own) return { file: own, header: KEEP };
	if (window === null) return null;
	const windowed = await store.open(`${key}${window.key}`);
	return windowed ? { file: windowed, header: window.header } : null;
}

/** The response for one verified recipe (`key` its file, ../recipe.ts `recipe_file`; `original` the
 *  asset URL Kit's `read()` takes; `platform` the request's `event.platform`). A file made from a
 *  remote URL's bytes (a recipe whose tail names the URL, fetched under `image({ remote })`, or a
 *  card that shows a remote image) is kept, and answered to be kept, until the end of the current
 *  `remote.maxAge` window, never forever, so the URL's new bytes go out within that time; a card
 *  that shows only the build's images is kept forever. */
export async function settle(
	recipe: ParsedRecipe,
	key: string,
	original: string,
	platform?: unknown
): Promise<Response> {
	const type = mime_of(recipe.format);
	const url = remote_of_tail(recipe.tail);
	const card = card_of_tail(recipe.tail) !== null;
	if (card && !draws) return built_card(key, original, type, platform);
	const window =
		url === null && !card
			? null
			: remote_keep(REMOTE?.maxAge ?? 0, clock.wall() / 1000, url?.href ?? key);
	try {
		const kept = await kept_file(key, url === null, window);
		if (kept) {
			return new Response(kept.file.body, {
				headers: {
					'content-type': type,
					'content-length': String(kept.file.size),
					'cache-control': kept.header
				}
			});
		}
		const made = await makes.get({ key, recipe, original, url, card, window, platform });
		if (made === STALE) return failed(key, 'the encode was dropped before it finished');
		return new Response(new Uint8Array(made.data), {
			headers: {
				'content-type': type,
				'content-length': String(made.data.byteLength),
				'cache-control': made.header
			}
		});
	} catch (e) {
		if (e instanceof Busy)
			return new Response('the image endpoint is busy', {
				status: 503,
				headers: { 'cache-control': 'no-store', 'retry-after': String(RETRY_AFTER_S) }
			});
		if (e instanceof Refused) {
			const named = e.url ?? url?.href ?? key;
			said_each.once(`image_remote_refused ${named}`, () =>
				warn('image_remote_refused', { url: named, status: e.status, reason: e.message })
			);
			return new Response('the remote image could not be fetched', {
				status: e.status,
				headers: { 'cache-control': 'no-store' }
			});
		}
		if (e instanceof CannotMake) return cannot_make(e);
		if (e instanceof Changed || e instanceof NoCard) {
			warn('image_source_changed', { path: key, tail: recipe.tail });
			return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
		}
		return failed(key, (e as Error).message);
	}
}

interface Assets {
	fetch(url: URL): Promise<Response>;
}

function assets_of(platform: unknown): Assets | null {
	const env = (platform as { env?: { ASSETS?: Partial<Assets> } } | undefined)?.env;
	return typeof env?.ASSETS?.fetch === 'function' ? (env.ASSETS as Assets) : null;
}

async function built_card(
	key: string,
	built: string,
	type: string,
	platform: unknown
): Promise<Response> {
	const assets = assets_of(platform);
	const res = assets === null ? null : await assets.fetch(new URL(built, 'https://assets.invalid'));
	if (res?.ok)
		return new Response(res.body, { headers: { 'content-type': type, 'cache-control': KEEP } });
	said_each.once(`image_no_encoder card ${key}`, () =>
		warn('image_no_encoder', {
			what: 'card',
			reason: `the card ${key} was not made by the build under this name (no prerendered page names it, or it shows a remote image, so the build named it by the bytes it got), and this server draws no card`
		})
	);
	return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
}

function failed(key: string, reason: string): Response {
	warn('image_settle_failed', { path: key, reason });
	return new Response('image could not be made', {
		status: 500,
		headers: { 'cache-control': 'no-store' }
	});
}

function cannot_make(e: CannotMake): Response {
	said.once(`${e.code} ${JSON.stringify(e.args)}`, () => warn(e.code, e.args));
	return new Response('this server cannot make images', {
		status: 500,
		headers: { 'cache-control': 'no-store' }
	});
}
