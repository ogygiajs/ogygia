/**
 * Node's transport for the remote fetch (./remote-fetch.ts): one GET by `node:http` or
 * `node:https`, its redirects not followed, its body not decoded. A host the `hosts` list takes only
 * by a `*.` entry is connected to only when every address it resolves to is public
 * (../remote-hosts.ts `private_address`): the check runs in the connection's own lookup, on the
 * addresses it connects to, so a name cannot answer a public address to a check and a private one
 * to the connection. A host an entry names itself is trusted wherever it points.
 *
 * @packageDocumentation
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { RemoteFailed, type Transport } from './remote-fetch.ts';
import { private_address } from './remote-hosts.ts';

/** A resolver as `dns.lookup` is one, asked for every address. */
export type Lookup = (
	hostname: string,
	options: dns.LookupAllOptions,
	callback: (err: NodeJS.ErrnoException | null, addresses: dns.LookupAddress[]) => void
) => void;

const SYSTEM_LOOKUP: Lookup = (hostname, options, callback) =>
	dns.lookup(hostname, options, callback);
const NO_BODY: ReadonlySet<number> = new Set([204, 205, 304]);

/** The lookup a connection resolves `lookup`'s answers by: every address it is given, or, with
 *  `public_only`, only when every one is public (else it fails, `private`). */
export function connect_lookup(lookup: Lookup, public_only: boolean): LookupFunction {
	return (hostname, options, callback) => {
		lookup(hostname, { ...options, all: true }, (err, addresses) => {
			const done = callback as (
				err: NodeJS.ErrnoException | null,
				address: string | dns.LookupAddress[],
				family?: number
			) => void;
			if (err) return done(err, '');
			const shut = public_only ? addresses.find((a) => private_address(a.address)) : undefined;
			if (shut !== undefined || !addresses.length)
				return done(
					new RemoteFailed(
						'private',
						`${hostname} resolves to ${shut?.address ?? 'no address'}, not a public address, and is listed only by a '*.' entry: list '${hostname}' itself to fetch from it`
					),
					''
				);
			if (options.all) return done(null, addresses);
			return done(null, addresses[0]!.address, addresses[0]!.family);
		});
	};
}

/** The transport, resolving names with `lookup` (the system's by default). */
export function node_transport(lookup: Lookup = SYSTEM_LOOKUP): Transport {
	return (url, init, match) =>
		new Promise<Response>((resolve, reject) => {
			const send = url.protocol === 'https:' ? https.request : http.request;
			const req = send(
				{
					protocol: url.protocol,
					hostname: url.hostname.replace(/^\[(.*)\]$/, '$1'),
					port: url.port || undefined,
					path: `${url.pathname}${url.search}`,
					method: 'GET',
					headers: init.headers,
					signal: init.signal,
					agent: false,
					lookup: connect_lookup(lookup, match === 'below')
				},
				(res) => {
					const headers = new Headers();
					for (let i = 0; i + 1 < res.rawHeaders.length; i += 2)
						headers.append(res.rawHeaders[i]!, res.rawHeaders[i + 1]!);
					const status = res.statusCode ?? 0;
					const empty = NO_BODY.has(status);
					if (empty) res.resume();
					try {
						resolve(
							new Response(empty ? null : (Readable.toWeb(res) as ReadableStream<Uint8Array>), {
								status,
								headers
							})
						);
					} catch (e) {
						res.destroy();
						reject(e as Error);
					}
				}
			);
			req.on('error', reject);
			req.end();
		});
}

/** Node's transport with the system's resolver. */
export const node_get: Transport = node_transport();
