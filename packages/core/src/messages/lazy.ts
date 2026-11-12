/**
 * `OgygiaError` and `warn` for the runtime's lazy chunks (the hydrate core, the router's navigation)
 * and what only they import. A lazy chunk never imports a boot module — one both import is split
 * into a chunk of its own — so these are the boot's own (./core.ts), reached through the boot link;
 * where no boot linked them (the server's render of the same module, a test), the copy the server's
 * handle publishes (./island.ts), else the code's link alone. Same calls:
 * `throw new OgygiaError(code, args)`, `warn(code, args, ...rest)`.
 */
import { slots } from '../runtime/slots.ts';
import type { OgygiaError as CoreError, warn as core_warn } from './core.ts';

type Own = { OgygiaError: typeof CoreError; warn: typeof core_warn };
const own = (): Own | undefined =>
	slots.boot ??
	(globalThis as unknown as Record<symbol, Own | undefined>)[Symbol.for('ogygia.messages')];
const link = (code: string) => `[ogygia] https://ogygiajs.dev/e/${code}`;

export const OgygiaError: typeof CoreError = function (code: string, a?: unknown) {
	const m = own();
	return m
		? new (m.OgygiaError as unknown as new (code: string, a?: unknown) => Error)(code, a)
		: Object.assign(new Error(link(code)), { code });
} as unknown as typeof CoreError;

export const warn: typeof core_warn = ((code: string, ...rest: unknown[]) => {
	const m = own();
	if (m) (m.warn as (code: string, ...rest: unknown[]) => void)(code, ...rest);
	else console.warn(link(code));
}) as typeof core_warn;
