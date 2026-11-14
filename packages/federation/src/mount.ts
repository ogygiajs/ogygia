import { clock } from '@ogygia/machine';
import { page, redirect, type PageDef, type ComponentPick, type Ctx } from '@ogygia/router';
import { fed_app } from './app.ts';
import { child_traceparent, moved_card, type Claims, type FragmentDocument } from './wire.ts';
import type { Peer } from './types.ts';
import { OgygiaError } from './messages.ts';
import { OG_MOUNT_FAILED, OG_MOUNT_FALLBACK, OG_MOUNT_MOVED } from '@ogygia/core/internal/server';

export interface MountOptions {
	/** OVERRIDE the visitor claims for this mount. Default: the federation's `visitor` as it
	 *  reaches `c.visitor`, plus the table's experiment buckets, auto-carried. */
	user?: (c: Ctx) => Claims | undefined;
	/** STREAM the mount: the shell's page flushes immediately with `fallback` in the slot, and the
	 *  fragment swaps in down the SAME response when the peer answers. GET only. */
	stream?: boolean | { fallback?: unknown };
}

function claims_for(c: Ctx, user_override?: (c: Ctx) => Claims | undefined): Claims | undefined {
	const base = user_override ? user_override(c) : (c.visitor as Claims | undefined);
	const buckets = fed_app()?.facts(c.request).assignments;
	if (!buckets || Object.keys(buckets).length === 0) return base;
	return {
		...base,
		experiments: { ...buckets, ...(base?.experiments as object | undefined) }
	};
}

const SKELETON = `<div ${OG_MOUNT_FALLBACK} style="min-height:6rem;border-radius:8px;background:linear-gradient(90deg,#f3f4f6,#e5e7eb,#f3f4f6)"></div>`;
const FAILED = `<div ${OG_MOUNT_FAILED} style="border:1px dashed #dc2626;border-radius:8px;padding:1rem;color:#dc2626">This section is temporarily unavailable.</div>`;

function mount_fn(
	target: Peer | ComponentPick | ((c: Ctx) => Peer),
	opts: MountOptions = {}
): PageDef<readonly [], unknown, unknown, unknown, unknown> {
	const fixed = typeof target === 'function' || '__ogpick' in target ? null : (target as Peer);
	const resolve_peer = (c: Ctx): Peer => {
		if (fixed) return fixed;
		const got =
			typeof target === 'function' ? target(c) : (target as ComponentPick).__ogpick(c as never);
		if (!got || typeof (got as Peer).doc !== 'function')
			throw new OgygiaError('federation_mount_no_peer', {
				via: typeof target === 'function' ? 'resolver' : 'pick'
			});
		return got as Peer;
	};

	if (opts.stream) {
		const fb =
			typeof opts.stream === 'object' && opts.stream.fallback != null
				? opts.stream.fallback
				: SKELETON;
		const stream_slot = async function* (c: Ctx) {
			if (typeof fb === 'string') yield fb;
			else {
				const { region } = await import('@ogygia/core/plugin');
				yield region(fb as never, {});
			}
			const peer = resolve_peer(c);
			const rest = (c.params as { rest?: string }).rest ?? '';
			try {
				const doc = await peer.doc(
					`/${rest}`,
					c.url.search,
					claims_for(c, opts.user),
					child_traceparent(c.request.headers.get('traceparent')).traceparent
				);
				if (doc.location) {
					yield String(moved_card(OG_MOUNT_MOVED, 'page', doc.location));
					return;
				}
				if (doc.status >= 400) {
					yield FAILED;
					return;
				}
				yield (doc.css?.join('') ?? '') + (doc.head ?? '') + doc.body;
			} catch {
				yield FAILED;
			}
		};
		return page(stream_slot as never, {
			actions: { default: mount_action(resolve_peer, opts) }
		});
	}

	const mounted_view = {
		__ogpick: (_c: Ctx, data: Record<string, unknown>) => {
			const doc = data.doc as FragmentDocument;
			return {
				__oghtml: true as const,
				html: doc.body,
				css: doc.css,
				title: doc.title || undefined,
				head: doc.head,
				status: doc.status
			};
		}
	};

	return page(mounted_view, {
		load: async (c) => {
			const peer = resolve_peer(c);
			const rest = (c.params as { rest?: string }).rest ?? '';
			const trace = child_traceparent(c.request.headers.get('traceparent'));
			const t0 = clock.mono();
			const doc = await peer.doc(
				`/${rest}`,
				c.url.search,
				claims_for(c, opts.user),
				trace.traceparent
			);
			const hop_ms = Math.round((clock.mono() - t0) * 10) / 10;
			if (doc.location) redirect(doc.status as 301 | 302 | 303 | 307 | 308, doc.location);
			c.setHeaders?.({
				'server-timing': `${peer.label};dur=${hop_ms}${doc.server_ms != null ? `, ${peer.label}-render;dur=${doc.server_ms}` : ''}`,
				...(doc.trace ? { 'x-og-trace': doc.trace.trace_id } : {})
			});
			return { doc };
		},
		actions: { default: mount_action(resolve_peer, opts) }
	});
}

function mount_action(resolve_peer: (c: Ctx) => Peer, opts: MountOptions) {
	return async (c: Ctx) => {
		const peer = resolve_peer(c);
		const rest = (c.params as { rest?: string }).rest ?? '';
		const body = await c.request.arrayBuffer();
		const doc = await peer.postDoc(
			`/${rest}`,
			c.url.search,
			body,
			c.request.headers.get('content-type') ?? 'application/x-www-form-urlencoded',
			claims_for(c, opts.user),
			child_traceparent(c.request.headers.get('traceparent')).traceparent
		);
		if (doc.location) redirect(303, doc.location);
		return { doc };
	};
}

type KitMountEvent = {
	params: Partial<Record<string, string>>;
	url: URL;
	request: Request;
	setHeaders?: (headers: Record<string, string>) => void;
};

export interface KitMountOptions {
	/** Visitor claims for each hop — a plain Kit app has no `c.visitor`, so identity is read off
	 *  the EVENT (cookies / locals) explicitly. */
	user?: (e: KitMountEvent) => Claims | undefined;
	/** The catchall param name (`src/routes/cms/[...rest]` → 'rest'). Default 'rest'. */
	param?: string;
}

/** Mount a peer from a plain SvelteKit catchall — `export const load = mount.kit(cms).load`. */
export function kit_mount(
	peer: Peer,
	opts: KitMountOptions = {}
): {
	load: (e: KitMountEvent) => Promise<{ doc: FragmentDocument }>;
	actions: { default: (e: KitMountEvent) => Promise<{ doc: FragmentDocument }> };
} {
	const param = opts.param ?? 'rest';
	const kit = () => import('@sveltejs/kit');
	return {
		load: async (e) => {
			const rest = e.params[param] ?? '';
			const trace = child_traceparent(e.request.headers.get('traceparent'));
			const t0 = clock.mono();
			const doc = await peer.doc(`/${rest}`, e.url.search, opts.user?.(e), trace.traceparent);
			const hop_ms = Math.round((clock.mono() - t0) * 10) / 10;
			const { error: kit_error, redirect: kit_redirect } = await kit();
			if (doc.location) kit_redirect(doc.status as 301, doc.location);
			e.setHeaders?.({
				'server-timing': `${peer.label};dur=${hop_ms}${doc.server_ms != null ? `, ${peer.label}-render;dur=${doc.server_ms}` : ''}`,
				...(doc.trace ? { 'x-og-trace': doc.trace.trace_id } : {})
			});
			if (doc.status >= 400) kit_error(doc.status, doc.title || 'This section is unavailable.');
			return { doc };
		},
		actions: {
			default: async (e) => {
				const rest = e.params[param] ?? '';
				const body = await e.request.arrayBuffer();
				const doc = await peer.postDoc(
					`/${rest}`,
					e.url.search,
					body,
					e.request.headers.get('content-type') ?? 'application/x-www-form-urlencoded',
					opts.user?.(e),
					child_traceparent(e.request.headers.get('traceparent')).traceparent
				);
				const { redirect: kit_redirect } = await kit();
				if (doc.location) kit_redirect(303, doc.location);
				return { doc };
			}
		}
	};
}

/**
 * Renders a whole remote app under the shell's chrome. In a route table:
 * `'/cms/[...rest]': mount(cms)`, where `cms` is a peer from `federate()`; the peer owns transport
 * (signing, timeout, cache, coalescing). From a plain SvelteKit catchall without ogygia's router:
 * `export const load = mount.kit(cms).load`. For a canary or blue-green switch, pass a per-request
 * choice instead of a peer: `mount(v2.pick({ off, on }))` or `mount((c) => peer)`.
 */
export const mount: typeof mount_fn & { kit: typeof kit_mount } = Object.assign(mount_fn, {
	kit: kit_mount
});
