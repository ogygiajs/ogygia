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
import { type Scope } from '@ogygia/machine';
import { Rules } from '../rules.ts';
type ServerRule = 'rule_request_scope_open' | 'rule_flight_kept_failure';
/** The server's rules. */
export declare const server_rules: Rules<ServerRule>;
/** A response ended (its body read to the end, cancelled, or none): its request's scope must be
 *  closed by the time the next check runs. */
export declare function note_response_end(owner: Scope): void;
/** Rules on: checked after each response, and what broke is said with its code. */
export declare function install_server_rules(): void;
export {};
