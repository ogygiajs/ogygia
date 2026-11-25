/**
 * REMOTE IMAGES AT BUILD: `import.meta.og.image('https://images.example.com/hero.jpg')`, and a
 * markdown image or frontmatter URL on a listed host. The macro checks the URL against
 * `image({ remote: { hosts } })` and imports it as `virtual:ogygia-image/remote/<url>`; the plugin
 * resolves that to the image's file in the build cache, so from there it is a file source like any
 * other (its id the hash of its bytes, shipped as an asset, its placeholder, `warm`, the files of
 * prerendered pages).
 *
 *   node_modules/.ogygia/image/remote/<hash of the URL>.<ext>    the bytes
 *   node_modules/.ogygia/image/remote/<hash of the URL>.json     its URL, etag, last-modified
 *
 * Each process asks each URL once: with no copy, a plain GET; with one, a conditional GET, whose
 * 304 keeps the copy. Redirects are followed here, at most 3, each checked against `hosts`. The
 * body is counted as it arrives and dropped past `maxBytes`; the whole fetch, redirects and body
 * included, gets `timeout` ms. A fetch that fails with a copy kept uses the copy
 * (`image_remote_stale`), and without one fails the build (`image_remote_failed`).
 *
 * @packageDocumentation
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { flights, random, scope, slot, STALE } from '@ogygia/machine';
import { REMOTE_NAME_RE } from '../handoff.ts';
import { OgygiaError, warn } from '../messages.ts';
import { entry_for, RemoteHosts } from '../remote-hosts.ts';
import type { ImageRemote } from './options.ts';

/** The import every remote image is loaded by: this, then its URL as base64url. */
export const REMOTE_PREFIX = 'virtual:ogygia-image/remote/';
/** The default `remote.maxBytes`: 20 MB. */
export const MAX_BYTES = 20_000_000;
/** The default `remote.timeout`: 10 s. */
export const TIMEOUT_MS = 10_000;
const MAX_HOPS = 3;
const KEPT_MAX = 10_000;
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const EXT_OF_TYPE: ReadonlyMap<string, string> = new Map([
	['image/jpeg', 'jpg'],
	['image/png', 'png'],
	['image/webp', 'webp'],
	['image/avif', 'avif'],
	['image/gif', 'gif'],
	['image/tiff', 'tif']
]);
const WEB_URL_RE = /^https?:\/\//i;

/** The import that loads the image at `url`. */
export function remote_src(url: string): string {
	return `${REMOTE_PREFIX}${Buffer.from(url).toString('base64url')}`;
}

/** The URL a {@link remote_src} names, or null when `src` is none. */
export function url_of_remote_src(src: string): string | null {
	if (!src.startsWith(REMOTE_PREFIX)) return null;
	return Buffer.from(src.slice(REMOTE_PREFIX.length), 'base64url').toString('utf8');
}

/** The name of `url`'s file in the build cache, before its extension. */
export function remote_name(url: string): string {
	return crypto.createHash('sha256').update(url).digest('hex').slice(0, 32);
}

/** `src` as a URL the build may fetch, or `image_remote_host` (`where` names the line). */
export function remote_url(where: string, src: string, hosts: RemoteHosts | null): URL {
	let url: URL | null = null;
	if (WEB_URL_RE.test(src))
		try {
			url = new URL(src);
			// oxlint-disable-next-line ogygia/no-silent-failures -- a URL that does not parse is refused just below, with what a remote image must be
		} catch {}
	if (url === null) throw new OgygiaError('image_remote_host', { where, url: src, entry: '' });
	if (hosts === null || !hosts.allows(url))
		throw new OgygiaError('image_remote_host', { where, url: url.href, entry: entry_for(url) });
	return url;
}

/** Does `src` name a remote image `hosts` lists (a markdown image, a frontmatter value)? */
export function is_listed(src: string, hosts: RemoteHosts | null): boolean {
	if (hosts === null || !WEB_URL_RE.test(src)) return false;
	try {
		return hosts.allows(new URL(src));
		// oxlint-disable-next-line ogygia/no-silent-failures -- a value that is no URL is not a remote image: it stays as written
	} catch {
		return false;
	}
}

class Failed extends Error {}

interface Kept {
	url: string;
	ext: string;
	etag?: string;
	modified?: string;
}

interface Fresh {
	bytes: Uint8Array;
	ext: string;
	etag?: string;
	modified?: string;
}

/** How much one fetch may take. */
export interface Limits {
	maxBytes: number;
	timeout: number;
}

/** One fetch: the URL, the folder it is kept in, who asked (for a message), the app's hosts and
 *  limits. */
export interface Ask {
	url: string;
	dir: string;
	where: string;
	hosts: RemoteHosts;
	limits: Limits;
}

function discard(res: Response): void {
	// oxlint-disable-next-line ogygia/no-silent-failures -- a body nobody reads is let go; a failure to let it go changes nothing
	void res.body?.cancel().catch(() => {});
}

function too_large(max: number): Failed {
	return new Failed(`too large: more than remote.maxBytes, ${max} bytes`);
}

async function body_of(res: Response, max: number): Promise<Uint8Array> {
	const length = Number(res.headers.get('content-length'));
	if (length > max) {
		discard(res);
		throw too_large(max);
	}
	const parts: Uint8Array[] = [];
	let size = 0;
	const reader = res.body?.getReader();
	if (reader === undefined) return new Uint8Array();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			// oxlint-disable-next-line ogygia/no-silent-failures -- the body is dropped because it is too large, which the caller is told
			await reader.cancel().catch(() => {});
			throw too_large(max);
		}
		parts.push(value);
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.byteLength;
	}
	return out;
}

async function asked(url: URL, headers: Record<string, string>, signal: AbortSignal) {
	try {
		return await fetch(url, { redirect: 'manual', headers, signal });
	} catch (e) {
		if (signal.aborted) throw e;
		const cause = (e as { cause?: { code?: string; message?: string } }).cause;
		throw new Failed(`no answer: ${cause?.code ?? cause?.message ?? (e as Error).message}`);
	}
}

async function fetch_chain(
	ask: Ask,
	kept: Kept | null,
	signal: AbortSignal
): Promise<Fresh | null> {
	const headers: Record<string, string> = { accept: 'image/*' };
	if (kept?.etag) headers['if-none-match'] = kept.etag;
	if (kept?.modified) headers['if-modified-since'] = kept.modified;
	let at = new URL(ask.url);
	for (let hop = 0; ; hop++) {
		const res = await asked(at, headers, signal);
		if (REDIRECTS.has(res.status)) {
			discard(res);
			const location = res.headers.get('location');
			if (location === null) throw new Failed(`status ${res.status} with no location`);
			if (hop === MAX_HOPS) throw new Failed(`more than ${MAX_HOPS} redirects`);
			const next = new URL(location, at);
			if (!ask.hosts.allows(next))
				throw new OgygiaError('image_remote_host', {
					where: ask.where,
					url: next.href,
					entry: entry_for(next),
					via: at.href
				});
			at = next;
			continue;
		}
		if (res.status === 304 && kept !== null) {
			discard(res);
			return null;
		}
		if (res.status !== 200) {
			discard(res);
			throw new Failed(`status ${res.status}`);
		}
		const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
		const ext = EXT_OF_TYPE.get(type);
		if (ext === undefined) {
			discard(res);
			throw new Failed(`not an image: content-type ${type || '(none)'}`);
		}
		const bytes = await body_of(res, ask.limits.maxBytes);
		const etag = res.headers.get('etag');
		const modified = res.headers.get('last-modified');
		return {
			bytes,
			ext,
			...(etag !== null ? { etag } : {}),
			...(modified !== null ? { modified } : {})
		};
	}
}

async function fetch_once(ask: Ask, kept: Kept | null): Promise<Fresh | null> {
	const owner = scope();
	owner.timeout(() => owner.close(), ask.limits.timeout);
	try {
		const got = await owner.task((signal) => fetch_chain(ask, kept, signal));
		if (got === STALE)
			throw new Failed(`no answer within remote.timeout, ${ask.limits.timeout} ms`);
		return got;
	} finally {
		owner.close();
	}
}

function read_kept(dir: string, name: string): Kept | null {
	let kept: Kept;
	try {
		kept = JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8')) as Kept;
		// oxlint-disable-next-line ogygia/no-silent-failures -- no copy kept, or a torn one: the image is fetched whole
	} catch {
		return null;
	}
	if (typeof kept.ext !== 'string' || !/^[a-z]+$/.test(kept.ext)) return null;
	return fs.existsSync(path.join(dir, `${name}.${kept.ext}`)) ? kept : null;
}

function write_atomic(file: string, data: string | Uint8Array): void {
	const tmp = `${file}.${process.pid}.${random.uuid()}.tmp`;
	fs.writeFileSync(tmp, data);
	fs.renameSync(tmp, file);
}

/** Fetch (or ask again for) the image `ask` names into its folder: its file. One try, not shared:
 *  {@link RemoteImages} shares one per process. */
export async function fetched_file(ask: Ask): Promise<string> {
	const name = remote_name(ask.url);
	const kept = read_kept(ask.dir, name);
	let got: Fresh | null;
	try {
		got = await fetch_once(ask, kept);
	} catch (e) {
		if (!(e instanceof Failed)) throw e;
		if (kept === null)
			throw new OgygiaError('image_remote_failed', {
				where: ask.where,
				url: ask.url,
				reason: e.message
			});
		warn('image_remote_stale', { where: ask.where, url: ask.url, reason: e.message });
		return path.join(ask.dir, `${name}.${kept.ext}`);
	}
	if (got === null) return path.join(ask.dir, `${name}.${kept!.ext}`);
	fs.mkdirSync(ask.dir, { recursive: true });
	const file = path.join(ask.dir, `${name}.${got.ext}`);
	write_atomic(file, got.bytes);
	const meta: Kept = {
		url: ask.url,
		ext: got.ext,
		...(got.etag !== undefined ? { etag: got.etag } : {}),
		...(got.modified !== undefined ? { modified: got.modified } : {})
	};
	write_atomic(path.join(ask.dir, `${name}.json`), JSON.stringify(meta));
	if (kept !== null && kept.ext !== got.ext)
		fs.rmSync(path.join(ask.dir, `${name}.${kept.ext}`), { force: true });
	return file;
}

function make_fetches() {
	return flights.keyed<Ask>()<'url' | 'dir', 'where' | 'hosts' | 'limits', Promise<string>>({
		name: 'remote images',
		key: ['url', 'dir'],
		ignore: {
			where: 'which line names the image, for a message only',
			hosts: "one app's hosts: a process builds one app",
			limits: "one app's limits: a process builds one app"
		},
		max: KEPT_MAX,
		run: fetched_file
	});
}

const fetches = slot({
	name: 'ogygia.image.remote',
	version: 1,
	make: () => ({ files: make_fetches() })
});

/** The app's remote images: where they are kept, which hosts and limits they are fetched by. */
export class RemoteImages {
	readonly hosts: RemoteHosts;
	readonly #limits: Limits;
	readonly #names = new Set<string>();

	constructor(remote: ImageRemote) {
		this.hosts = new RemoteHosts(remote.hosts);
		this.#limits = {
			maxBytes: remote.maxBytes ?? MAX_BYTES,
			timeout: remote.timeout ?? TIMEOUT_MS
		};
	}

	/** The file in `dir` that holds the image at `url` (`where` names who asked, for a message):
	 *  fetched, or asked again, once per process. */
	async file(dir: string, url: string, where: string): Promise<string> {
		remote_url(where, url, this.hosts);
		const file = await fetches.files.get({
			url,
			dir,
			where,
			hosts: this.hosts,
			limits: this.#limits
		});
		if (file === STALE)
			throw new OgygiaError('image_remote_failed', { where, url, reason: 'dropped' });
		this.#names.add(remote_name(url));
		return file;
	}

	/** The names of every remote image this build fetched (each {@link REMOTE_NAME_RE}). */
	names(): string[] {
		return [...this.#names].sort();
	}
}

/** Is `file` a remote image's file in `dir`? */
export function is_remote_file(dir: string, file: string): boolean {
	if (dir === '' || path.dirname(file) !== path.normalize(dir)) return false;
	const base = path.basename(file);
	const dot = base.indexOf('.');
	return dot !== -1 && REMOTE_NAME_RE.test(base.slice(0, dot));
}
