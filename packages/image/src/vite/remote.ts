/**
 * REMOTE IMAGES AT BUILD: `import.meta.og.image('https://images.example.com/hero.jpg')`, and a
 * markdown image or frontmatter URL on a listed host. The macro checks the URL against
 * `image({ remote: { hosts } })` and imports it as `virtual:ogygia-image/remote/<url>`; the plugin
 * resolves that to the image's file in the build cache, so from there it is a file source like any
 * other (its id the hash of its bytes, shipped as an asset, its placeholder, `warm`, the files of
 * prerendered pages). A `remoteImage()` a prerendered page names is fetched the same way by the
 * build's writer (./build-files.ts).
 *
 *   node_modules/.ogygia/image/remote/<hash of the URL>.<ext>    the bytes
 *   node_modules/.ogygia/image/remote/<hash of the URL>.json     its URL, etag, last-modified
 *
 * Each process asks each URL once: with no copy, a plain GET; with one, a conditional GET, whose
 * 304 keeps the copy. The fetch itself (redirects checked hop by hop, the size cap, the timeout, an
 * image's type and first bytes) is ../remote-fetch.ts, the image endpoint's too. A fetch that fails
 * with a copy kept uses the copy (`image_remote_stale`), and without one fails the build
 * (`image_remote_failed`).
 *
 * @packageDocumentation
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedent } from '@ogygia/core/contract';
import { flights, random, slot, STALE } from '@ogygia/machine';
import { REMOTE_NAME_RE } from '../handoff.ts';
import { OgygiaError, warn } from '../messages.ts';
import {
	fetch_image,
	HopRefused,
	RemoteFailed,
	type Fetched,
	type Limits,
	type RemoteConfig
} from '../remote-fetch.ts';
import { entry_for, RemoteHosts } from '../remote-hosts.ts';
import { node_get } from '../remote-node.ts';
import type { ImageRemote } from './options.ts';

export type { Limits } from '../remote-fetch.ts';

/** The import every remote image is loaded by: this, then its URL as base64url. */
export const REMOTE_PREFIX = 'virtual:ogygia-image/remote/';
/** The default `remote.maxBytes`: 20 MB. */
export const MAX_BYTES = 20_000_000;
/** The default `remote.timeout`: 10 s. */
export const TIMEOUT_MS = 10_000;
/** The default `remote.maxAge`: one day, in seconds. */
export const MAX_AGE_S = 86_400;
const KEPT_MAX = 10_000;
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

interface Kept {
	url: string;
	ext: string;
	etag?: string;
	modified?: string;
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
	let got: Fetched | null;
	try {
		got = await fetch_image({
			url: new URL(ask.url),
			hosts: ask.hosts,
			limits: ask.limits,
			get: node_get,
			kept
		});
	} catch (e) {
		if (e instanceof HopRefused)
			throw new OgygiaError('image_remote_host', {
				where: ask.where,
				url: e.url.href,
				entry: entry_for(e.url),
				via: e.via.href
			});
		if (!(e instanceof RemoteFailed)) throw e;
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

function file_of(url: string): string {
	return fileURLToPath(url).split(path.sep).join('/');
}

const REMOTE_OFF: string = file_of(import.meta.resolve('../remote-off.ts'));
const REMOTE_NODE: string = file_of(import.meta.resolve('../remote-node.ts'));
const REMOTE_FETCH: string = file_of(import.meta.resolve('../remote-fetch.ts'));

/** The source of `virtual:ogygia-image/remote`: the app's `remote` with its defaults, and the
 *  transport of the runtime the endpoint runs in (`node`: Node's, which checks the addresses of a
 *  host listed only by `*.`; else a Worker's `fetch`). With no `remote`, the endpoint fetches
 *  nothing. */
export function remote_module(remote: ImageRemote | undefined, node: boolean): string {
	if (remote === undefined) return `export * from ${JSON.stringify(REMOTE_OFF)};\n`;
	const config: RemoteConfig = {
		hosts: remote.hosts,
		maxBytes: remote.maxBytes ?? MAX_BYTES,
		timeout: remote.timeout ?? TIMEOUT_MS,
		maxAge: remote.maxAge ?? MAX_AGE_S
	};
	const [file, name] = node ? [REMOTE_NODE, 'node_get'] : [REMOTE_FETCH, 'web_get'];
	return dedent`
		export const remote = ${JSON.stringify(config)};
		export const transport = () => import(${JSON.stringify(file)}).then((m) => m.${name});
	`;
}

/** Is `file` a remote image's file in `dir`? */
export function is_remote_file(dir: string, file: string): boolean {
	if (dir === '' || path.dirname(file) !== path.normalize(dir)) return false;
	const base = path.basename(file);
	const dot = base.indexOf('.');
	return dot !== -1 && REMOTE_NAME_RE.test(base.slice(0, dot));
}
