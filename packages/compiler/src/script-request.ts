const NON_SCRIPT_FLAGS: ReadonlySet<string> = new Set([
	'raw',
	'url',
	'inline',
	'worker',
	'sharedworker',
	'direct'
]);
const SCRIPT_LANGS: ReadonlySet<string> = new Set([
	'js',
	'ts',
	'jsx',
	'tsx',
	'mjs',
	'cjs',
	'mts',
	'cts'
]);

export function is_script_request(id: string): boolean {
	const q = id.indexOf('?');
	if (q === -1) return true;
	const end = id.indexOf('#', q);
	for (const part of id.slice(q + 1, end === -1 ? undefined : end).split('&')) {
		const eq = part.indexOf('=');
		const key = eq === -1 ? part : part.slice(0, eq);
		if (NON_SCRIPT_FLAGS.has(key)) return false;
		if (key === 'type' && part.slice(eq + 1) !== 'script') return false;
		if (key.startsWith('lang.') && !SCRIPT_LANGS.has(key.slice(5))) return false;
	}
	return true;
}
