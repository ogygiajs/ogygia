/**
 * `OgygiaError`, `warn` and `line` for code that runs inside islands and in the server's render too
 * (a shim, a transport, `Region`). Island code never imports a runtime module — one both import is
 * split into a chunk of its own — so these are the runtime's own (./core.ts), which the runtime's
 * boot publishes (runtime/core.ts) and the server's handle too (hooks.ts); with neither (a page with
 * no ogygia runtime), the code's link alone. Same calls: `throw new OgygiaError(code, args)`,
 * `warn(code, args)`, `line(code, args)`.
 */
import type { OgygiaError as CoreError, warn as core_warn, line as core_line } from './core.ts';
export declare const OgygiaError: typeof CoreError;
export declare const warn: typeof core_warn;
export declare const line: typeof core_line;
