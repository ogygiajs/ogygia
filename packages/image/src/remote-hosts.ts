/**
 * The hosts an app takes images from (`image({ remote: { hosts } })`): each entry a host the app
 * names, `*.` in front for any name below it (one label or more), `http://` in front to allow plain
 * HTTP from it (a test server, an intranet). Every other URL is refused. Reads URLs only, so the
 * build and any server runtime check the same way.
 *
 *   'images.example.com'      https://images.example.com/…, on the default port only
 *   '*.cdn.example.com'       https://a.cdn.example.com/…, https://a.b.cdn.example.com/…
 *   'http://127.0.0.1:4100'   http://127.0.0.1:4100/…
 *
 * An entry that names a host itself (an address, or a name) trusts that host wherever it points:
 * an intranet's server, a test server. A host taken only by a `*.` entry is a name someone below
 * the listed name chose, so it is fetched from only when every address it resolves to is a public
 * one ({@link private_address}): checked on the address the connection is made to, so a name
 * that answers a public address once and a private one the next time reaches no private host.
 *
 * @packageDocumentation
 */

/** One `hosts` entry, read. */
export interface HostRule {
	protocol: 'https:' | 'http:';
	host: string;
	below: boolean;
	port: string;
}

const ENTRY_RE = /^(?:(https?):\/\/)?(\*\.)?([^/?#@\\\s*%]+)$/i;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Public suffixes anyone can host under (a country's second level, the common hosting platforms):
 *  a `*.` entry over one would list every stranger's site there. Not the whole public suffix
 *  list: the ones an app is likely to write. */
export const SHARED_SUFFIXES: ReadonlySet<string> = new Set([
	'co.uk',
	'org.uk',
	'ac.uk',
	'gov.uk',
	'com.au',
	'net.au',
	'org.au',
	'co.nz',
	'co.jp',
	'ne.jp',
	'co.in',
	'co.za',
	'com.br',
	'com.cn',
	'com.mx',
	'com.tr',
	'github.io',
	'gitlab.io',
	'vercel.app',
	'netlify.app',
	'pages.dev',
	'workers.dev',
	'r2.dev',
	'web.app',
	'firebaseapp.com',
	'appspot.com',
	'herokuapp.com',
	'fly.dev',
	'onrender.com',
	'glitch.me',
	'ngrok.io',
	'ngrok-free.app',
	'amazonaws.com',
	's3.amazonaws.com',
	'cloudfront.net',
	'azurewebsites.net',
	'blob.core.windows.net',
	'storage.googleapis.com',
	'googleusercontent.com',
	'blogspot.com',
	'wordpress.com',
	'myshopify.com'
]);

/** What a `hosts` entry must be, for a message. */
export const HOSTS_RULE =
	"a non-empty list of hosts, each a name ('images.example.com'), '*.' and a name for every name below it ('*.cdn.example.com', never over a suffix anyone can host under such as '*.co.uk' or '*.github.io'), with a port when not the default, and 'http://' in front to allow plain HTTP ('http://127.0.0.1:4100'); no path, no address range";

function rule_of(entry: unknown): HostRule | null {
	if (typeof entry !== 'string') return null;
	const m = ENTRY_RE.exec(entry);
	if (!m) return null;
	let url: URL;
	try {
		url = new URL(`${(m[1] ?? 'https').toLowerCase()}://${m[3]!}`);
		// oxlint-disable-next-line ogygia/no-silent-failures -- an entry that is no URL host is refused by the caller, with the rule
	} catch {
		return null;
	}
	if (url.pathname !== '/' || url.search || url.hash) return null;
	const host = url.hostname;
	if (
		m[2] &&
		(host.startsWith('[') || IPV4_RE.test(host) || !host.includes('.') || SHARED_SUFFIXES.has(host))
	)
		return null;
	return {
		protocol: url.protocol === 'http:' ? 'http:' : 'https:',
		host,
		below: m[2] !== undefined,
		port: url.port
	};
}

/** Is `entry` a `hosts` entry? */
export function is_host_entry(entry: unknown): boolean {
	return rule_of(entry) !== null;
}

/** The `hosts` entry that lists exactly the host of `url`. */
export function entry_for(url: URL): string {
	return url.protocol === 'http:' ? `http://${url.host}` : url.host;
}

/** One `hosts` entry, read: its scheme, its host, whether it lists the names below the host
 *  (`*.`) rather than the host itself, and its port (`''`: the default). Null when it is none. */
export function host_rule(entry: unknown): Readonly<HostRule> | null {
	return rule_of(entry);
}

/** How a `hosts` list takes a URL: by its host named itself (an IP address or a name, `named`),
 *  only by a `*.` entry (`below`), or not at all (null). */
export type HostMatch = 'named' | 'below' | null;

/** The hosts an app takes images from. */
export class RemoteHosts {
	readonly #rules: readonly HostRule[];

	constructor(entries: readonly string[]) {
		this.#rules = entries.flatMap((e) => {
			const rule = rule_of(e);
			return rule ? [rule] : [];
		});
	}

	/** How the list takes `url`: its scheme, host and port must be listed, and it must carry no
	 *  user or password. */
	match(url: URL): HostMatch {
		if (url.username || url.password) return null;
		const host = url.hostname;
		let found: HostMatch = null;
		for (const r of this.#rules) {
			if (r.protocol !== url.protocol || r.port !== url.port) continue;
			if (!r.below && host === r.host) return 'named';
			if (r.below && host.endsWith(`.${r.host}`)) found = 'below';
		}
		return found;
	}

	/** May an image be fetched from `url`? */
	allows(url: URL): boolean {
		return this.match(url) !== null;
	}
}

const PRIVATE_V4: readonly (readonly [string, number])[] = [
	['0.0.0.0', 8],
	['10.0.0.0', 8],
	['100.64.0.0', 10],
	['127.0.0.0', 8],
	['169.254.0.0', 16],
	['172.16.0.0', 12],
	['192.0.0.0', 24],
	['192.0.2.0', 24],
	['192.88.99.0', 24],
	['192.168.0.0', 16],
	['198.18.0.0', 15],
	['198.51.100.0', 24],
	['203.0.113.0', 24],
	['224.0.0.0', 4],
	['240.0.0.0', 4]
];
const PRIVATE_V6: readonly (readonly [string, number])[] = [
	['::', 96],
	['64:ff9b:1::', 48],
	['100::', 64],
	['2001::', 23],
	['2001:db8::', 32],
	['fc00::', 7],
	['fe80::', 10],
	['fec0::', 10],
	['ff00::', 8]
];

function v4_of(text: string): number | null {
	if (!IPV4_RE.test(text)) return null;
	let n = 0;
	for (const part of text.split('.')) {
		const v = Number(part);
		if (v > 255) return null;
		n = n * 256 + v;
	}
	return n;
}

function v6_of(text: string): bigint | null {
	let s = text.replace(/%.*$/, '');
	const tail = /(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
	if (tail) {
		const v4 = v4_of(tail[1]!);
		if (v4 === null) return null;
		s = `${s.slice(0, s.length - tail[1]!.length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
	}
	const halves = s.split('::');
	if (halves.length > 2) return null;
	const head = halves[0] ? halves[0].split(':') : [];
	const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
	const missing = 8 - head.length - rest.length;
	if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
	let n = 0n;
	for (const g of [...head, ...Array<string>(missing).fill('0'), ...rest]) {
		if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
		n = (n << 16n) | BigInt(parseInt(g, 16));
	}
	return n;
}

function in_v4(n: number, list: readonly (readonly [string, number])[]): boolean {
	return list.some(([base, bits]) => {
		const shift = 32 - bits;
		return Math.floor(n / 2 ** shift) === Math.floor(v4_of(base)! / 2 ** shift);
	});
}

/** Is `address` (an IPv4 or IPv6 address, as a resolver answers it) one no public host has: a
 *  loopback, private, link-local, shared, reserved, documentation or multicast address, or an IPv6
 *  address that carries one of those IPv4 addresses (mapped, NAT64, 6to4)? Anything that does not
 *  read as an address is too. */
export function private_address(address: string): boolean {
	const v4 = v4_of(address);
	if (v4 !== null) return in_v4(v4, PRIVATE_V4);
	const v6 = v6_of(address);
	if (v6 === null) return true;
	const top = (bits: number): bigint => v6 >> BigInt(128 - bits);
	const low32 = Number(v6 & 0xffff_ffffn);
	if (top(96) === 0xffffn || top(96) === 0x64ff9bn << 64n) return in_v4(low32, PRIVATE_V4);
	if (top(16) === 0x2002n) return in_v4(Number((v6 >> 80n) & 0xffff_ffffn), PRIVATE_V4);
	return PRIVATE_V6.some(([base, bits]) => top(bits) === v6_of(base)! >> BigInt(128 - bits));
}
