/**
 * THE REMOTE FETCH: one image from a listed host, the same way for the build (./vite/remote.ts) and
 * the image endpoint (./settle.ts), in any runtime. Redirects are followed by hand, at most 3, each
 * hop's host checked against `hosts`; the whole fetch, redirects and body included, gets `timeout`
 * ms; the body is counted as it arrives and dropped past `maxBytes`; it must say an image type
 * (JPEG, PNG, WebP, AVIF, GIF or TIFF, never SVG: only rasters are read) and start like one. How a
 * request is sent is the runtime's ({@link Transport}): Node's checks the address a host matched only
 * by a `*.` entry connects to (./remote-node.ts); a Worker's is `fetch` ({@link web_get}).
 *
 * @packageDocumentation
 */
import { net, scope, STALE } from '@ogygia/machine';
import type { HostMatch, RemoteHosts } from './remote-hosts.ts';

/** How one request is sent: `url`, with `init`'s headers and signal, its redirects not followed.
 *  `match` says how the hosts list took the URL's host. */
export type Transport = (
	url: URL,
	init: { headers: Record<string, string>; signal: AbortSignal },
	match: Exclude<HostMatch, null>
) => Promise<Response>;

/** A Worker's transport: `fetch`, which reaches no private address from Cloudflare's network. */
export const web_get: Transport = (url, init) =>
	net.fetch(url, { redirect: 'manual', headers: init.headers, signal: init.signal });

/** How much one fetch may take. */
export interface Limits {
	maxBytes: number;
	timeout: number;
}

/** What the image endpoint fetches remote images by (`virtual:ogygia-image/remote`): the app's
 *  `image({ remote })`, its defaults filled in. */
export interface RemoteConfig extends Limits {
	hosts: readonly string[];
	/** How long a file made from a remote image is kept, in seconds. */
	maxAge: number;
}

/** Why a fetch failed: the image endpoint answers each with its own status. */
export type FailKind =
	| 'status'
	| 'no answer'
	| 'timeout'
	| 'too large'
	| 'not an image'
	| 'private';

/** A fetch that failed, and why (`message`). */
export class RemoteFailed extends Error {
	readonly kind: FailKind;

	constructor(kind: FailKind, message: string) {
		super(message);
		this.kind = kind;
	}
}

/** A redirect to a host the list does not take. */
export class HopRefused extends Error {
	readonly url: URL;
	readonly via: URL;

	constructor(url: URL, via: URL) {
		super(`'${via.href}' redirects to '${url.href}', on a host remote.hosts does not list`);
		this.url = url;
		this.via = via;
	}
}

/** What a fetch got. */
export interface Fetched {
	bytes: Uint8Array;
	ext: string;
	etag?: string;
	modified?: string;
}

/** One fetch: its URL, the app's hosts and limits, how requests are sent, and the copy kept, whose
 *  validators make it a conditional request. */
export interface FetchAsk {
	url: URL;
	hosts: RemoteHosts;
	limits: Limits;
	get: Transport;
	kept?: { etag?: string; modified?: string } | null;
}

const MAX_HOPS = 3;
const REDIRECTS: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);
const EXT_OF_TYPE: ReadonlyMap<string, string> = new Map([
	['image/jpeg', 'jpg'],
	['image/png', 'png'],
	['image/webp', 'webp'],
	['image/avif', 'avif'],
	['image/gif', 'gif'],
	['image/tiff', 'tif']
]);

function discard(res: Response): void {
	// oxlint-disable-next-line ogygia/no-silent-failures -- a body nobody reads is let go; a failure to let it go changes nothing
	void res.body?.cancel().catch(() => {});
}

function too_large(max: number): RemoteFailed {
	return new RemoteFailed('too large', `too large: more than remote.maxBytes, ${max} bytes`);
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

function starts(bytes: Uint8Array, at: number, text: string): boolean {
	for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
	return true;
}

/** Do `bytes` start like a JPEG, PNG, GIF, WebP, AVIF (an ISO media file) or TIFF? */
export function looks_like_image(bytes: Uint8Array): boolean {
	return (
		(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
		starts(bytes, 0, '\x89PNG\r\n\x1a\n') ||
		starts(bytes, 0, 'GIF87a') ||
		starts(bytes, 0, 'GIF89a') ||
		(starts(bytes, 0, 'RIFF') && starts(bytes, 8, 'WEBP')) ||
		starts(bytes, 4, 'ftyp') ||
		starts(bytes, 0, 'II*\0') ||
		starts(bytes, 0, 'MM\0*')
	);
}

async function asked(
	ask: FetchAsk,
	url: URL,
	match: Exclude<HostMatch, null>,
	headers: Record<string, string>,
	signal: AbortSignal
): Promise<Response> {
	try {
		return await ask.get(url, { headers, signal }, match);
	} catch (e) {
		if (signal.aborted || e instanceof RemoteFailed) throw e;
		const cause = (e as { cause?: { code?: string; message?: string } }).cause;
		const code = (e as { code?: string }).code;
		throw new RemoteFailed(
			'no answer',
			`no answer: ${cause?.code ?? code ?? cause?.message ?? (e as Error).message}`
		);
	}
}

async function fetch_chain(ask: FetchAsk, signal: AbortSignal): Promise<Fetched | null> {
	const headers: Record<string, string> = { accept: 'image/*' };
	const kept = ask.kept ?? null;
	if (kept?.etag) headers['if-none-match'] = kept.etag;
	if (kept?.modified) headers['if-modified-since'] = kept.modified;
	let at = ask.url;
	let match = ask.hosts.match(at);
	if (match === null) throw new HopRefused(at, at);
	for (let hop = 0; ; hop++) {
		const res = await asked(ask, at, match, headers, signal);
		if (REDIRECTS.has(res.status)) {
			discard(res);
			const location = res.headers.get('location');
			if (location === null)
				throw new RemoteFailed('status', `status ${res.status} with no location`);
			if (hop === MAX_HOPS) throw new RemoteFailed('status', `more than ${MAX_HOPS} redirects`);
			const next = new URL(location, at);
			match = ask.hosts.match(next);
			if (match === null) throw new HopRefused(next, at);
			at = next;
			continue;
		}
		if (res.status === 304 && kept !== null) {
			discard(res);
			return null;
		}
		if (res.status !== 200) {
			discard(res);
			throw new RemoteFailed('status', `status ${res.status}`);
		}
		const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
		const ext = EXT_OF_TYPE.get(type);
		if (ext === undefined) {
			discard(res);
			throw new RemoteFailed('not an image', `not an image: content-type ${type || '(none)'}`);
		}
		const coding = (res.headers.get('content-encoding') ?? 'identity').trim().toLowerCase();
		if (coding !== 'identity') {
			discard(res);
			throw new RemoteFailed('not an image', `not an image: content-encoding ${coding}`);
		}
		const bytes = await body_of(res, ask.limits.maxBytes);
		if (!looks_like_image(bytes))
			throw new RemoteFailed(
				'not an image',
				`not an image: its bytes are no JPEG, PNG, WebP, AVIF, GIF or TIFF though it says ${type}`
			);
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

/** Fetch the image `ask` names: its bytes, or null when the host says the kept copy is current
 *  (a 304). Fails with {@link RemoteFailed} or {@link HopRefused}. */
export async function fetch_image(ask: FetchAsk): Promise<Fetched | null> {
	const owner = scope();
	owner.timeout(() => owner.close(), ask.limits.timeout);
	try {
		const got = await owner.task((signal) => fetch_chain(ask, signal));
		if (got === STALE)
			throw new RemoteFailed(
				'timeout',
				`no answer within remote.timeout, ${ask.limits.timeout} ms`
			);
		return got;
	} finally {
		owner.close();
	}
}
