const REDIRECT: unique symbol = Symbol.for('ogygia.router.redirect');
const HTTP_ERROR: unique symbol = Symbol.for('ogygia.router.error');
const ACTION_FAILURE: unique symbol = Symbol.for('ogygia.router.fail');

export interface Redirect {
	[REDIRECT]: true;
	status: number;
	location: string;
}
export interface HttpError {
	[HTTP_ERROR]: true;
	status: number;
	message: string;
}
export interface ActionFailure<T = Record<string, unknown>> {
	[ACTION_FAILURE]: true;
	status: number;
	data: T;
}

/** Throw a redirect from a load / action / handler — Kit's `redirect(303, '/login')`, verbatim. */
export function redirect(status: number, location: string | URL): never {
	throw { [REDIRECT]: true, status, location: String(location) } satisfies Redirect;
}

/** Throw an HTTP error from a load / action / handler — Kit's `error(404, 'Not found')`, verbatim.
 *  On a page branch the nearest error boundary renders it; on an endpoint it becomes JSON. */
export function error(status: number, message?: string): never {
	throw { [HTTP_ERROR]: true, status, message: message ?? 'Error' } satisfies HttpError;
}

/** Return an action validation failure — Kit's `fail(400, { incorrect: true })`. The router re-renders
 *  the page with `form` = data and the given status. RETURNED, not thrown (Kit's contract). */
export function fail<T extends Record<string, unknown>>(status: number, data: T): ActionFailure<T> {
	return { [ACTION_FAILURE]: true, status, data };
}

export const is_redirect = (x: unknown): x is Redirect =>
	typeof x === 'object' && x !== null && REDIRECT in x;
export const is_http_error = (x: unknown): x is HttpError =>
	typeof x === 'object' && x !== null && HTTP_ERROR in x;
export const is_action_failure = (x: unknown): x is ActionFailure =>
	typeof x === 'object' && x !== null && ACTION_FAILURE in x;

function with_defaults(
	init: ResponseInit | undefined,
	defaults: ReadonlyArray<readonly [string, string]>
): ResponseInit {
	const headers = new Headers(init?.headers);
	for (const [name, value] of defaults) if (!headers.has(name)) headers.set(name, value);
	return { ...init, headers };
}

const JSON_DEFAULTS: ReadonlyArray<readonly [string, string]> = [
	['content-type', 'application/json'],
	['cache-control', 'no-store']
];
const TEXT_DEFAULTS: ReadonlyArray<readonly [string, string]> = [
	['content-type', 'text/plain; charset=utf-8']
];

export function json_response(data: unknown, init?: ResponseInit): Response {
	return new Response(JSON.stringify(data), with_defaults(init, JSON_DEFAULTS));
}

export function text_response(body: string, init?: ResponseInit): Response {
	return new Response(body, with_defaults(init, TEXT_DEFAULTS));
}

export function redirect_response(status: number, location: string): Response {
	return new Response(null, { status, headers: { location, 'cache-control': 'no-store' } });
}

/** An endpoint/miss return → a Response: Response passes through; null/undefined → 204; else JSON. */
export function finalize(out: unknown): Response {
	if (out instanceof Response) return out;
	if (out == null) return new Response(null, { status: 204 });
	return json_response(out);
}

export function not_found(): Response {
	return new Response('Not found', { status: 404 });
}
export function method_not_allowed(allow: string[]): Response {
	return new Response('Method not allowed', { status: 405, headers: { allow: allow.join(', ') } });
}
export function options_response(allow: string[]): Response {
	return new Response(null, { status: 204, headers: { allow: allow.join(', ') } });
}
