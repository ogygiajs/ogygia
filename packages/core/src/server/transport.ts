/**
 * The app's Kit `transport` hook in the SERVER realm. Kit runs one `transport` both ways, and the two
 * directions do different jobs: `encode` runs on the server (load data, a remote function's answer),
 * `decode` in the browser. The one place the server DECODES with it is a value a browser sent: a
 * remote function's argument, the refresh keys of a command (Kit's `parse_remote_arg`). Nothing
 * ogygia sends the browser has to come back that way: a region is fetched by its signed capability,
 * and a region's props are decoded from their signed payload (hooks.ts, not this hook). So on the
 * server every ogygia value kind (region, snippet, fn, wire, store, derived) is refused at decode
 * with a 400 and `remote_arg_not_data`; encode is the browser transport's own.
 *
 * The app installs one hook (`transport` from `'ogygia'`); its realm picks this or the browser's
 * (compiler/link/transport.ts `kit_transport_module`), and `ogygia/server` exports this one.
 */
import { error } from '@sveltejs/kit';
import { OgygiaError } from '../messages/server.ts';
import { REF_WIRE_KEY, type Ref } from '../ref.ts';
import { ogygiaTransport } from '../transport.ts';

const KINDS: ReadonlySet<unknown> = new Set([
	'wire',
	'store',
	'snippet',
	'fn',
	'derived',
	'region'
]);

/** A browser sent an ogygia value where only plain data may come: refused as a bad request. */
function refuse(kind: string): never {
	error(400, new OgygiaError('remote_arg_not_data', { kind }).message);
}

export const ogygiaServerTransport: typeof ogygiaTransport = {
	Region: {
		encode: ogygiaTransport.Region.encode,
		decode: () => refuse('region')
	},
	[REF_WIRE_KEY]: {
		encode: ogygiaTransport[REF_WIRE_KEY].encode,
		// (the kind is the browser's word: named only when it is one of ours)
		decode: (ref: Ref) => refuse(KINDS.has(ref?.k) ? ref.k : 'unknown')
	}
};
