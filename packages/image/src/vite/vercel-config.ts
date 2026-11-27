/**
 * The check that Vercel can make every link `vercel()` names: after adapter-vercel writes
 * `.vercel/output/config.json` (Kit runs the adapter in its server build's `closeBundle`; this
 * plugin's runs after it), its `images` must allow every width and quality the encoder names, every
 * format the plugin asks for, and the host of an absolute `paths.assets`; and open no more: listed
 * qualities, `localPatterns` that reach the app's originals only, and `remotePatterns` that reach
 * every host `image({ remote: { hosts } })` lists (a `remoteImage()`'s link names its URL) and no
 * other. Vercel answers a link outside
 * them with an error, and bills each file anyone asks for inside them, so either gap fails the build
 * (`image_vercel_config`), with the exact `images` value to pass.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin as VitePlugin, ResolvedConfig } from 'vite';
import type { OutputFormat } from '../config.ts';
import { OgygiaError } from '../messages.ts';
import { host_rule, RemoteHosts } from '../remote-hosts.ts';
import { vercel_images, type Encoder, type VercelImages } from './encoder.ts';

/** What the build names that Vercel must allow. */
export interface VercelWant {
	/** The images `vercel()` hands the adapter. */
	images: VercelImages;
	/** Every format the plugin and its presets ask for. */
	formats: readonly OutputFormat[];
	/** Kit's `paths.assets` (a full URL names a host Vercel must fetch from). */
	assets: string;
	/** The path the app's originals sit under (`<base>/<appDir>/immutable/assets/`). */
	originals: string;
	/** `image({ remote: { hosts } })`: the hosts a remote image's link may name. */
	hosts: readonly string[];
}

interface RemotePattern {
	protocol?: unknown;
	hostname?: unknown;
	port?: unknown;
}

function pattern_takes(p: RemotePattern, url: URL): boolean {
	if (typeof p.hostname !== 'string' || !new RegExp(p.hostname).test(url.hostname)) return false;
	if (p.protocol !== undefined && `${String(p.protocol)}:` !== url.protocol) return false;
	return p.port === undefined || String(p.port) === url.port;
}

const PROBE = 'ogygia-probe';

function remote_missing(have: RemotePattern[], hosts: readonly string[]): string[] {
	const out: string[] = [];
	const listed = new RemoteHosts(hosts);
	const probes = [`${PROBE}.invalid`];
	for (const entry of hosts) {
		const rule = host_rule(entry);
		if (rule === null) continue;
		const port = rule.port ? `:${rule.port}` : '';
		const sample = new URL(
			`${rule.protocol}//${rule.below ? `${PROBE}.` : ''}${rule.host}${port}/`
		);
		if (!have.some((p) => pattern_takes(p, sample))) out.push(`remotePatterns for ${entry}`);
		probes.push(rule.below ? `${PROBE}.${rule.host}` : rule.host);
		if (!rule.below && !rule.host.startsWith('[')) probes.push(`${PROBE}.${rule.host}`);
	}
	for (const p of have)
		for (const probe of probes)
			for (const protocol of ['https:', 'http:']) {
				const port = p.port === undefined ? '' : `:${String(p.port)}`;
				let url: URL;
				try {
					url = new URL(`${protocol}//${probe}${port}/`);
					// oxlint-disable-next-line ogygia/no-silent-failures -- a port no URL can have takes no probe
				} catch {
					continue;
				}
				if (pattern_takes(p, url) && !listed.allows(url))
					out.push(
						`remotePatterns no wider than remote.hosts (${JSON.stringify(p)} takes ${url.host})`
					);
			}
	return out;
}

interface LocalPattern {
	pathname?: unknown;
}

function matches(p: LocalPattern, path: string): boolean {
	return typeof p.pathname !== 'string' || new RegExp(p.pathname).test(path);
}

function local_missing(have: unknown, want: VercelWant): string | undefined {
	if (!Array.isArray(have))
		return 'localPatterns (unset: the optimizer reads any path of the deployment)';
	const base = want.originals.replace(/[^/]+\/immutable\/assets\/$/, '');
	for (const outside of [`${base}x.png`, `${want.originals.replace(/assets\/$/, '')}x.png`])
		if ((have as LocalPattern[]).some((p) => matches(p, outside)))
			return `localPatterns no wider than ${want.originals} (one matches ${outside})`;
	if (/^https?:\/\//.test(want.assets)) return undefined;
	const original = `${want.originals}hero.Ab12.png`;
	if (!(have as LocalPattern[]).some((p) => matches(p, original)))
		return `localPatterns for ${want.originals}`;
	return undefined;
}

/** What `have` (the output's `images`) lacks of `want`, one entry each, or none. */
export function vercel_config_missing(have: unknown, want: VercelWant): string[] {
	if (have === null || typeof have !== 'object') return ['images (no images config at all)'];
	const h = have as Partial<Record<'sizes' | 'qualities' | 'formats' | 'domains', unknown[]>> & {
		remotePatterns?: RemotePattern[];
		localPatterns?: unknown;
	};
	const out: string[] = [];
	const sizes = h.sizes ?? [];
	for (const s of want.images.sizes) if (!sizes.includes(s)) out.push(`sizes ${s}`);
	if (h.qualities === undefined)
		out.push('qualities (unset: anyone may ask for any quality from 1 to 100)');
	else
		for (const q of want.images.qualities) if (!h.qualities.includes(q)) out.push(`qualities ${q}`);
	const formats = h.formats ?? ['image/webp'];
	for (const f of want.formats)
		if ((f === 'avif' || f === 'webp') && !formats.includes(`image/${f}`))
			out.push(`formats image/${f}`);
	if (/^https?:\/\//.test(want.assets)) {
		const host = new URL(want.assets).hostname;
		const listed =
			(h.domains ?? []).includes(host) ||
			(h.remotePatterns ?? []).some(
				(p) => typeof p.hostname === 'string' && new RegExp(p.hostname).test(host)
			);
		if (!listed) out.push(`remote host ${host}`);
	}
	const local = local_missing(h.localPatterns, want);
	if (local !== undefined) out.push(local);
	out.push(...remote_missing(Array.isArray(h.remotePatterns) ? h.remotePatterns : [], want.hosts));
	return [...new Set(out)];
}

const OUTPUT_CONFIG = '.vercel/output/config.json';

/** The plugin that checks the adapter's output once Kit's adapter ran, in a server build that lists
 *  `vercel()`. */
export function vercel_config_check(
	encoders: readonly Encoder[],
	want: () => Omit<VercelWant, 'images'>
): VitePlugin {
	const encoder = encoders.find((e) => e.name === 'vercel') as
		| (Encoder & { images: VercelImages })
		| undefined;
	let config: ResolvedConfig | undefined;
	let started = 0;
	return {
		name: '@ogygia/image:vercel-config',
		apply: 'build',
		configResolved(c) {
			config = c;
		},
		buildStart() {
			started = Date.now();
		},
		closeBundle: {
			order: 'post',
			sequential: true,
			handler() {
				if (!encoder || !config?.build.ssr) return;
				const file = path.resolve(OUTPUT_CONFIG);
				const asked = want();
				const line = `adapter({ images: ${JSON.stringify(vercel_images(encoder, asked.originals, asked.hosts))} })`;
				const fail = (missing: string[], have: string): never => {
					throw new OgygiaError('image_vercel_config', { missing: missing.join(', '), have, line });
				};
				if (!fs.existsSync(file) || fs.statSync(file).mtimeMs < started)
					fail([`${OUTPUT_CONFIG} written by this build`], 'no output config');
				const images = (JSON.parse(fs.readFileSync(file, 'utf8')) as { images?: unknown }).images;
				const missing = vercel_config_missing(images, { images: encoder.images, ...asked });
				if (missing.length) fail(missing, JSON.stringify(images ?? null));
			}
		}
	};
}
