/**
 * `OgygiaError` and `warn` for island-side code (a shim a component imports). Island code never
 * imports a runtime module — one both import is split into a chunk of its own — so these are the
 * runtime's own (./core.ts), which its boot publishes (runtime/core.ts), and on a page with no ogygia
 * runtime the code's link alone. Same calls: `throw new OgygiaError(code, args)`, `warn(code, args)`.
 */
import type { OgygiaError as CoreError, warn as core_warn } from './core.ts';

type Published = { OgygiaError: typeof CoreError; warn: typeof core_warn };
// (the key is repeated in the boot on purpose: importing it from here would be the very edge this
// module exists to avoid)
const runtime = (): Published | undefined =>
	(globalThis as unknown as Record<symbol, Published | undefined>)[Symbol.for('ogygia.messages')];
const link = (code: string) => '[ogygia] https://ogygiajs.dev/e/' + code;

export const OgygiaError: typeof CoreError = function (code: string, a?: unknown) {
	const own = runtime();
	return own
		? new (own.OgygiaError as unknown as new (code: string, a?: unknown) => Error)(code, a)
		: Object.assign(new Error(link(code)), { code });
} as unknown as typeof CoreError;

export const warn: typeof core_warn = ((code: string, ...rest: unknown[]) => {
	const own = runtime();
	if (own) (own.warn as (code: string, ...rest: unknown[]) => void)(code, ...rest);
	else console.warn(link(code));
}) as typeof core_warn;
