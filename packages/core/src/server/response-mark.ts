/**
 * THE RESPONSE MARK, server side (contract/response-mark.ts, INVARIANTS RESPONSE-MARK): one random
 * mark per response, made on the first ask for its request and the same for every later one, so the
 * head runtime script (head-presence.ts `runtime_first`) and every side channel of one response carry
 * one mark, whichever code path writes them (the handle, `document()`). Random, so markup authored
 * before the response cannot carry it.
 */
import { RESPONSE_MARK } from '../contract/response-mark.ts';

const marks = new WeakMap<object, string>();

function new_mark(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	let hex = '';
	for (const b of bytes) hex += b.toString(16).padStart(2, '0');
	return hex;
}

/** The mark of the response to `request`. */
export function response_mark(request: object): string {
	let mark = marks.get(request);
	if (mark === undefined) marks.set(request, (mark = new_mark()));
	return mark;
}

/** ` data-og-mark="…"`: the attribute a side channel of the response to `request` carries. */
export function mark_attr(request: object): string {
	return ` ${RESPONSE_MARK}="${response_mark(request)}"`;
}
