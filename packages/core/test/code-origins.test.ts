// CODE ORIGINS, the server's half: the runtime's script names the origins island code may load from
// besides the page's own (runtime/code-origins.ts reads them). A plugin adds its own through the
// `codeOrigins` shared hook (federation: its peers'). Only http(s) origins, each once.
import { describe, it, expect, afterEach } from 'vitest';
import { runtime_bootstrap_tags } from '../src/server/document-tail.ts';
import { runtime_bootstrap } from '../src/server/entry-location.ts';
import { code_origins, register_hooks } from '../src/plugin/hooks.ts';

const leaves: Array<() => void> = [];
afterEach(() => {
	for (const leave of leaves.splice(0)) leave();
});

describe('the runtime script names the code origins', () => {
	it('as origins, http(s) only, each once', () => {
		const html = runtime_bootstrap_tags('/r.js', [], null, [
			'https://cdn.example/assets/',
			'javascript:alert(1)',
			'https://peer.example',
			'https://peer.example/again',
			'not a url',
			'"><script>'
		]);
		expect(html).toContain(' data-og-origins="https://cdn.example https://peer.example"');
	});

	it('none: no attribute', () => {
		expect(runtime_bootstrap_tags('/r.js', [], null, [])).not.toContain('data-og-origins');
	});

	it('every plugin’s `codeOrigins` lands on the runtime’s script', () => {
		leaves.push(register_hooks({ codeOrigins: () => ['https://peer.example'] }));
		leaves.push(register_hooks({ codeOrigins: () => ['https://other.example:8443/x'] }));
		expect(code_origins()).toEqual(['https://peer.example', 'https://other.example:8443/x']);
		expect(runtime_bootstrap()).toContain(
			' data-og-origins="https://peer.example https://other.example:8443"'
		);
	});
});
