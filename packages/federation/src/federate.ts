import { net, outbox, policy, timers, type Outbox } from '@ogygia/machine';
import type { ServerApp } from '@ogygia/core/plugin';
import { fed_app } from './app.ts';
import { warn } from './messages.ts';
import { PeerHandle } from './peer.ts';
import { set_federation, current_federation } from './registry.ts';
import {
	configured_audience,
	sign_headers,
	THAW_PATH,
	type Claims,
	type FragmentDocument,
	type WidgetDocument
} from './wire.ts';
import type { FederateConfig, Federation, Peer, PeerConfig, Widget, WidgetDef } from './types.ts';

const HOP_MAX = 4;

/** Collect the data-source receipts (`og.source`) an expose render files, so the fragment reports
 *  what it read: the request's `sources` fact is a fresh list for the render, then restored. */
export class SourceCapture {
	readonly sources: Set<string> = new Set();
	readonly #facts: ReturnType<ServerApp['facts']> | undefined;
	readonly #saved: ReturnType<ServerApp['facts']>['sources'] | null;

	constructor(request: Request) {
		const facts = fed_app()?.facts(request);
		this.#facts = facts;
		this.#saved = facts ? facts.sources : null;
		if (facts) facts.sources = [];
	}

	end(): void {
		const facts = this.#facts;
		if (!facts) return;
		const sources = this.sources;
		for (const tag of facts.sources ?? []) sources.add(tag);
		const saved = this.#saved;
		facts.sources = saved ? [...saved, ...sources] : saved;
	}
}

/**
 * `federate({ name, key, peers, visitor, expose?, widgets? })`: the app's one federation identity,
 * called once in or under hooks.server.ts. Returns the peer handles keyed by their config names:
 * `const { cms, dash } = federate({ … })`. Exposing a table or widgets while no peer has a key
 * (and without `open`) lets nobody call, so it warns (`federation_open_without_keys`).
 */
export function federate<P extends Record<string, PeerConfig>>(
	config: FederateConfig<P>
): { [K in keyof P]: Peer } {
	const has_inbound = Object.values(config.peers ?? {}).some((p) => p.key);
	if ((config.expose || config.widgets) && !has_inbound && !config.open) {
		warn('federation_open_without_keys');
	}
	// FAIL-CLOSED: peers may call in, but there is no audience to check their hops against, so
	// every signed call is refused (wire.ts `verify_signed_request`)
	if (has_inbound && config.audience == null && configured_audience() == null) {
		warn('federation_audience_missing', { name: config.name });
	}

	const peers = new Map<string, PeerHandle & { keys: readonly string[] }>();
	const out = {} as { [K in keyof P]: Peer };
	for (const [peer_name, peer_cfg] of Object.entries(config.peers ?? {}) as [
		keyof P & string,
		PeerConfig
	][]) {
		const handle = new PeerHandle(peer_name, peer_cfg, config.name, config.key);
		const keys = peer_cfg.key ? ([] as string[]).concat(peer_cfg.key) : [];
		peers.set(peer_name, Object.assign(handle, { keys }));
		out[peer_name] = handle;
	}

	const widgets = new Map<string, { make: Widget; props?: readonly string[] }>();
	for (const [w_name, def] of Object.entries(config.widgets ?? {})) {
		const d = def as WidgetDef;
		widgets.set(w_name, typeof d === 'function' ? { make: d } : { make: d.make, props: d.props });
	}

	const fed: Federation = {
		name: config.name,
		key: config.key,
		peers,
		// (a peer's handle above already parsed each one)
		code_origins: Object.values(config.peers ?? {})
			.flatMap((p) => p.origin)
			.map((o) => new URL(o).origin),
		visitor: config.visitor,
		expose: config.expose,
		base: config.base ?? '',
		widgets,
		audience: config.audience,
		skew_ms: config.skewMs ?? 120_000,
		open: config.open === true,
		max_body: config.maxBodyBytes ?? 1024 * 1024,
		deploy: config.deploy ?? 'auto'
	};
	set_federation(fed);
	return out;
}

type Thaw = {
	fed: Federation;
	peer: Peer;
	peer_name: string;
	id: string;
	body: ArrayBuffer;
};

const PEER_POLICY = policy({
	attempts: 4,
	backoff: [200, 1000, 5000],
	jitter: 0.2,
	deadline: 30_000
});
const PEER_TRY_MS = 5000;

async function post_thaw(t: Thaw, signal: AbortSignal): Promise<void> {
	const u = new URL(THAW_PATH, t.peer.origin);
	const signed = t.fed.key ? sign_headers(t.fed.key, 'POST', u, t.body, undefined) : {};
	const res = await net.fetch(u, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...signed },
		body: t.body,
		signal: timers.timeout(PEER_TRY_MS, signal)
	});
	if (!res.ok) throw new Error(`${t.peer_name} answered ${res.status}`);
}

function thaw_outbox(name: string, say: boolean): Outbox<Thaw> {
	return outbox<Thaw>({
		name,
		send: post_thaw,
		id: (t) => `${t.id}\n${t.peer_name}`,
		retry: PEER_POLICY,
		giveUp: say
			? (t, error) => warn('federation_thaw_notice_failed', t.peer_name, error)
			: () => {}, // ok: the deploy thaw names the peers that missed it once its rounds are spent
		waitUntil: (work) => fed_app()?.keepAlive(work)
	});
}

const publish_thaws = thaw_outbox('federation thaw notices', true);
/** The deploy thaw's notices (serve.ts): its rounds say who never took them. */
export const deploy_thaws: Outbox<Thaw> = thaw_outbox('federation deploy thaw', false);

/** Send one thaw notice to every peer, or to the peers named in `to`, through `box`. Also the
 *  chain forwarder: a notice this app RECEIVED and applied re-broadcasts with `hop + 1`. The names
 *  of the peers that did not take it (the deploy thaw sends it to those again). */
export async function broadcast_thaw(
	fed: Federation,
	notice: { id: string; hop: number; tags: string[] | 'all' },
	to?: ReadonlySet<string>,
	box: Outbox<Thaw> = publish_thaws
): Promise<Set<string>> {
	const missed = new Set<string>();
	if (notice.hop >= HOP_MAX) return missed;
	const bytes = new TextEncoder().encode(JSON.stringify({ ...notice, from: fed.name }));
	const body = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	) as ArrayBuffer;
	const peers = [...fed.peers].filter(([name]) => !to || to.has(name));
	const reached = await Promise.all(
		peers.map(([peer_name, peer]) => box.put({ fed, peer, peer_name, id: notice.id, body }))
	);
	reached.forEach((took, i) => {
		if (!took) missed.add(peers[i][0]);
	});
	return missed;
}

export { current_federation };
export type { Federation, Peer, Claims, FragmentDocument, WidgetDocument };
