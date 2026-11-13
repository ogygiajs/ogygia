const TAG = '\0';
const SHARED = `${TAG}s`;
const ESCAPED = `${TAG}k`;

/** The name a context key crosses into regions under (a string as itself, a `Symbol.for` key
 *  tagged), or null when no browser can rebuild it (a one-off `Symbol()`). */
export function key_name(key: unknown): string | null {
	if (typeof key === 'string') return key.startsWith(TAG) ? ESCAPED + key : key;
	if (typeof key !== 'symbol') return null;
	const shared = Symbol.keyFor(key);
	return shared === undefined ? null : SHARED + shared;
}

/** The key a crossed name stands for: the string, or the shared symbol rebuilt by its name. */
export function key_of(name: string): string | symbol {
	if (!name.startsWith(TAG)) return name;
	return name.startsWith(SHARED)
		? Symbol.for(name.slice(SHARED.length))
		: name.slice(ESCAPED.length);
}

/** The key as an app author wrote it, for a message. */
export function key_label(key: unknown): string {
	if (typeof key === 'string') return `'${key}'`;
	if (typeof key === 'symbol') {
		const shared = Symbol.keyFor(key);
		return shared === undefined ? String(key) : `Symbol.for('${shared}')`;
	}
	return String(key);
}
