/**
 * `OgygiaError` and `warn` for the runtime's lazy chunks (the hydrate core, the router's navigation).
 * A lazy chunk never imports a boot module — one both import is split into a chunk of its own — so
 * these are the boot's own (./core.ts), reached through the boot link. Same calls:
 * `throw new OgygiaError(code, args)`, `warn(code, args, ...rest)`.
 */
import { boot_link } from '../runtime/slots.ts';
import type { OgygiaError as CoreError, warn as core_warn } from './core.ts';

export const OgygiaError: typeof CoreError = function (code: string, a?: unknown) {
	return new (boot_link().OgygiaError as unknown as new (code: string, a?: unknown) => Error)(
		code,
		a
	);
} as unknown as typeof CoreError;

export const warn: typeof core_warn = ((...args: unknown[]) =>
	(boot_link().warn as (...args: unknown[]) => void)(...args)) as typeof core_warn;
