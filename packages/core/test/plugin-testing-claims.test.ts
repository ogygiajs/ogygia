// What the plugin test harness (`ogygia/plugin/testing`) gives a plugin's app, against the source (#512).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startPlugin } from '../src/plugin/testing.ts';

const HOUR = 3600;
const DAY = 24 * HOUR;
const message = (exp: string) => `hole:${exp}`;

/** A capability URL minted now by a started plugin, and the plugin's app. */
function minted() {
	const { app } = startPlugin({});
	const { exp, sig } = app.capability.mint(message);
	return { app, exp: Number(exp), url: new URL(`http://x/hole?exp=${exp}&sig=${sig}`) };
}

afterEach(() => {
	vi.useRealTimers();
});

describe('plugin test harness claims', () => {
	it('signs with a real HMAC: a signature verifies its own message only', () => {
		const { app } = startPlugin({});
		const sig = app.sign('a');
		expect(app.verify('a', sig)).toBe(true);
		expect(app.verify('b', sig)).toBe(false);
		expect(app.verify('a', `${sig.slice(0, -1)}${sig.endsWith('A') ? 'B' : 'A'}`)).toBe(false);
		expect(app.sign('b')).not.toBe(sig);
	});

	it('mints a capability with the default hole ttl of an hour', () => {
		const before = Math.floor(Date.now() / 1000);
		const { exp } = minted();
		const after = Math.floor(Date.now() / 1000);
		expect(exp).toBeGreaterThan(before + HOUR / 2);
		expect(exp).toBeLessThanOrEqual(after + HOUR);
	});

	it('renews an expired capability up to the default maxPageAge of eight days, not past it', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const { app, url, exp } = minted();
		const renew = new URL(url);
		renew.searchParams.set('renew', '1');

		vi.setSystemTime((exp + 7 * DAY) * 1000);
		const kept = app.capability.open(renew, message);
		expect(kept.ok).toBe(true);
		expect(kept.ok && kept.headers['x-ogygia-capability']).toMatch(/^\/hole\?exp=\d+&sig=/);

		vi.setSystemTime((exp + 9 * DAY) * 1000);
		const late = app.capability.open(renew, message);
		expect(late.ok).toBe(false);
		expect(!late.ok && late.response.headers.get('x-ogygia-deny')).toBe('renew-window');
	});

	it('refuses as the handle does: a 403 that names why in x-ogygia-deny', () => {
		const { app, url } = minted();
		const forged = new URL(url);
		forged.searchParams.set('sig', 'forged');
		const refused = app.capability.open(forged, message);
		expect(refused.ok).toBe(false);
		if (refused.ok) return;
		expect(refused.response.status).toBe(403);
		expect(refused.response.headers.get('x-ogygia-deny')).toBe('sig');
		expect(app.capability.open(url, message).ok).toBe(true);
	});
});
