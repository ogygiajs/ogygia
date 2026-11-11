// A region capability is signed through capability() (@ogygia/machine), deterministic: its message
// names the capability, its version and its audience (the app's islands endpoint), a page's region
// links stay byte-identical between renders in one expiry window, and URLs signed before it (v1, v2)
// still verify, so pages cached before an upgrade keep their holes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capability } from '@ogygia/machine';

vi.mock('virtual:ogygia/secret', () => ({
	buildKey: 'test-secret-0123456789',
	buildHadSecret: false
}));
vi.mock('virtual:ogygia/session-cookie', () => ({ sessionCookie: null }));
vi.mock('virtual:ogygia/region-ttl', () => ({ regionTtl: 3600, renewWindow: 691200 }));
vi.mock('virtual:ogygia/server-manifest', () => ({
	island_url: {},
	island_render: { abcdef012345: 'c0ffee0c0ffe' }
}));
vi.mock('virtual:ogygia/sign', async () => await import('../src/server/hmac.ts'));

const hmac = await import('../src/server/hmac.ts');
const { mintServerIsland } = await import('../src/server/region-endpoint.ts');
const { signing_key } = await import('../src/server/signing-key.ts');
const { configure_islands_endpoint } = await import('../src/server/endpoint.ts');

// (a moment one minute into an expiry window: the hour TTL's windows are half an hour long)
const WINDOW_START = 1_800 * 1_000_000;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(WINDOW_START * 1000 + 60_000);
});
afterEach(() => {
	vi.useRealTimers();
	configure_islands_endpoint(undefined);
});

const params = (url: string) => new URL(url, 'https://a.test').searchParams;
const claim_of = (p: URLSearchParams, session = '') => ({
	id: p.get('id') ?? '',
	payload: p.get('props') ?? '',
	session,
	ttl: p.get('ttl') ?? '',
	render: p.get('r') ?? ''
});

describe('region capability, signed through capability()', () => {
	it('two renders in one expiry window mint the same URL, marked v3', () => {
		const a = mintServerIsland('abcdef012345', { n: 1 });
		vi.advanceTimersByTime(20 * 60_000);
		expect(mintServerIsland('abcdef012345', { n: 1 })).toBe(a);
		expect(a).toMatch(/&exp=\d+&v=3&sig=[0-9a-f]{64}&k=[^&]+$/);
	});

	it('the endpoint verifies a v3 capability for the endpoint it was minted for, and only there', () => {
		const p = params(mintServerIsland('abcdef012345', { n: 1 }));
		const { secret } = signing_key();
		const sig = p.get('sig')!;
		expect(hmac.region_verify(secret, '/__ogygia__', '3', p.get('exp')!, claim_of(p), sig)).toBe(
			true
		);
		expect(hmac.region_verify(secret, '/elsewhere', '3', p.get('exp')!, claim_of(p), sig)).toBe(
			false
		);
		expect(
			hmac.region_verify(secret, '/__ogygia__', '3', p.get('exp')!, claim_of(p, 'sess'), sig)
		).toBe(false);
	});

	it('a v3 signature never verifies as v1 or v2 (its version marker stripped), nor the other way', () => {
		const p = params(mintServerIsland('abcdef012345', { n: 1 }));
		const { secret } = signing_key();
		const c = claim_of(p);
		expect(hmac.region_verify(secret, '/__ogygia__', '', p.get('exp')!, c, p.get('sig')!)).toBe(
			false
		);
		const v2 = hmac.sign(
			secret,
			hmac.region_mac_message(c.id, p.get('exp')!, c.payload, '', '', c.render)
		);
		expect(hmac.region_verify(secret, '/__ogygia__', '', p.get('exp')!, c, v2)).toBe(true);
		expect(hmac.region_verify(secret, '/__ogygia__', '3', p.get('exp')!, c, v2)).toBe(false);
		expect(hmac.region_verify(secret, '/__ogygia__', '4', p.get('exp')!, c, p.get('sig')!)).toBe(
			false
		);
	});

	it('URLs signed before v3 (v1, without a render identity) still verify', () => {
		const { secret } = signing_key();
		const exp = String(WINDOW_START + 3600);
		const c = { id: 'abcdef012345', payload: 'W3t9XQ', session: '', ttl: '', render: '' };
		const v1 = hmac.sign(secret, hmac.region_mac_message(c.id, exp, c.payload));
		expect(hmac.region_verify(secret, '/__ogygia__', '', exp, c, v1)).toBe(true);
	});

	it('a v3 capability claiming more than the longest lifetime the app mints is refused', () => {
		const { secret } = signing_key();
		const c = { id: 'abcdef012345', payload: 'W3t9XQ', session: '', ttl: '', render: '' };
		const key = hmac.derive_mac_key(secret);
		const forged_lifetime = capability({
			name: 'region',
			version: 3,
			nonce: false,
			ttl: { max: Number.MAX_SAFE_INTEGER },
			signer: {
				sign: (m) => hmac.Hmac.sha256(key, m),
				verify: () => false
			}
		});
		const far = Math.floor(Date.now() / 1000) + 20 * 365 * 24 * 3600;
		const token = forged_lifetime.mintUntil(
			'/__ogygia__',
			[c.id, c.payload, '', '', ''],
			far * 1000
		);
		const sig = token.slice(token.lastIndexOf('.') + 1);
		expect(hmac.region_verify(secret, '/__ogygia__', '3', String(far), c, sig)).toBe(false);
	});

	it('an expired v3 capability verifies only when it may be late (a renewal), within that time', () => {
		const p = params(mintServerIsland('abcdef012345', { n: 1 }));
		const { secret } = signing_key();
		const exp = Number(p.get('exp'));
		vi.setSystemTime((exp + 3600) * 1000);
		const args = ['/__ogygia__', '3', p.get('exp')!, claim_of(p), p.get('sig')!] as const;
		expect(hmac.region_verify(secret, ...args)).toBe(false);
		expect(hmac.region_verify(secret, ...args, 7200)).toBe(true);
		expect(hmac.region_verify(secret, ...args, 600)).toBe(false);
	});
});
