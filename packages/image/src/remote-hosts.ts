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
 * @packageDocumentation
 */

interface HostRule {
	protocol: 'https:' | 'http:';
	host: string;
	below: boolean;
	port: string;
}

const ENTRY_RE = /^(?:(https?):\/\/)?(\*\.)?([^/?#@\\\s*%]+)$/i;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** What a `hosts` entry must be, for a message. */
export const HOSTS_RULE =
	"a non-empty list of hosts, each a name ('images.example.com'), '*.' and a name for every name below it ('*.cdn.example.com'), with a port when not the default, and 'http://' in front to allow plain HTTP ('http://127.0.0.1:4100'); no path, no address range";

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
	if (m[2] && (host.startsWith('[') || IPV4_RE.test(host) || !host.includes('.'))) return null;
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

/** The hosts an app takes images from. */
export class RemoteHosts {
	readonly #rules: readonly HostRule[];

	constructor(entries: readonly string[]) {
		this.#rules = entries.flatMap((e) => {
			const rule = rule_of(e);
			return rule ? [rule] : [];
		});
	}

	/** May an image be fetched from `url`? Its scheme, host and port must be listed, and it must
	 *  carry no user or password. */
	allows(url: URL): boolean {
		if (url.username || url.password) return false;
		const host = url.hostname;
		return this.#rules.some(
			(r) =>
				r.protocol === url.protocol &&
				r.port === url.port &&
				(r.below ? host.endsWith(`.${r.host}`) : host === r.host)
		);
	}
}
