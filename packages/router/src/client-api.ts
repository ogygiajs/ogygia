import { fill } from './match.ts';
import type { HrefParams, Params } from './view.ts';

export class ApiError extends Error {
	readonly status: number;
	readonly body: unknown;

	constructor(status: number, body: unknown, message?: string) {
		super(message ?? `endpoint answered ${status}`);
		this.status = status;
		this.body = body;
	}
}

type KeysWith<App, M extends string> = {
	[K in keyof App & string]: App[K] extends Record<M, { out: unknown }> ? K : never;
}[keyof App & string];
type OutOf<App, K extends keyof App, M extends string> =
	App[K] extends Record<M, { out: infer O }> ? O : unknown;
type InOf<App, K extends keyof App, M extends string> =
	App[K] extends Record<M, { in: infer I }> ? I : undefined;

type ParamsOpt<K extends string> =
	{} extends Params<K> ? { params?: HrefParams<K> } : { params: HrefParams<K> };
type BodyOpt<In> = undefined extends In ? { body?: In } : { body: In };
type CallOpts<K extends string, In = undefined> = ParamsOpt<K> &
	BodyOpt<In> & {
		search?: Record<string, string | number>;
		headers?: Record<string, string>;
	};
type CallArgs<K extends string, In = undefined> = {} extends Params<K> &
	(undefined extends In ? {} : { body: In })
	? [opts?: CallOpts<K, In>]
	: [opts: CallOpts<K, In>];

export interface ApiClientOptions {
	/** Extra headers on every call (auth tokens, signed hops — compose with `sign_headers`). */
	headers?: Record<string, string>;
	/** Custom fetch (a Kit event's cookie-forwarding fetch, a test stub). Default: global. */
	fetch?: typeof fetch;
}

export interface ApiClient<App> {
	get<K extends KeysWith<App, 'get'>>(path: K, ...args: CallArgs<K>): Promise<OutOf<App, K, 'get'>>;
	delete<K extends KeysWith<App, 'delete'>>(
		path: K,
		...args: CallArgs<K>
	): Promise<OutOf<App, K, 'delete'>>;
	post<K extends KeysWith<App, 'post'>>(
		path: K,
		...args: CallArgs<K, InOf<App, K, 'post'>>
	): Promise<OutOf<App, K, 'post'>>;
	put<K extends KeysWith<App, 'put'>>(
		path: K,
		...args: CallArgs<K, InOf<App, K, 'put'>>
	): Promise<OutOf<App, K, 'put'>>;
	patch<K extends KeysWith<App, 'patch'>>(
		path: K,
		...args: CallArgs<K, InOf<App, K, 'patch'>>
	): Promise<OutOf<App, K, 'patch'>>;
}

/**
 * A typed fetch client for a router's endpoints, from the app's `$infer` map. Paths are the keys
 * that have the verb; `params` is required when the pattern has any; the body is the schema's
 * input; the result is the handler's plain return (a raw `Response` return types as `unknown`).
 * A non-2xx answer throws {@link ApiError}. It loads only the path grammar, so islands can use it.
 *
 *     const cms = api<App>('https://cms.example.com');
 *     const post = await cms.get('/posts/[id]', { params: { id: '1' } });
 */
export function api<App>(base: string, opts: ApiClientOptions = {}): ApiClient<App> {
	const f = opts.fetch ?? fetch;
	const root = base.replace(TRAILING_SLASH_RE, '');
	const call = async (method: string, path: string, o: Record<string, unknown> = {}) => {
		let search = '';
		if (o.search) {
			const qs = new URLSearchParams();
			for (const [k, v] of Object.entries(o.search as Record<string, string | number>))
				qs.set(k, String(v));
			search = `?${qs}`;
		}
		const url = `${root}${fill(path, (o.params as Record<string, string | number>) ?? {})}${search}`;
		const has_body = o.body !== undefined;
		const res = await f(url, {
			method,
			headers: {
				accept: 'application/json',
				...(has_body ? { 'content-type': 'application/json' } : {}),
				...opts.headers,
				...(o.headers as Record<string, string>)
			},
			...(has_body ? { body: JSON.stringify(o.body) } : {})
		});
		if (res.status === 204) return undefined;
		const is_json = (res.headers.get('content-type') ?? '').includes('json');
		if (!res.ok) {
			// oxlint-disable-next-line ogygia/no-silent-failures -- the ApiError still carries the status
			const body = is_json ? await res.json().catch(() => undefined) : await res.text();
			throw new ApiError(res.status, body);
		}
		return is_json ? await res.json() : await res.text();
	};
	return {
		get: (p, ...a) => call('GET', p, a[0] as never),
		delete: (p, ...a) => call('DELETE', p, a[0] as never),
		post: (p, ...a) => call('POST', p, a[0] as never),
		put: (p, ...a) => call('PUT', p, a[0] as never),
		patch: (p, ...a) => call('PATCH', p, a[0] as never)
	} as ApiClient<App>;
}

const TRAILING_SLASH_RE = /\/+$/;
