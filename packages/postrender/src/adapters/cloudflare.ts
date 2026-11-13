import { net } from '@ogygia/machine';
import type { PostrenderMeta, EdgeAdapter } from '../types.ts';
import { prefix_tags, normalize_prefix } from '../key.ts';
import { OgygiaError } from '../messages.ts';

const TRAILING_SLASHES_RE = /\/+$/;
const HTTP_SCHEME_RE = /^https?:\/\//;

export interface CloudflareConfig {
	zoneId: string;
	/** An API token with `Zone.Cache Purge` permission (`authorization: Bearer <token>`). */
	apiToken: string;
	/** The public site origin purged URLs are absolute against, e.g. `https://www.example.com`. */
	site: string;
	/** Harness override: send API calls here instead of `https://api.cloudflare.com`. */
	baseUrl?: string;
	/** The s-maxage this edge is granted (defaults to the policy TTL in `headers(meta)`). */
	maxAge?: number;
}

/**
 * A Cloudflare edge: zone purge with a bearer API token. `purgeUrl` purges by files (every plan);
 * `purgeWhere({ prefix })` purges by prefixes (`<host><prefix>`, Enterprise). `headers(meta)`
 * stamps the depth-capped prefix tags under `cache-tag` (plans that do not read it ignore it)
 * plus the verdict's `s-maxage`. `baseUrl` points the same adapter at an emulator.
 */
export class CloudflareEdge implements EdgeAdapter {
	readonly name: string = 'cloudflare';
	#config: CloudflareConfig;
	#api_base: string;
	#site: string;
	#site_host: string;

	constructor(config: CloudflareConfig) {
		this.#config = config;
		this.#api_base = (config.baseUrl ?? 'https://api.cloudflare.com').replace(
			TRAILING_SLASHES_RE,
			''
		);
		this.#site = config.site.replace(TRAILING_SLASHES_RE, '');
		this.#site_host = this.#site.replace(HTTP_SCHEME_RE, '');
	}

	headers(meta: PostrenderMeta): Record<string, string> {
		const tags = prefix_tags(meta.url).map((p) => `p:${p}`);
		const out: Record<string, string> = {};
		if (tags.length) out['cache-tag'] = tags.join(',');
		const max_age = this.#config.maxAge ?? meta.ttl;
		if (max_age > 0) out['cache-control'] = `public, s-maxage=${max_age}`;
		return out;
	}

	async purgeUrl(url: string): Promise<void> {
		await this.#purge({ files: [this.#site + url] });
	}

	async purgeWhere({ prefix }: { prefix: string }): Promise<void> {
		await this.#purge({ prefixes: [this.#site_host + normalize_prefix(prefix)] });
	}

	async #purge(body: Record<string, unknown>): Promise<void> {
		const config = this.#config;
		const res = await net.fetch(`${this.#api_base}/client/v4/zones/${config.zoneId}/purge_cache`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${config.apiToken}`,
				'content-type': 'application/json'
			},
			body: JSON.stringify(body)
		});
		if (!res.ok) {
			throw new OgygiaError('postrender_adapter_request_failed', {
				what: 'cloudflare purge',
				status: res.status,
				body: await res.text().catch(() => '') // ok: the failure is thrown just here; its body is only detail
			});
		}
	}
}
