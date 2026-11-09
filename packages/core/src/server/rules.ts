/**
 * THE SERVER'S RULES (#313, ../rules.ts): what is always true of the server, checked a task after
 * each response ends (in dev, and in a build made with `OGYGIA_RULES=1`), printed with its code.
 *
 * - `rule_request_scope_open`: a request's scope (its timers, streams, fetches) is closed once its
 *   response has ended.
 * - `rule_flight_kept_failure`: no flight keeps a failure: an answer kept is never an error.
 *
 * Each area tells this module what it holds (`note_response_end`) only when rules are on: every call
 * site folds out of a build without them.
 */
import { observe, type Scope } from '@ogygia/machine';
import { Rules } from '../rules.ts';
import { warn } from '../messages/server.ts';

type ServerRule = 'rule_request_scope_open' | 'rule_flight_kept_failure';

/** The server's rules. */
export const server_rules: Rules<ServerRule> = /* @__PURE__ */ new Rules<ServerRule>();

/** Request scopes whose response has ended, until a check sees them closed. */
const ended = new Set<Scope>();

/** A response ended (its body read to the end, cancelled, or none): its request's scope must be
 *  closed by the time the next check runs. */
export function note_response_end(owner: Scope): void {
	if (!installed) return;
	ended.add(owner);
	check_soon();
}

function request_scopes_closed(): string | null {
	let open = 0;
	for (const owner of ended) {
		if (owner.closed) ended.delete(owner);
		else open++;
	}
	return open === 0 ? null : `${open} request scope(s) still open after their response ended`;
}

/** The kept failures found, as found (a few). */
const kept_failures: string[] = [];

const no_kept_failure = (): string | null =>
	kept_failures.length === 0 ? null : kept_failures.join('; ');

let installed = false;
let pending = false;

/** Checks every rule a task from now (once, however many responses ask), and says what broke. */
function check_soon(): void {
	if (pending) return;
	pending = true;
	// oxlint-disable-next-line ogygia/owned-effects -- the server's rule check, a task after the responses that asked for it: it ends itself, and the rules outlive every request
	setTimeout(() => {
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
	// a flight's entry moving to `kept` with an error for its answer (flights' machine, @ogygia/machine)
	observe((name, _from, to) => {
		if (kept_failures.length >= 10 || to?.kind !== 'kept') return;
		const answer = (to as { answer?: unknown }).answer;
		if (answer instanceof Error)
			kept_failures.push(`"${name}" kept ${answer.name}: ${answer.message.slice(0, 120)}`);
	});
}
