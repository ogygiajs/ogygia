import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sign, verify } from '../../core/src/server/hmac.ts';
import { encode_region_props } from '../../core/src/server/region-props.ts';
import { MAX_REGION_PROPS_LEN } from '../../core/src/server/endpoint.ts';
import { html_has_kit_bootstrap } from '../../core/src/server/html-scan.ts';
import { RuntimeSession } from '../../core/src/runtime/session.ts';
import { islandId } from '../src/region/transform.ts';

describe('verify', () => {
	const secret = 'test-secret-key-16b';

	it('rejects non-hex signatures before compare', () => {
		const msg = 'a signed message';
		expect(verify(secret, msg, 'not-hex')).toBe(false);
		expect(verify(secret, msg, 'g'.repeat(64))).toBe(false);
		expect(verify(secret, msg, sign(secret, msg).toUpperCase())).toBe(false);
	});
});

describe('encode_region_props (SWR / defer mint bound)', () => {
	it('encodes plain props', () => {
		const p = encode_region_props({ n: 1 });
		expect(p).toBeTruthy();
		expect(p!.length).toBeGreaterThan(0);
		expect(p!.length).toBeLessThanOrEqual(MAX_REGION_PROPS_LEN);
	});

	it('freezes a bare function prop to a static region snippet (the boundary law) and encodes', () => {
		// Under the region-snippet boundary law a bare snippet/function FREEZES to server HTML instead
		// of failing serialization — a snippet prop on a minted region is legal now.
		expect(encode_region_props({ fn: () => 1 })).not.toBeNull();
	});

	it('returns null for genuinely non-serializable props (symbols)', () => {
		expect(encode_region_props({ s: Symbol('nope') })).toBeNull();
	});

	it('returns null when b64 payload exceeds MAX_REGION_PROPS_LEN', () => {
		// A large string forces the b64url blob over the handle's length gate.
		const big = 'x'.repeat(MAX_REGION_PROPS_LEN);
		expect(encode_region_props({ big })).toBeNull();
	});
});

describe('RuntimeSession lake_cache (SPA reset)', () => {
	it('reset clears lake_cache and initialized_lakes', () => {
		const s = new RuntimeSession();
		s.lake_cache.set('a', {
			frag: {} as Node,
			endpoint: '/x',
			when: 'load',
			cachedAt: Date.now(),
			maxAgeMs: 0
		});
		s.initialized_lakes.add('a');
		s.reset();
		expect(s.lake_cache.size).toBe(0);
		expect(s.initialized_lakes.size).toBe(0);
	});

	it('SWR refresh replaces an entry without growing the map', () => {
		const s = new RuntimeSession();
		const frag1 = {} as Node;
		const frag2 = {} as Node;
		const entry = (frag: Node) => ({
			frag,
			endpoint: '/e1',
			when: 'load',
			cachedAt: Date.now(),
			maxAgeMs: 0
		});
		s.lake_cache.set('lake-a', entry(frag1));
		s.lake_cache.set('lake-a', entry(frag2));
		expect(s.lake_cache.size).toBe(1);
		expect(s.lake_cache.get('lake-a')!.frag).toBe(frag2);
	});
});

describe('islandId salt (P1-ID)', () => {
	it('matches unsalted legacy when salt is empty', () => {
		const legacy = createHash('md5')
			.update('src/routes/+page.svelte::0')
			.digest('hex')
			.slice(0, 12);
		expect(islandId('src/routes/+page.svelte', 0)).toBe(legacy);
	});

	it('diverges when salt is set', () => {
		expect(islandId('src/routes/+page.svelte', 0, 'secret')).not.toBe(
			islandId('src/routes/+page.svelte', 0)
		);
	});
});

describe('kit bootstrap detection', () => {
	it('ignores __sveltekit_ reflected inside ogygia side-channels', () => {
		const html = `<html><body>
<script type="application/ogygia-page" data-ogygia-page>{"url":"http://x/?q=__sveltekit_x="}</script>
<script type="application/ogygia-props" data-ogygia-props>[]</script>
<script type="application/ogygia-remote">{"q":{}}</script>
</body></html>`;
		expect(html_has_kit_bootstrap(html)).toBe(false);
	});

	it('detects a real Kit assignment bootstrap', () => {
		const html = `<html><body>
<script>var __sveltekit_abc = { base: "/" };</script>
</body></html>`;
		expect(html_has_kit_bootstrap(html)).toBe(true);
	});

	it('strips type=application/ogygia-* even without data attrs', () => {
		// Defense in depth: MIME type alone identifies the side-channel.
		const html = `<html><body>
<script type="application/ogygia-page">{"url":"http://x/?q=__sveltekit_x="}</script>
</body></html>`;
		expect(html_has_kit_bootstrap(html)).toBe(false);
	});
});
