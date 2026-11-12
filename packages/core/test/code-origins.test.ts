// CODE ORIGINS, the server's half: the runtime's script names the origins island code may load from
// besides the page's own (runtime/code-origins.ts reads them). A plugin adds its own through the
// `codeOrigins` shared hook (federation: its peers'), and a request through its facts
// (`codeOrigins`: a peer fragment's own runtime origin, #856). Written once, at head time
// (head-presence.ts `runtime_first`), so what the render learned lands too. Only http(s) origins,
// each once.
import { describe, it, expect, afterEach } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runtime_bootstrap_tags } from '../src/server/document-tail.ts';
import { runtime_first } from '../src/server/head-presence.ts';
import { code_origins, register_hooks } from '../src/plugin/hooks.ts';
import { facts_of, set_current_request } from '../src/plugin/facts.ts';

const leaves: Array<() => void> = [];
afterEach(() => {
	for (const leave of leaves.splice(0)) leave();
	set_current_request(null);
});

const HEAD = '<head><meta charset="utf-8">';
const tag = runtime_bootstrap_tags('/r.js', []);

describe('the runtime script names the code origins', () => {
	it('as origins, http(s) only, each once', () => {
		const html = runtime_first(HEAD, tag, [
			'https://cdn.example/assets/',
			'javascript:alert(1)',
			'https://peer.example',
			'https://peer.example/again',
			'not a url',
			'"><script>'
		]);
		expect(html).toContain(' data-og-origins="https://cdn.example https://peer.example"');
		expect(html.match(/data-og-origins/g)).toHaveLength(1);
	});

	it('none: no attribute', () => {
		expect(runtime_first(HEAD, tag, [])).not.toContain('data-og-origins');
	});

	it('a runtime script the page emitted gets them too, in place of any it carried', () => {
		const emitted = tag.replace(' src=', ' data-og-origins="https://stale.example" src=');
		const html = runtime_first(HEAD + emitted, null, ['https://peer.example']);
		expect(html).toContain(' data-og-origins="https://peer.example"');
		expect(html).not.toContain('stale.example');
	});

	it('every plugin’s `codeOrigins`, then the request’s own', () => {
		leaves.push(register_hooks({ codeOrigins: () => ['https://peer.example'] }));
		leaves.push(register_hooks({ codeOrigins: () => ['https://other.example:8443/x'] }));
		const request = new Request('https://app.example/');
		set_current_request(() => request);
		facts_of(request).codeOrigins = ['https://cdn.peer.example'];
		expect(code_origins()).toEqual([
			'https://peer.example',
			'https://other.example:8443/x',
			'https://cdn.peer.example'
		]);
	});

	it('outside a request: the plugins’ alone', () => {
		leaves.push(register_hooks({ codeOrigins: () => ['https://peer.example'] }));
		expect(code_origins()).toEqual(['https://peer.example']);
	});
});

describe('one way the runtime asks for island code', () => {
	// an `import()` of a computed specifier, anywhere in the runtime but code-origins.ts `import_code`
	// (which takes only a CodeUrl): a second way in would be a second list of what to check (#981)
	const COMPUTED_IMPORT = /\bimport\((?!\s*(?:\/\*[^]*?\*\/\s*)?['"`)])/g;

	it('is code-origins.ts `import_code`', () => {
		const dir = fileURLToPath(new URL('../src/runtime/', import.meta.url));
		const found: string[] = [];
		for (const file of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
			if (!file.endsWith('.ts') || file === 'code-origins.ts') continue;
			const text = readFileSync(dir + file, 'utf8');
			for (const m of text.matchAll(COMPUTED_IMPORT))
				found.push(`${file}:${text.slice(0, m.index).split('\n').length}`);
		}
		expect(found).toEqual([]);
	});
});
