/**
 * The CDN between the network and the servers: a shared cache, as a real one keeps it. A response
 * is stored when its `Cache-Control` lets a shared cache keep it (`public` or `s-maxage`, no
 * `private`, `no-store` or `Set-Cookie`), keyed by method, URL and the request headers its `Vary`
 * names, and served until its `s-maxage` (else `max-age`) runs out on the CDN's clock.
 *
 * It records who each stored answer was made for (the request's cookie), so the security oracle can
 * find the one thing a shared cache must never do: hand one visitor's personal bytes to another.
 */
import type { Loop } from './loop.ts';

interface Entry {
	readonly status: number;
	readonly headers: [string, string][];
	readonly body: Uint8Array;
	readonly vary: string[];
	readonly varied: string[];
	readonly until: number;
	/** The cookie of the request the stored answer was made for. */
	readonly made_for: string;
}

/** A stored answer served to a request with another cookie than the one it was made for. */
export interface Served {
	readonly url: string;
	readonly made_for: string;
	readonly served_to: string;
}

const PERSONAL = /\b(private|no-store)\b/i;

/** ms a shared cache may keep a response, or 0. */
export function shared_ttl(headers: Headers): number {
	const cc = headers.get('cache-control') ?? '';
	if (PERSONAL.test(cc) || headers.has('set-cookie')) return 0;
	const s = /\bs-maxage=(\d+)/i.exec(cc);
	if (s) return Number(s[1]) * 1000;
	if (!/\bpublic\b/i.test(cc)) return 0;
	const m = /\bmax-age=(\d+)/i.exec(cc);
	return m ? Number(m[1]) * 1000 : 0;
}

export class Cdn {
	readonly #loop: Loop;
	readonly #store = new Map<string, Entry[]>();
	/** Every hit served across cookies (the security oracle reads it). */
	readonly crossed: Served[] = [];
	hits = 0;
	misses = 0;

	constructor(loop: Loop) {
		this.#loop = loop;
	}

	/** Answers from the store, or from `origin` (storing what may be stored). */
	async fetch(request: Request, origin: (r: Request) => Promise<Response>): Promise<Response> {
		const key = `${request.method} ${request.url}`;
		const cookie = request.headers.get('cookie') ?? '';
		if (request.method === 'GET') {
			for (const e of this.#store.get(key) ?? []) {
				if (e.until <= this.#loop.now) continue;
				if (!e.vary.every((h, i) => (request.headers.get(h) ?? '') === e.varied[i])) continue;
				this.hits++;
				if (e.made_for !== cookie)
					this.crossed.push({ url: request.url, made_for: e.made_for, served_to: cookie });
				const headers = new Headers(e.headers);
				headers.set('x-sim-cache', 'hit');
				return new Response(e.body.length === 0 ? null : e.body.slice(), {
					status: e.status,
					headers
				});
			}
		}
		this.misses++;
		const response = await origin(request);
		const ttl =
			request.method === 'GET' && response.status === 200 ? shared_ttl(response.headers) : 0;
		const vary = (response.headers.get('vary') ?? '')
			.split(',')
			.map((h) => h.trim().toLowerCase())
			.filter(Boolean);
		if (ttl === 0 || vary.includes('*')) return response;
		const body = new Uint8Array(await response.arrayBuffer());
		const entry: Entry = {
			status: response.status,
			headers: [...response.headers],
			body,
			vary,
			varied: vary.map((h) => request.headers.get(h) ?? ''),
			until: this.#loop.now + ttl,
			made_for: cookie
		};
		const list = (this.#store.get(key) ?? []).filter(
			(e) => !e.vary.every((h, i) => entry.varied[i] === e.varied[i] && h === entry.vary[i])
		);
		list.push(entry);
		this.#store.set(key, list);
		return new Response(body.length === 0 ? null : body, {
			status: response.status,
			statusText: response.statusText,
			headers: response.headers
		});
	}

	/** Empties the cache (a purge, as a deploy may do). */
	purge(): void {
		this.#store.clear();
	}
}
