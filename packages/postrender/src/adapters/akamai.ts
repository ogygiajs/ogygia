import { createHmac, createHash } from 'node:crypto';
import { clock, net, random } from '@ogygia/machine';
import type { PostrenderMeta, EdgeAdapter } from '../types.ts';
import {
	AKAMAI_MAX_TAGS,
	akamai_external_tag,
	akamai_prefix_tag,
	akamai_url_tag,
	build_edge_tags,
	normalize_prefix
} from '../key.ts';
import { OgygiaError } from '../messages.ts';

const TRAILING_SLASHES_RE = /\/+$/;

export interface AkamaiPurgeAudit {
	timestamp: string;
	network: 'production' | 'staging';
	method: 'delete' | 'invalidate';
	selector: 'url' | 'tag';
	objects: string[];
	httpStatus: number;
	purgeId?: string;
	supportId?: string;
}

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
	/** Purge method: `'delete'` (default, deterministic) or `'invalidate'`. */
	method?: 'delete' | 'invalidate';
	/** Enable Akamai edge caching for variant-keyed pages (requires Property Manager Cache ID
	 *  Modification on `header` + Remove Vary Header). */
	variants?: { header: string };
	/** Audit callback invoked after each Fast Purge call. */
	onPurge?: (entry: AkamaiPurgeAudit) => void;
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
 * stamps Akamai-legal `edge-cache-tag` tokens (no colons, <= 128 chars, <= 128 tags) combining
 * app-emitted tags, depth-capped prefix tags (`og_p/fr`, `og_p/fr/fr`, …), and URL/variant tags.
 * Defaults to Fast Purge `DELETE` per Akamai flushing rules.
 */
export class AkamaiEdge implements EdgeAdapter {
	readonly name: string = 'akamai';
	#config: AkamaiConfig;
	#network: 'production' | 'staging';
	#method: 'delete' | 'invalidate';
	#api_base: string;

	constructor(config: AkamaiConfig) {
		this.#config = config;
		this.#network = config.network ?? 'production';
		this.#method = config.method ?? 'delete';
		this.#api_base = (config.baseUrl ?? `https://${config.host}`).replace(TRAILING_SLASHES_RE, '');
	}

	headers(meta: PostrenderMeta): Record<string, string> {
		const has_variants = (meta.variants?.length ?? 0) > 0;
		if (has_variants && !this.#config.variants) {
			return { 'cache-control': 'private, no-store' };
		}
		const out: Record<string, string> = {
			'edge-cache-tag': build_edge_tags(meta, AKAMAI_MAX_TAGS).join(', ')
		};
		const max_age = this.#config.maxAge ?? meta.ttl;
		if (max_age > 0) out['cache-control'] = `public, s-maxage=${max_age}`;
		return out;
	}

	async purgeUrl(url: string): Promise<void> {
		if (this.#config.variants) {
			await this.purgeTags([akamai_url_tag(url)]);
			return;
		}
		await this.#signed_post('url', `/ccu/v3/${this.#method}/url/${this.#network}`, [
			this.#config.site.replace(TRAILING_SLASHES_RE, '') + url
		]);
	}

	async purgeWhere({ prefix }: { prefix: string }): Promise<void> {
		await this.#signed_post('tag', `/ccu/v3/${this.#method}/tag/${this.#network}`, [
			akamai_prefix_tag(normalize_prefix(prefix))
		]);
	}

	async purgeTags(tags: readonly string[]): Promise<void> {
		const clean = [...new Set(tags.map(akamai_external_tag).filter(Boolean))];
		for (let i = 0; i < clean.length; i += AKAMAI_MAX_TAGS) {
			await this.#signed_post(
				'tag',
				`/ccu/v3/${this.#method}/tag/${this.#network}`,
				clean.slice(i, i + AKAMAI_MAX_TAGS)
			);
		}
	}

	/** Real EdgeGrid signing (EG1-HMAC-SHA256) over the canonical request. */
	async #signed_post(selector: 'url' | 'tag', path: string, objects: string[]): Promise<void> {
		const config = this.#config;
		const payload = JSON.stringify({ objects });
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
		// oxlint-disable-next-line ogygia/no-silent-failures -- failure is thrown when !res.ok; body is optional detail
		const text = await res.text().catch(() => '');
		if (!res.ok) {
			throw new OgygiaError('postrender_adapter_request_failed', {
				what: 'akamai purge',
				status: res.status,
				body: text
			});
		}
		if (config.onPurge) {
			let parsed: { httpStatus?: number; purgeId?: string; supportId?: string } = {};
			try {
				parsed = JSON.parse(text || '{}') as typeof parsed;
				// oxlint-disable-next-line ogygia/no-silent-failures -- audit parses optional fields from Akamai's response
			} catch {}
			config.onPurge({
				timestamp,
				network: this.#network,
				method: this.#method,
				selector,
				objects,
				httpStatus: parsed.httpStatus ?? res.status,
				...(parsed.purgeId ? { purgeId: parsed.purgeId } : {}),
				...(parsed.supportId ? { supportId: parsed.supportId } : {})
			});
		}
	}
}
