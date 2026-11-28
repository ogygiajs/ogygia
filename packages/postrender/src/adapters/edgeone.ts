import { createHash, createHmac } from 'node:crypto';
import { clock, net } from '@ogygia/machine';
import type { EdgeAdapter, PostrenderMeta } from '../types.ts';
import {
	AKAMAI_MAX_TAGS,
	akamai_external_tag,
	akamai_url_tag,
	build_edge_tags,
	normalize_prefix
} from '../key.ts';
import { OgygiaError } from '../messages.ts';

const TRAILING_SLASHES_RE = /\/+$/;
const SERVICE = 'teo';
const ACTION = 'CreatePurgeTask';
const API_VERSION = '2022-09-01';
const DEFAULT_HOST = 'teo.tencentcloudapi.com';
const CONTENT_TYPE = 'application/json; charset=utf-8';
const SIGNED_HEADERS = 'content-type;host;x-tc-action';

export const EDGEONE_MAX_TARGETS = 1000;
export const EDGEONE_MAX_TAGS: number = AKAMAI_MAX_TAGS;

export interface EdgeOnePurgeAudit {
	timestamp: number;
	zoneId: string;
	type: 'purge_url' | 'purge_prefix' | 'purge_tag';
	method?: 'delete' | 'invalidate';
	targets: string[];
	jobId?: string;
	requestId?: string;
}

export interface EdgeOneConfig {
	/** Tencent Cloud EdgeOne zone ID, e.g. `zone-2xxxxxxxxx`. */
	zoneId: string;
	secretId: string;
	secretKey: string;
	/** The public site origin purged URLs are absolute against, e.g. `https://www.example.cn`. */
	site: string;
	/** Tencent Cloud API host (default `teo.tencentcloudapi.com`; international `teo.intl.tencentcloudapi.com`). */
	host?: string;
	/** Directory purge method: `'delete'` (default) or `'invalidate'`. */
	method?: 'delete' | 'invalidate';
	/** Enable EdgeOne edge caching for variant-keyed pages when Cache Key includes `header`. */
	variants?: { header: string };
	/** Audit callback invoked after each CreatePurgeTask call. */
	onPurge?: (entry: EdgeOnePurgeAudit) => void;
	/** Harness override: send API calls here instead of `https://<host>` (the edge emulator). */
	baseUrl?: string;
	/** The s-maxage this edge is granted (defaults to the policy TTL in `headers(meta)`). */
	maxAge?: number;
}

const hex_sha = (data: string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) =>
	createHmac('sha256', key).update(data).digest();

function tc3_timestamp(): { timestamp: number; date: string } {
	const timestamp = Math.floor(clock.wall() / 1000);
	const d = new Date(timestamp * 1000);
	const pad = (n: number) => String(n).padStart(2, '0');
	const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
	return { timestamp, date };
}

function edgeone_url_forms(site: string, url: string): string[] {
	// @why EdgeOne caches decoded and percent-encoded URLs separately, so special-character URLs must purge both forms (test: test/edgeone.test.ts › submits both decoded and encoded URLs when special characters are present)
	const forms = new Set<string>();
	let decoded = url;
	try {
		decoded = decodeURI(url);
		// oxlint-disable-next-line ogygia/no-silent-failures -- malformed percent sequence keeps the raw URL form
	} catch {}
	const encoded = encodeURI(decoded);
	forms.add(site + url);
	forms.add(site + decoded);
	forms.add(site + encoded);
	return [...forms];
}

interface EdgeOneEnvelope {
	Response?: {
		JobId?: string;
		RequestId?: string;
		Error?: { Code?: string; Message?: string };
		FailedList?: Array<{ Target?: string; Reason?: string }>;
	};
}

/**
 * A Tencent Cloud EdgeOne adapter: `CreatePurgeTask` (API v3 `TC3-HMAC-SHA256`) for China and
 * global EdgeOne zones. `purgeUrl` purges exact URLs (submitting both decoded and percent-encoded
 * forms when special characters are present); `purgeWhere({ prefix })` purges directory URLs
 * (`purge_prefix`, default `delete`); `purgeTags` purges cache tags (`purge_tag`).
 */
export class EdgeOneEdge implements EdgeAdapter {
	readonly name: string = 'edgeone';
	#config: EdgeOneConfig;
	#host: string;
	#method: 'delete' | 'invalidate';
	#site: string;
	#api_base: string;

	constructor(config: EdgeOneConfig) {
		this.#config = config;
		this.#host = config.host ?? DEFAULT_HOST;
		this.#method = config.method ?? 'delete';
		this.#site = config.site.replace(TRAILING_SLASHES_RE, '');
		this.#api_base = (config.baseUrl ?? `https://${this.#host}`).replace(TRAILING_SLASHES_RE, '');
	}

	headers(meta: PostrenderMeta): Record<string, string> {
		const has_variants = (meta.variants?.length ?? 0) > 0;
		if (has_variants && !this.#config.variants) {
			return { 'cache-control': 'private, no-store' };
		}
		const out: Record<string, string> = {
			'cache-tag': build_edge_tags(meta, EDGEONE_MAX_TAGS).join(',')
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
		const targets = edgeone_url_forms(this.#site, url);
		await this.#create_purge_task('purge_url', targets);
	}

	async purgeWhere({ prefix }: { prefix: string }): Promise<void> {
		const normalized = normalize_prefix(prefix);
		const dir = normalized === '/' ? '/' : `${normalized}/`;
		await this.#create_purge_task('purge_prefix', [this.#site + dir], this.#method);
	}

	async purgeTags(tags: readonly string[]): Promise<void> {
		const clean = [...new Set(tags.map(akamai_external_tag).filter(Boolean))];
		for (let i = 0; i < clean.length; i += EDGEONE_MAX_TARGETS) {
			await this.#create_purge_task('purge_tag', clean.slice(i, i + EDGEONE_MAX_TARGETS));
		}
	}

	async #create_purge_task(
		type: 'purge_url' | 'purge_prefix' | 'purge_tag',
		targets: string[],
		method?: 'delete' | 'invalidate'
	): Promise<void> {
		const config = this.#config;
		const payload = JSON.stringify({
			ZoneId: config.zoneId,
			Type: type,
			...(method ? { Method: method } : {}),
			Targets: targets
		});
		const { timestamp, date } = tc3_timestamp();
		const payload_hash = hex_sha(payload);
		// @why Tencent Cloud API v3 TC3-HMAC-SHA256 signs HTTPMethod, '/', '', lowercase canonical headers, signed headers, and SHA-256 payload hash (test: test/edgeone.test.ts › signs CreatePurgeTask with TC3-HMAC-SHA256)
		const canonical = [
			'POST',
			'/',
			'',
			`content-type:${CONTENT_TYPE}`,
			`host:${this.#host}`,
			`x-tc-action:${ACTION.toLowerCase()}`,
			'',
			SIGNED_HEADERS,
			payload_hash
		].join('\n');
		const credential_scope = `${date}/${SERVICE}/tc3_request`;
		const string_to_sign = [
			'TC3-HMAC-SHA256',
			String(timestamp),
			credential_scope,
			hex_sha(canonical)
		].join('\n');
		const k_date = hmac(`TC3${config.secretKey}`, date);
		const k_service = hmac(k_date, SERVICE);
		const k_signing = hmac(k_service, 'tc3_request');
		const signature = createHmac('sha256', k_signing).update(string_to_sign).digest('hex');
		const res = await net.fetch(`${this.#api_base}/`, {
			method: 'POST',
			headers: {
				'content-type': CONTENT_TYPE,
				host: this.#host,
				'x-tc-action': ACTION,
				'x-tc-version': API_VERSION,
				'x-tc-timestamp': String(timestamp),
				authorization: `TC3-HMAC-SHA256 Credential=${config.secretId}/${credential_scope}, SignedHeaders=${SIGNED_HEADERS}, Signature=${signature}`
			},
			body: payload
		});
		// oxlint-disable-next-line ogygia/no-silent-failures -- HTTP and envelope errors are checked and thrown immediately below
		const text = await res.text().catch(() => '');
		if (!res.ok) {
			throw new OgygiaError('postrender_adapter_request_failed', {
				what: 'edgeone purge',
				status: res.status,
				body: text
			});
		}
		let parsed: EdgeOneEnvelope = {};
		try {
			parsed = JSON.parse(text || '{}') as EdgeOneEnvelope;
			// oxlint-disable-next-line ogygia/no-silent-failures -- non-JSON responses carry no envelope fields
		} catch {}
		const resp = parsed.Response;
		if (resp?.Error || (resp?.FailedList?.length ?? 0) > 0) {
			throw new OgygiaError('postrender_adapter_request_failed', {
				what: 'edgeone purge',
				status: res.status,
				body: text
			});
		}
		if (config.onPurge) {
			config.onPurge({
				timestamp,
				zoneId: config.zoneId,
				type,
				...(method ? { method } : {}),
				targets,
				...(resp?.JobId ? { jobId: resp.JobId } : {}),
				...(resp?.RequestId ? { requestId: resp.RequestId } : {})
			});
		}
	}
}
