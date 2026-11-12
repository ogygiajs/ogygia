/**
 * The federation request server — SERVER ONLY (imports the region secret virtuals). The handle
 * delegates every `/og/fragment/*`, `/og/thaw`, and `/og/frag` (deferred hole) request here. Reads
 * the app's registration from `current_federation()`; unregistered apps serve nothing (null).
 *
 * This is the v2 replacement for the v1 `expose()` / `catalog()` / `proxy()` route files: the
 * handle owns all of it, so a `federate()` in hooks.server.ts is the whole wiring.
 */
import { version } from '$app/env';
import { backoffAfter, flights, machine, policy, type Policy } from '@ogygia/machine';
import type { RequestEvent } from '@sveltejs/kit';
import type { ServerApp } from '@ogygia/core/plugin';
import { current_federation } from './registry.ts';
import { begin_source_capture, broadcast_thaw, deploy_thaws } from './federate.ts';
import { set_hole_signer } from './hole.ts';
import { fed_app } from './app.ts';
import { warn } from './messages.ts';
import {
	verify_signed_request,
	attach_claims,
	absolutize,
	lift_document,
	moved_card,
	json_response,
	json_error,
	read_capped_body,
	child_traceparent,
	USER_HEADER_NAME,
	FRAGMENT_ROUTES_PATH,
	FRAGMENT_BASE,
	THAW_PATH,
	type Claims,
	type VerifyConfig
} from './wire.ts';
import type { Federation, Peer } from './types.ts';

const HOLE_PATH = '/og/frag';

/** Every configured peer's public keys — the authorized-caller set for an inbound request. */
function inbound_verify(fed: Federation): VerifyConfig {
	const publicKeys: string[] = [];
	for (const peer of fed.peers.values()) publicKeys.push(...peer.keys);
	return { publicKeys, audience: fed.audience, skewMs: fed.skew_ms };
}

/** The HMAC-signed message for a deferred hole capability (peer + kind + target + search + exp). */
const hole_message = (peer: string, kind: string, target: string, search: string, exp: string) =>
	`frag.${peer}.${kind}.${target}.${search}.${exp}`;

/**
 * Install the hole signer: a deferred hole is one of the app's own capabilities (`app.capability`),
 * so it lives as long as a local hole would on the same page (for the life of the deploy on a page
 * postrender stores or a shared cache keeps), and once expired the runtime renews it the same way.
 * Idempotent.
 */
export function install_federation(app: ServerApp): void {
	set_hole_signer(({ peer, kind, target, search = '' }) => {
		const { exp, sig } = app.capability.mint((e) => hole_message(peer, kind, target, search, e));
		// `exp` + `sig` last: the volatile tail a region's identity cuts off
		const q = new URLSearchParams({ peer, kind, target, search, exp, sig });
		return `${HOLE_PATH}?${q}`;
	});
}

// Deploy-thaw: on the first federation request after a boot with a NEW build id, a producer app
// broadcasts a thaw-all so every consumer drops the stored pages that baked its now-stale assets.
// A store plugin keeps the last build it saw (the shared `lastBuild` hook; on a shared store only a
// changed `version` fires). No store plugin: nothing remembers a build, nothing fires.
//
// Its lifecycle, one machine: not checked yet (or a check to try again, with the time a request may,
// and the thaw OWED, if one was found due: its notice and the peers that have not taken it),
// checking (requests meanwhile join it), done. The store answers once, at the first check: the
// instance that sees the new build first moves the marker, and it alone owes the thaw from then on,
// so the other instances of the app never thaw the peers again. An owed thaw goes again, under the
// same id, only to the peers that missed it, for DEPLOY_THAW_ROUNDS checks; then a warning names
// who never took it (their stored pages keep the old build until their TTL). It once flipped to done
// before the work and was never tried again: one store blip at the first request after a deploy, and
// consumers kept pages with stale asset hashes until TTL (#198).
/** A thaw found due: its notice id, the peers that have not taken it, and the rounds sent so far. */
type Owed = { id: string; peers: ReadonlySet<string>; rounds: number };

const deploy_thaw = machine<{
	unchecked: { after: number; owed: Owed | null };
	checking: { run: Promise<void> };
	done: {};
}>()({
	name: 'deploy thaw',
	initial: 'unchecked',
	steps: { unchecked: ['checking'], checking: ['done', 'unchecked'], done: [] }
});

/** How the deploy check and its owed thaw are tried again: by a request at least 30 s after the last
 *  (no timer: a request does it, so an idle instance holds none), the owed thaw sent to the peers
 *  that missed it for 10 rounds before it is given up (#221). Five minutes rides out a peer's own
 *  deploy; past it the peer is down for real, and the warning names it. */
const DEPLOY_THAW_POLICY: Policy = policy({
	attempts: 10,
	backoff: [30_000],
	jitter: 0,
	deadline: Infinity
});
/** A check to try again is tried by a request at least this long after the last. */
const DEPLOY_RETRY_MS = backoffAfter(DEPLOY_THAW_POLICY, 1);
/** How many rounds an owed thaw is sent to the peers that missed it before it is given up. */
export const DEPLOY_THAW_ROUNDS: number = DEPLOY_THAW_POLICY.attempts;

let deploy = deploy_thaw.create({ after: 0, owed: null });

/** Tests: forget the deploy thaw's state (a fresh boot). */
export function reset_deploy_thaw_for_tests(): void {
	deploy = deploy_thaw.create({ after: 0, owed: null });
}

/** The deploy check for this request: start it, join the one running, or nothing (done, or one to
 *  try again that is not due yet). */
export function deploy_thaw_check(fed: Federation): Promise<void> {
	if (fed.deploy !== 'auto') return Promise.resolve();
	const s = deploy.now;
	if (s.kind === 'checking') return s.run;
	if (s.kind === 'done' || Date.now() < s.after) return Promise.resolve();
	const run = check_deploy(fed, s.owed).then(checked);
	deploy.move('unchecked', 'checking', { run });
	return run;
}

/** What a check leaves: done, or a check to try again (with the thaw still owed, if one is). */
type Checked = { done: true } | { done: false; owed: Owed | null };

/** A check ended: done, or tried again by a request after DEPLOY_RETRY_MS. */
function checked(c: Checked): void {
	if (c.done) deploy.move('checking', 'done');
	else deploy.move('checking', 'unchecked', { after: Date.now() + DEPLOY_RETRY_MS, owed: c.owed });
}

/** One check (it never throws). `owed`: the thaw an earlier check found due, still owed. */
async function check_deploy(fed: Federation, owed: Owed | null): Promise<Checked> {
	if (!fed.expose && fed.widgets.size === 0) return { done: true }; // only producers matter
	const app = fed_app();
	if (!app) return { done: true };
	try {
		if (!owed) {
			// (throws when the store cannot answer: a check to try again, not "no store")
			const seen = await app.ask.lastBuild(version);
			if (seen === undefined || seen === version) return { done: true };
			owed = { id: crypto.randomUUID(), peers: new Set(fed.peers.keys()), rounds: 0 };
		}
		const missed = await broadcast_thaw(
			fed,
			{ id: owed.id, hop: 0, tags: 'all' },
			owed.peers,
			deploy_thaws
		);
		if (missed.size === 0) return { done: true };
		const rounds = owed.rounds + 1;
		if (rounds < DEPLOY_THAW_ROUNDS)
			return { done: false, owed: { id: owed.id, peers: missed, rounds } };
		warn('federation_deploy_thaw_undelivered', { peers: [...missed].join(', '), rounds });
		return { done: true };
	} catch {
		return { done: false, owed };
	}
}

/** Dispatch a federation request, or null if the path is none of ours. */
export async function serve_federation(event: RequestEvent): Promise<Response | null> {
	const fed = current_federation();
	if (!fed) return null;
	const { url } = event;
	const path = url.pathname;

	if (path.endsWith(FRAGMENT_ROUTES_PATH)) {
		void deploy_thaw_check(fed); // ok: a check never rejects (a failed one is tried again later)
		return serve_expose(fed, event);
	}
	if (path.endsWith(HOLE_PATH)) return serve_hole(fed, event);
	if (path.endsWith(THAW_PATH)) return serve_thaw(fed, event);
	// widgets: /og/fragment/<name> (but NOT /og/fragment/page, handled above)
	const frag_at = path.indexOf(FRAGMENT_BASE);
	if (frag_at !== -1) {
		const name = path.slice(frag_at + FRAGMENT_BASE.length);
		if (name && !name.includes('/')) {
			void deploy_thaw_check(fed); // ok: a check never rejects (a failed one is tried again later)
			return serve_widget(fed, event, name);
		}
	}
	return null;
}

// ── expose: the whole route table as a fragment document ─────────────────────────────────────
async function serve_expose(fed: Federation, event: RequestEvent): Promise<Response | null> {
	if (!fed.expose) return json_error(404, 'this app exposes no route table (federate({ expose }))');
	const { url, request } = event;
	const t0 = performance.now();
	const trace = child_traceparent(request.headers.get('traceparent'));
	const path = url.searchParams.get('path') ?? '/';
	const search = url.searchParams.get('search') ?? '';
	const target = new URL(
		fed.base + (path.startsWith('/') ? path : '/' + path) + search,
		url.origin
	);

	const body = await read_capped_body(request, fed.max_body);
	if (body === null) return json_error(413, 'body too large');

	// signature gate FIRST (401 before any routing) unless intentionally open
	let claims: Claims | undefined;
	if (!fed.open) {
		const v = verify_signed_request(inbound_verify(fed), request, url, body);
		if (!v) return json_error(401, 'invalid or missing signature');
		claims = v.user;
	}

	const fwd = new Request(target, { method: request.method, headers: request.headers, body });
	fwd.headers.delete(USER_HEADER_NAME); // the raw header never counts as identity
	fwd.headers.set('traceparent', trace.traceparent);
	attach_claims(fwd, claims);

	const capture = begin_source_capture(request);
	const sources = capture.sources;
	let res: Response | null;
	try {
		res = await fed.expose.fetch(fwd, event);
	} finally {
		capture.end();
	}

	const doc = (d: Record<string, unknown>) => {
		const ms = Math.round((performance.now() - t0) * 10) / 10;
		return json_response(
			{
				...d,
				sources: [...sources],
				build: version,
				trace: { trace_id: trace.trace_id, span_id: trace.span_id },
				server_ms: ms
			},
			200,
			{ 'server-timing': `og-fragment;dur=${ms}` }
		);
	};

	if (!res) return doc({ status: 404, title: 'not found', css: [], body: 'router did not match' });
	if (res.status >= 300 && res.status < 400)
		return doc({
			status: res.status,
			location: res.headers.get('location') ?? '/',
			title: '',
			css: [],
			body: ''
		});
	const html = await res.text();
	return doc({ status: res.status, path: fed.base + path, ...lift_document(html, url.origin) });
}

// ── widgets: /og/fragment/<name> ─────────────────────────────────────────────────────────────
async function serve_widget(fed: Federation, event: RequestEvent, name: string): Promise<Response> {
	const { url, request } = event;
	// the manifest is deliberately UNSIGNED — inventory, not data (CI diffs it)
	if (name === '__catalog') {
		const names = [...fed.widgets.keys()].sort();
		const widgets = Object.fromEntries(
			names.map((n) => [n, { props: [...(fed.widgets.get(n)!.props ?? [])].sort() }])
		);
		return json_response({ names, widgets });
	}
	let user: Claims | undefined;
	if (!fed.open) {
		const v = verify_signed_request(inbound_verify(fed), request, url);
		if (!v) return json_error(401, 'invalid or missing signature');
		user = v.user;
	}
	const def = fed.widgets.get(name);
	if (!def) return json_error(404, `unknown fragment '${name}'`);
	const trace = child_traceparent(request.headers.get('traceparent'));
	const t0 = performance.now();
	const props: Record<string, string> = {};
	for (const [k, v] of url.searchParams) props[k] = v;

	const capture = begin_source_capture(request);
	const sources = capture.sources;
	let baked: { html: string | null };
	try {
		baked = await def.make(props, { user, request, url });
	} finally {
		capture.end();
	}
	if (baked?.html == null) return json_error(500, 'fragment did not bake');
	const ms = Math.round((performance.now() - t0) * 10) / 10;
	return json_response(
		{
			html: absolutize(baked.html, url.origin),
			origin: url.origin,
			sources: [...sources],
			build: version,
			trace: { trace_id: trace.trace_id, span_id: trace.span_id },
			server_ms: ms
		},
		200,
		{ 'server-timing': `og-fragment;dur=${ms}` }
	);
}

// ── deferred holes: /og/frag (the shell's own signed capability) ──────────────────────────────
async function serve_hole(fed: Federation, event: RequestEvent): Promise<Response> {
	const { url } = event;
	const p = url.searchParams;
	const peer_name = p.get('peer') ?? '';
	const kind = p.get('kind') ?? '';
	const target = p.get('target') ?? '';
	const search = p.get('search') ?? '';
	// expired, renewal, bad signature: answered as a region hole is (a 403 the runtime renews once)
	const opened = fed_app()?.capability.open(url, (e) =>
		hole_message(peer_name, kind, target, search, e)
	);
	if (!opened) return new Response('forbidden', { status: 403 });
	if (!opened.ok) return opened.response;
	const peer = fed.peers.get(peer_name);
	if (!peer) return new Response('unknown peer', { status: 404 });
	const traceparent = child_traceparent(event.request.headers.get('traceparent')).traceparent;
	// one of the peer's own region endpoints, its fragment carried: no hop, no claims (the peer
	// signed what it renders into its own capability). Not the region's answer: a 502, the
	// fallback stands and the runtime says so.
	if (kind === 'endpoint') {
		const got = await peer.endpoint(target, traceparent);
		if (got === null) return new Response('bad gateway', { status: 502, headers: NO_STORE });
		if (got.status === 204)
			return new Response(null, { status: 204, headers: { ...NO_STORE, ...opened.headers } });
		return hole_html(got.html, opened.headers);
	}

	// claims are derived HERE, server-side, from the shell's own session — never from the browser
	const claims = fed.visitor?.({
		request: event.request,
		url,
		cookies: event.cookies,
		locals: event.locals
	});
	// (a renewal's answer carries the fresh capability, which the runtime adopts for later fetches)
	const answer = (html: string) => hole_html(html, opened.headers);
	try {
		if (kind === 'widget') {
			const props: Record<string, string> = {};
			for (const [k, v] of new URLSearchParams(search)) props[k] = v;
			const wdoc = await peer.widgetDoc(target, props, { claims, traceparent });
			return answer(wdoc.html);
		}
		const doc = await peer.doc(target, search, claims, traceparent);
		if (doc.location) return answer(String(moved_card('data-og-moved', 'section', doc.location)));
		return answer((doc.css?.join('') ?? '') + (doc.head ?? '') + doc.body);
	} catch {
		return answer('');
	}
}

/** A hole response: the runtime swaps this HTML into the region element and its islands wake. */
function hole_html(html: string, headers: Record<string, string>): Response {
	return new Response(html, {
		status: 200,
		headers: { 'content-type': 'text/html; charset=utf-8', ...NO_STORE, ...headers }
	});
}

/** A hole's answer is per visitor and per capability: never kept by a cache. */
const NO_STORE = { 'cache-control': 'no-store' };

// ── thaw: /og/thaw (a peer's publish/deploy notice) ──────────────────────────────────────────
const NOTICE_TTL_MS = 10 * 60_000;

/** A notice as this app applies it: who sent it, and what it thaws here. */
type Received = {
	fed: Federation;
	id: string;
	hop: number;
	tags: string[] | 'all';
	sender: Peer;
	sender_name: string;
};

/**
 * The receiver's half of the sender's outbox: the notices applied, by id. A notice is applied
 * first and its id kept after (#287), as a flight is kept only once it lands: a failed apply keeps
 * nothing, so the sender's retry of it is applied. A copy that arrives while it applies joins it,
 * and one after is dropped. Ids are kept 10 minutes, the newest 10 000 at most.
 */
const SAME_NOTICE = 'an id names one notice: a copy of it is that notice again';
const applied_notices = flights.keyed<Received>()({
	name: 'federation thaws applied',
	key: ['id'],
	ignore: {
		fed: SAME_NOTICE,
		hop: SAME_NOTICE,
		tags: SAME_NOTICE,
		sender: SAME_NOTICE,
		sender_name: SAME_NOTICE
	},
	run: apply_thaw,
	keep: NOTICE_TTL_MS,
	max: 10_000
});

/** Applies a notice here, then passes it on to this app's own consumers: the number of tags it
 *  thawed. Throws when the store did not apply it (nothing is passed on then). */
async function apply_thaw(n: Received): Promise<number> {
	// map the sender's tags into THIS app's namespace (how its peer handle filed the pages)
	const local = map_thaw_tags(n.sender_name, n.tags);
	// the cached documents from that peer go either way (they are this app's own memory); the
	// stored pages go through the store, which can fail (the store said why: plugin_hook_failed)
	if (local.length) n.sender.drop(new Set(local));
	else if (n.tags === 'all') n.sender.drop('all');
	if (local.length) await fed_app()?.notify.invalidate(local);
	else if (n.tags === 'all') await fed_app()?.notify.invalidate([`a:${n.sender_name}`]);
	// chain: tell MY consumers, with the tags I just applied, hop+1 (an outbox send, kept alive past
	// this answer; a consumer that never took it is said)
	void broadcast_thaw(n.fed, {
		id: n.id || crypto.randomUUID(),
		hop: n.hop + 1,
		tags: n.tags === 'all' ? 'all' : local
	}); // ok: broadcast_thaw never rejects (an outbox put never does)
	return local.length;
}

async function serve_thaw(fed: Federation, event: RequestEvent): Promise<Response> {
	const { request, url } = event;
	const body = await read_capped_body(request, fed.max_body);
	if (body === null) return json_error(413, 'body too large');

	// identify the SENDER by which peer's key verifies (its name prefixes the thawed tags)
	let sender: (Peer & { keys: readonly string[] }) | null = null;
	let sender_name = '';
	for (const [pname, peer] of fed.peers) {
		if (peer.keys.length === 0) continue;
		const v = verify_signed_request(
			{ publicKeys: peer.keys, audience: fed.audience, skewMs: fed.skew_ms },
			request,
			url,
			body
		);
		if (v) {
			sender = peer;
			sender_name = pname;
			break;
		}
	}
	if (!sender) return json_error(401, 'invalid or missing signature');

	let notice: { id?: string; hop?: number; tags?: string[] | 'all' };
	try {
		notice = JSON.parse(new TextDecoder().decode(body ?? new Uint8Array()));
	} catch {
		return json_error(400, 'bad notice');
	}
	const received: Received = {
		fed,
		id: notice.id ?? '',
		hop: notice.hop ?? 0,
		tags: notice.tags ?? [],
		sender,
		sender_name
	};
	if (received.id && applied_notices.peek({ id: received.id })?.kind === 'kept')
		return json_response({ ok: true, deduped: true });
	try {
		const thawed = received.id ? await applied_notices.get(received) : await apply_thaw(received);
		return json_response({ ok: true, thawed });
	} catch {
		// not applied: no id kept and no "done", so the sender's retry of this notice is applied,
		// and nothing is passed on (#287)
		return json_error(503, 'thaw not applied');
	}
}

/** `p:<path>` → `p:<peer>:<path>`; `s:…`/`r:…` → `r:<peer>:…`; `a:…` → `a:<peer>`. */
function map_thaw_tags(peer: string, tags: string[] | 'all'): string[] {
	if (tags === 'all') return [];
	return tags.map((t) => {
		if (t.startsWith('p:')) return `p:${peer}:${t.slice(2)}`;
		if (t.startsWith('a:')) return `a:${peer}`;
		return `r:${peer}:${t}`;
	});
}

export type { Federation };
