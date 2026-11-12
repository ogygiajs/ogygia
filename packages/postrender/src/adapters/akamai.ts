import { createHmac, createHash } from 'node:crypto';
import { clock, net, random } from '@ogygia/machine';
import type { PostrenderMeta, EdgeAdapter } from '../types.ts';
import { prefix_tags, normalize_prefix } from '../key.ts';
import { OgygiaError } from '../messages.ts';

const TRAILING_SLASHES_RE = /\/+$/;

export interface AkamaiConfig {
	/** The EdgeGrid host, e.g. `akab-xxxx.purge.akamaiapis.net`. */
	host: string;
	clientToken: string;
	clientSecret: string;
	accessToken: string;
	/** The public site origin purged URLs are absolute against, e.g. `https://www.example.com`. */
	site: string;
	/** Fast Purge network (default `production`). */
	network?: 'production' | 'staging';
	/** Harness override: send API calls here instead of `https://<host>` (the edge emulator). */
	baseUrl?: string;
	/** The s-maxage this edge is granted (defaults to the policy TTL in `headers(meta)`). */
	maxAge?: number;
}

function edgegrid_timestamp(): string {
	const d = new Date(clock.wall());
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+0000`;
}

const b64_hmac = (key: string | Buffer, data: string) =>
	createHmac('sha256', key).update(data).digest('base64');
const b64_sha = (data: string) => createHash('sha256').update(data).digest('base64');

/**
 * An Akamai edge: Fast Purge v3 by URL and by tag, with EdgeGrid request signing. `headers(meta)`
 * stamps depth-capped prefix tags (`edge-cache-tag: p:/fr, p:/fr/fr, …`), and
 * `purgeWhere({ prefix })` purges the matching tag, as Fast Purge has no prefix purge of its own.
 * `baseUrl` points the same adapter at an emulator, so a test runs the real signing code.
 */
export class AkamaiEdge implements EdgeAdapter {
	readonly name: string = 'akamai';
	#config: AkamaiConfig;
	#network: string;
	#api_base: string;

	constructor(config: AkamaiConfig) {
		this.#config = config;
		this.#network = config.network ?? 'production';
		this.#api_base = (config.baseUrl ?? `https://${config.host}`).replace(TRAILING_SLASHES_RE, '');
	}

	headers(meta: PostrenderMeta): Record<string, string> {
		const tags = prefix_tags(meta.url).map((p) => `p:${p}`);
		const out: Record<string, string> = {};
		if (tags.length) out['edge-cache-tag'] = tags.join(', ');
		const max_age = this.#config.maxAge ?? meta.ttl;
		if (max_age > 0) out['cache-control'] = `public, s-maxage=${max_age}`;
		return out;
	}

	async purgeUrl(url: string): Promise<void> {
		await this.#signed_post(`/ccu/v3/invalidate/url/${this.#network}`, {
			objects: [this.#config.site.replace(TRAILING_SLASHES_RE, '') + url]
		});
	}

	async purgeWhere({ prefix }: { prefix: string }): Promise<void> {
		await this.#signed_post(`/ccu/v3/invalidate/tag/${this.#network}`, {
			objects: [`p:${normalize_prefix(prefix)}`]
		});
	}

	/** Real EdgeGrid signing (EG1-HMAC-SHA256) over the canonical request. */
	async #signed_post(path: string, body: unknown): Promise<void> {
		const config = this.#config;
		const payload = JSON.stringify(body);
		const timestamp = edgegrid_timestamp();
		const nonce = random.uuid();
		const auth_prefix = `EG1-HMAC-SHA256 client_token=${config.clientToken};access_token=${config.accessToken};timestamp=${timestamp};nonce=${nonce};`;
		const url = new URL(this.#api_base + path);
		// @why EdgeGrid signs METHOD, scheme, host, path and query, the signed headers, the body hash and the auth fields, tab-joined (test: test/postrender.test.ts › akamai: EdgeGrid-signed Fast Purge by url + prefix tag; headers stamp prefix tags)
		const data_to_sign = [
			'POST',
			url.protocol.replace(':', ''),
			config.host,
			url.pathname + url.search,
			'',
			b64_sha(payload),
			auth_prefix
		].join('\t');
		const signing_key = b64_hmac(config.clientSecret, timestamp);
		const signature = b64_hmac(signing_key, data_to_sign);
		const res = await net.fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `${auth_prefix}signature=${signature}`
			},
			body: payload
		});
		if (!res.ok) {
			throw new OgygiaError('postrender_adapter_request_failed', {
				what: 'akamai purge',
				status: res.status,
				body: await res.text().catch(() => '')
			});
		}
	}
}
