// Shared code (a transport, `Region`, a shim) words its messages through the runtime's own
// (src/messages/island.ts), which the runtime's boot and the server's handle publish. A unit test
// runs that code with neither, so publish them here, the same way.
import { OgygiaError, warn, line } from '../../src/messages/core.ts';

(globalThis as unknown as Record<symbol, unknown>)[Symbol.for('ogygia.messages')] ??= {
	OgygiaError,
	warn,
	line
};
