import { describe, expect, it } from 'vitest';
import { derive_build_key, derive_id_salt } from '../src/server/hmac.ts';

const SECRET = 'build-key-secret-0123456789abcdef';

describe("a build's key under the app's secret", () => {
	it('is the same for every build of one secret: two builds write the same server bundle', () => {
		expect(derive_build_key(SECRET, 'v1')).toBe(derive_build_key(SECRET, 'v1'));
		expect(derive_build_key(SECRET, 'v1')).toMatch(/^[0-9a-f]{64}$/);
	});

	it('changes with the secret', () => {
		expect(derive_build_key(`${SECRET}!`, 'v1')).not.toBe(derive_build_key(SECRET, 'v1'));
	});

	it('is not the secret, nor the id salt the client sees, nor a part of either', () => {
		const key = derive_build_key(SECRET, 'v1');
		const salt = derive_id_salt(SECRET);
		expect(key).not.toContain(SECRET);
		expect(key).not.toContain(Buffer.from(SECRET).toString('hex'));
		expect(key).not.toContain(salt);
	});

	it("changes with the app's version, so a key leaked from one version's bundle is no use to a build of another", () => {
		expect(derive_build_key(SECRET, 'v2')).not.toBe(derive_build_key(SECRET, 'v1'));
		expect(derive_build_key(SECRET, 'v1')).toBe(derive_build_key(SECRET, 'v1'));
	});

	it('is refused for a blank secret, so no build signs with a key anyone can work out', () => {
		for (const blank of ['', ' ', '\t\n ']) {
			expect(() => derive_build_key(blank, 'v1'), JSON.stringify(blank)).toThrow(
				expect.objectContaining({ code: 'build_key_blank_secret' })
			);
		}
	});
});
