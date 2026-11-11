/**
 * THE ATTACK-SURFACE MAP, made from the code: every place in a package's `src/` that reads what a
 * request carries, decodes text it was handed, writes HTML into a page, handles a secret or a key,
 * or names a route ogygia answers. `internal/notes/ATTACK-SURFACE.md` is its output; the test beside
 * this file fails when the code and the map differ, so a new sink, decoder, request read or secret
 * use shows up in the pull request's diff of the map, where a reviewer sees it.
 *
 *   node internal/checks/attack-surface.ts           writes the map
 *   node internal/checks/attack-surface.ts --check   exits 1 when the map is out of date
 *
 * An entry is a file, the function it sits in, and what it does there, with a count (no line
 * numbers, so an unrelated edit above it does not move the map).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type Kind = 'request' | 'decode' | 'html' | 'secret' | 'route';

/** What each kind means, as the map's section headings say it. */
export const KINDS: Record<Kind, string> = {
	request: 'Request inputs: headers, query, cookies and bodies read from a request',
	decode: 'Decoders: text turned into values (JSON, devalue, base64, URI escapes)',
	html: 'HTML sinks: markup written into a page as markup',
	secret: 'Secrets and keys: environment secrets, MACs, key derivation, signatures',
	route: 'Routes: paths ogygia answers on its own'
};

/** Each kind's patterns, and the name an entry gets from a match. */
const PATTERNS: Record<Kind, Array<[RegExp, (m: RegExpExecArray) => string]>> = {
	request: [
		[/\bheaders\.get\(\s*(['"`][^'"`]*['"`]|[\w.]+)/g, (m) => `headers.get(${m[1]})`],
		[
			/\bsearchParams\.(?:get|getAll|has)\(\s*(['"`][^'"`]*['"`]|[\w.]+)/g,
			(m) => `searchParams(${m[1]})`
		],
		[/\bcookies\.get\(\s*(['"`][^'"`]*['"`]|[\w.]+)/g, (m) => `cookies.get(${m[1]})`],
		[/\brequest\.(json|text|arrayBuffer|formData|blob)\(/g, (m) => `request.${m[1]}()`]
	],
	decode: [
		[/\bJSON\.parse\(/g, () => 'JSON.parse'],
		[/\bunflatten\(/g, () => 'devalue unflatten'],
		[/\bparse\([^()]*,\s*\(?[\w.]*revivers/gi, () => 'devalue parse'],
		[/\batob\(/g, () => 'atob'],
		[/\bBuffer\.from\([^)]*['"]base64(url)?['"]\)/g, (m) => `Buffer.from base64${m[1] ?? ''}`],
		[/\bdecodeURIComponent\(/g, () => 'decodeURIComponent']
	],
	html: [
		[/\.(innerHTML|outerHTML)\s*=(?!=)/g, (m) => `${m[1]} =`],
		[
			/\b(insertAdjacentHTML|createContextualFragment|setHTMLUnsafe|parseHTMLUnsafe)\(/g,
			(m) => m[1]!
		],
		[/\bdocument\.write(ln)?\(/g, (m) => `document.write${m[1] ?? ''}`],
		[/\bnew DOMParser\(/g, () => 'DOMParser'],
		[/\{@html\b/g, () => '{@html}']
	],
	secret: [
		[/\b(?:process\.)?env\.([A-Z0-9_]*(?:SECRET|KEY|TOKEN)[A-Z0-9_]*)/g, (m) => `env ${m[1]}`],
		[
			/\b(createHmac|hkdfSync|hkdf|timingSafeEqual|createPrivateKey|createPublicKey|generateKeyPairSync)\(/g,
			(m) => m[1]!
		],
		[/\bcrypto\.subtle\.(sign|verify|importKey|deriveKey|deriveBits)\(/g, (m) => `subtle.${m[1]}`]
	],
	route: [[/['"`](\/(?:og\/|__ogygia)[A-Za-z0-9_/.-]*)['"`]/g, (m) => m[1]!]]
};

/** A line that starts a named function, method or const: the name later lines sit in. */
const OWNER =
	/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([\w$]+)|^\s*(?:export\s+)?(?:const|let)\s+([\w$]+)\s*[=:]|^\s*(?:(?:public|private|protected|static|readonly|async|override|get|set)\s+)*(#?[\w$]+)\s*(?:<[^>]*>)?\([^;]*\)\s*(?::[^{;]+)?\{\s*$/;
const NOT_OWNER = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function']);

export interface Entry {
	kind: Kind;
	file: string;
	where: string;
	what: string;
	count: number;
}

/** Every entry in one file's text. */
export function scan_file(file: string, text: string): Entry[] {
	const found = new Map<string, Entry>();
	// (the module-level function or const above, or the method in a class body, until the depth
	// goes back to 0: a local inside it is not an owner)
	let owner = '(module)';
	let depth = 0;
	for (const line of text.split('\n')) {
		const code = line.replace(/^\s*(\/\/|\*|\/\*).*$/, '');
		const m = OWNER.exec(code);
		const name = m && (m[1] ?? m[2] ?? m[3]);
		if (name && !NOT_OWNER.has(name) && (depth === 0 || (depth === 1 && !m![2]))) owner = name;
		for (const kind of Object.keys(PATTERNS) as Kind[]) {
			for (const [re, what_of] of PATTERNS[kind]) {
				re.lastIndex = 0;
				for (let hit = re.exec(code); hit; hit = re.exec(code)) {
					const what = what_of(hit);
					const key = `${kind}\0${owner}\0${what}`;
					const e = found.get(key);
					if (e) e.count++;
					else found.set(key, { kind, file, where: owner, what, count: 1 });
				}
			}
		}
		for (const ch of code) depth += ch === '{' ? 1 : ch === '}' ? -1 : 0;
		if (depth <= 0) owner = '(module)';
	}
	return [...found.values()];
}

/** The map, as markdown. */
export function render(entries: Entry[]): string {
	const out = [
		'# Attack surface',
		'',
		'Generated by `node internal/checks/attack-surface.ts` from every package `src/` file. Do not',
		'edit by hand: run it, and review what changed. A new entry is a new place an attacker can reach;',
		'its pull request says why it is safe (or which INVARIANTS.md section covers it).',
		''
	];
	for (const kind of Object.keys(KINDS) as Kind[]) {
		const rows = entries
			.filter((e) => e.kind === kind)
			.sort(
				(a, b) =>
					a.file.localeCompare(b.file) ||
					a.where.localeCompare(b.where) ||
					a.what.localeCompare(b.what)
			);
		out.push(`## ${KINDS[kind]}`, '', `${rows.length} entries.`, '');
		if (!rows.length) continue;
		out.push('| file | in | what | n |', '| --- | --- | --- | --- |');
		for (const r of rows)
			out.push(
				`| \`${r.file}\` | \`${r.where}\` | \`${r.what.replaceAll('|', '\\|')}\` | ${r.count} |`
			);
		out.push('');
	}
	return out.join('\n');
}

const ROOT = path.resolve(import.meta.dirname, '../..');
export const MAP_FILE = 'internal/notes/ATTACK-SURFACE.md';

/** The map the code makes now. */
export function current_map(root = ROOT): string {
	const files = execFileSync('git', ['ls-files', ':(glob)packages/*/src/**'], {
		cwd: root,
		encoding: 'utf8'
	})
		.split('\n')
		.filter((f) => /\.(ts|js|svelte)$/.test(f) && !f.endsWith('.d.ts'));
	return render(files.flatMap((f) => scan_file(f, readFileSync(path.join(root, f), 'utf8'))));
}

if (import.meta.main) {
	const map = current_map();
	const file = path.join(ROOT, MAP_FILE);
	if (process.argv.includes('--check')) {
		if (readFileSync(file, 'utf8') !== map) {
			console.error(
				`${MAP_FILE} is out of date: run node internal/checks/attack-surface.ts and review the diff.`
			);
			process.exit(1);
		}
	} else writeFileSync(file, map);
}
