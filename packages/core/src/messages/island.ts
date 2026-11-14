/**
 * `OgygiaError`, `warn` and `line` for code that runs inside islands and in the server's render too
 * (a shim, a transport, `Region`). Island code never imports a runtime module — one both import is
 * split into a chunk of its own — so these are the runtime's own (./core.ts), which the runtime's
 * boot publishes (runtime/core.ts) and the server's handle too (hooks.ts); with neither (a page with
 * no ogygia runtime), the code's link alone. Same calls: `throw new OgygiaError(code, args)`,
 * `warn(code, args)`, `line(code, args)`.
 */
import type { OgygiaError as CoreError, warn as core_warn, line as core_line } from './core.ts';

type Published = { OgygiaError: typeof CoreError; warn: typeof core_warn; line: typeof core_line };
// (the key is repeated in the boot on purpose: importing it from here would be the very edge this
// module exists to avoid)
const runtime = (): Published | undefined =>
	(globalThis as unknown as Record<symbol, Published | undefined>)[Symbol.for('ogygia.messages')];
/** The code's link with its arguments — what a production build prints (./define.ts `line`). */
function link(code: string, a?: unknown): string {
	let query = '';
	if (a && typeof a === 'object') {
		const params = new URLSearchParams();
		for (const name in a) {
			const value = (a as Record<string, unknown>)[name];
			if (value != null && value !== '') params.set(name, String(value).slice(0, 300));
		}
		query = params.toString();
	}
	return `[ogygia] https://ogygiajs.dev/e/${code}${query ? `?${query}` : ''}`;
}

export const OgygiaError: typeof CoreError = function (code: string, a?: unknown) {
	const own = runtime();
	return own
		? new (own.OgygiaError as unknown as new (code: string, a?: unknown) => Error)(code, a)
		: Object.assign(new Error(link(code, a)), { code });
} as unknown as typeof CoreError;

export const warn: typeof core_warn = ((code: string, ...rest: unknown[]) => {
	const own = runtime();
	if (own) (own.warn as (code: string, ...rest: unknown[]) => void)(code, ...rest);
	else {
		// (the arguments are the plain object after the code, as ./define.ts reads them)
		const first = rest[0];
		const proto = first !== null && typeof first === 'object' ? Object.getPrototypeOf(first) : 0;
		console.warn(link(code, proto === Object.prototype || proto === null ? first : undefined));
	}
}) as typeof core_warn;

export const line: typeof core_line = ((code: string, a?: unknown) => {
	const own = runtime();
	return own ? (own.line as (code: string, a?: unknown) => string)(code, a) : link(code, a);
}) as typeof core_line;
