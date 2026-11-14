/**
 * A rendered output with every derived hash swapped for a stable placeholder, numbered by first
 * appearance: a 64-bit digest (an island's fingerprint, a hole's or a lake's identity, a sidecar's id)
 * → `<fpN>`, a snippet id's digest → `<snipN>`, a Svelte hydration comment's hash and a slot id's
 * entry tag → `<idN>`. The same hash always gets the same placeholder, different hashes different
 * numbers, and every other byte stays as it was. So a table snapshot shows what changed in the output
 * itself; the real hash values are pinned once, in region-output.test.ts › "the real hashes".
 */
export function normalize_hashes(text: string): string {
	return normalized_with_hashes(text).text;
}

/** {@link normalize_hashes}, and what each placeholder stands for: `<fp1>=7dd6306730e68332`, one per
 *  placeholder in the order they were numbered. */
export function normalized_with_hashes(text: string): { text: string; hashes: string[] } {
	const names = new Map<string, string>();
	const counts = new Map<string, number>();
	const name = (kind: string, raw: string): string => {
		const key = `${kind}:${raw}`;
		let found = names.get(key);
		if (!found) {
			const n = (counts.get(kind) ?? 0) + 1;
			counts.set(kind, n);
			names.set(key, (found = `<${kind}${n}>`));
		}
		return found;
	};
	const out = text.replace(HASHES, (all, before, prefix, tag, n, comment, mode, snip, fp) =>
		tag !== undefined
			? `${before}og${prefix}${name('id', tag)}-${n}`
			: comment !== undefined
				? `<!--${name('id', comment)}-->`
				: snip !== undefined
					? `"${mode}${name('snip', snip)}"`
					: fp !== undefined
						? name('fp', fp)
						: all
	);
	return {
		text: out,
		hashes: [...names].map(
			([key, placeholder]) => `${placeholder}=${key.slice(key.indexOf(':') + 1)}`
		)
	};
}

/** One pass, so placeholders number in the order the hashes appear: a slot id's entry tag, a
 *  hydration comment's hash, a snippet id, a bare 64-bit digest. */
const HASHES =
	/(data-og-slot=\\*"|slot:)og((?:[0-9a-z]{6}-)?)([0-9a-z]+)-([0-9a-z]+)|<!--([0-9a-z]+)-->|"([sl])([0-9a-f]{16})"|(?<![0-9a-f])([0-9a-f]{16})(?![0-9a-f])/g;
