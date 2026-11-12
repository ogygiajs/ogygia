/**
 * THE SERVER'S RULES (#313, ../rules.ts): what is always true of the server, checked a task after
 * each response ends (in dev, and in a build made with `OGYGIA_RULES=1`), printed with its code.
 *
 * - `rule_request_scope_open`: a request's scope (its timers, streams, fetches) is closed once its
 *   response has ended.
 * - `rule_flight_kept_failure`: no flight keeps a failure: an answer kept is never an error.
 * - `rule_kept_unkeyed_read`: a kept render read nothing its key does not cover (a per-visitor read
 *   in an anonymous render, #434).
 * - `rule_region_answer_shared`: every region endpoint answer says `Referrer-Policy: no-referrer`
 *   and a `Cache-Control` no shared cache keeps (`no-store` or `private`).
 * - `rule_capability_not_path`: every minted capability URL is a same-origin path.
 *
 * Each area tells this module what it holds (`note_response_end`) only when rules are on: every call
 * site folds out of a build without them.
 */
import { cache, observe, timers, trace, type AnyMachine, type Scope } from '@ogygia/machine';
import { Rules } from '../rules.ts';
import { warn } from '../messages/server.ts';

/** What the rules track at once, at most (a server in dev, a simulated run): far past one
 *  process's requests in flight. One past it is not checked, never held. */
const RULE_ROWS_MAX = 10_000;

type ServerRule =
	| 'rule_request_scope_open'
	| 'rule_flight_kept_failure'
	| 'rule_kept_unkeyed_read'
	| 'rule_region_answer_shared'
	| 'rule_capability_not_path';

/** The few breaks found so far (10 each, at most). */
class Breaks {
	/** The first region answers that left without their headers (CAPABILITY-URL, HOLE-CACHE). */
	readonly answers: string[] = [];
	/** The first capability URLs minted with more than a path (CAPABILITY-URL, HOLE-TRUST). */
	readonly mints: string[] = [];
}
const B = new Breaks();

/** Why a region endpoint answer is unsafe to send, or null: it must keep its capability out of
 *  every Referer (`no-referrer`) and out of every shared cache (`no-store`, or `private`). */
export function region_answer_unsafe(res: Response): string | null {
	const referrer = res.headers.get('referrer-policy');
	if (referrer !== 'no-referrer') return `referrer-policy: ${referrer ?? '(none)'}`;
	const cache = res.headers.get('cache-control');
	if (!cache) return 'no cache-control';
	const directives = cache
		.toLowerCase()
		.split(',')
		.map((d) => d.trim().split('=')[0]);
	if (
		!(directives.includes('no-store') || directives.includes('private')) ||
		directives.includes('public') ||
		directives.includes('s-maxage')
	)
		return `cache-control: ${cache}`;
	return null;
}

/** A region endpoint answer is about to leave: one without its headers breaks the rule. */
export function note_region_answer(path: string, res: Response): void {
	if (!installed) return;
	const why = region_answer_unsafe(res);
	if (why === null) return;
	if (B.answers.length < 10) B.answers.push(`${path} (${res.status}): ${why}`);
	check_soon();
}

/** A capability was minted: one that is not a same-origin path (`/…`, never `//…`) breaks the rule. */
export function note_minted_capability(url: string): void {
	if (!installed) return;
	if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return;
	// (the address only: the query is the capability)
	if (B.mints.length < 10) B.mints.push(url.split('?')[0]!);
	check_soon();
}

/** The server's rules. */
export const server_rules: Rules<ServerRule> = /* @__PURE__ */ new Rules<ServerRule>();

/** Request scopes whose response has ended, until a check sees them closed. */
const ended = cache<Scope, true>({ name: 'ended request scopes', max: RULE_ROWS_MAX });

/** A response ended (its body read to the end, cancelled, or none): its request's scope must be
 *  closed by the time the next check runs. */
export function note_response_end(owner: Scope): void {
	if (!installed) return;
	ended.set(owner, true);
	check_soon();
}

function request_scopes_closed(): string | null {
	let open = 0;
	for (const [owner] of ended.entries()) {
		if (owner.closed) ended.delete(owner);
		else open++;
	}
	return open === 0 ? null : `${open} request scope(s) still open after their response ended`;
}

/** The flights' entries that keep an error as their answer now, each with what it keeps. An entry
 *  leaves when it moves on (dropped, or a fresh answer kept): the rule is about what is kept now, so
 *  a check (a simulated run, the next response in dev) sees its own breaks, not an earlier one's. */
const kept_failures = cache<AnyMachine, string>({
	name: 'kept flight failures',
	max: RULE_ROWS_MAX
});

function no_kept_failure(): string | null {
	if (kept_failures.size === 0) return null;
	return kept_failures
		.entries()
		.slice(0, 10)
		.map(([, said]) => said)
		.join('; ');
}

/** Kept answers that read what their key does not cover (server/render-cache.ts `unkeyed_read`),
 *  each with that read, while they stay kept. */
const kept_unkeyed = cache<AnyMachine, string>({
	name: 'kept unkeyed reads',
	max: RULE_ROWS_MAX
});

function no_kept_unkeyed_read(): string | null {
	if (kept_unkeyed.size === 0) return null;
	return kept_unkeyed
		.entries()
		.slice(0, 10)
		.map(([, said]) => said)
		.join('; ');
}

/** The read a kept answer made that its key does not cover, or null. */
function unkeyed_read_of(answer: unknown): string | null {
	if (typeof answer !== 'object' || answer === null || !('unkeyed_read' in answer)) return null;
	const read = (answer as { unkeyed_read: unknown }).unkeyed_read;
	return typeof read === 'string' ? read : null;
}

let installed = false;
let pending = false;

/** Checks every rule a task from now (once, however many responses ask), and says what broke. */
function check_soon(): void {
	if (pending) return;
	pending = true;
	// oxlint-disable-next-line ogygia/owned-effects -- the server's rule check, a task after the responses that asked for it: it ends itself, and the rules outlive every request
	timers.keep(() => {
		pending = false;
		server_rules.say((code, detail) => warn(code, { detail }));
	}, 0);
}

/** Rules on: checked after each response, and what broke is said with its code. */
export function install_server_rules(): void {
	if (installed) return;
	installed = true;
	server_rules.add('rule_request_scope_open', request_scopes_closed);
	server_rules.add('rule_flight_kept_failure', no_kept_failure);
	server_rules.add('rule_kept_unkeyed_read', no_kept_unkeyed_read);
	server_rules.add('rule_region_answer_shared', () =>
		B.answers.length ? B.answers.join('; ') : null
	);
	server_rules.add('rule_capability_not_path', () => (B.mints.length ? B.mints.join('; ') : null));
	// a flight's entry moving to `kept` with an error, or a render that read what its key does not
	// cover, for its answer (flights' machine, @ogygia/machine), and out of it again
	observe((name, _from, to, machine) => {
		const answer = to?.kind === 'kept' ? (to as { answer?: unknown }).answer : undefined;
		if (answer instanceof Error)
			kept_failures.set(machine, `"${name}" kept ${answer.name}: ${answer.message.slice(0, 120)}`);
		else if (kept_failures.size !== 0) kept_failures.delete(machine);
		const unkeyed = unkeyed_read_of(answer);
		if (unkeyed !== null) kept_unkeyed.set(machine, `"${name}" kept a render that read ${unkeyed}`);
		else if (kept_unkeyed.size !== 0) kept_unkeyed.delete(machine);
	});
	// the server's machine moves, one line each (its last SERVER_MOVES), for a harness to read: the
	// browser's `__ogygia_moves()` (../runtime/rules.ts), under a symbol a process keeps one of
	const moves = trace({ max: SERVER_MOVES });
	(globalThis as Record<symbol, unknown>)[Symbol.for('ogygia.server.moves')] = () => moves.text();
}

/** Moves the server's trace keeps: many requests' worth between two reads. */
const SERVER_MOVES = 5000;
