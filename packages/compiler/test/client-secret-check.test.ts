// SECRET-SPLIT ON THE FINISHED CLIENT BUNDLE (compiler/link/build-output.ts `refuse_client_secrets`,
// run by the plugin's client writeBundle). A browser must never be able to sign region addresses: a
// client chunk or asset that holds a signing secret, or a chunk that holds a signing module, fails
// the build with `secret_in_client_chunk`.
import { describe, expect, it } from 'vitest';
import { refuse_client_secrets } from '../src/compiler/link/build-output.ts';

const SECRET = 'a-long-random-signing-secret-0123456789';
const chunk = (code: string, moduleIds: string[] = ['/app/src/lib/x.ts']) => ({
	type: 'chunk',
	fileName: '_app/immutable/chunks/x.js',
	code,
	moduleIds
});

describe('the client bundle holds no signing secret', () => {
	it('a chunk holding the secret fails the build', () => {
		expect(() => refuse_client_secrets({ a: chunk(`const k = "${SECRET}";`) }, [SECRET])).toThrow(
			/secret_in_client_chunk/
		);
	});

	it('an asset holding the secret fails the build', () => {
		const asset = { type: 'asset', fileName: 'x.json', source: `{"k":"${SECRET}"}` };
		expect(() => refuse_client_secrets({ a: asset }, [SECRET])).toThrow(/secret_in_client_chunk/);
	});

	it('a chunk holding a signing module fails the build', () => {
		for (const id of [
			'/repo/packages/core/src/server/hmac.ts',
			'/repo/packages/core/src/server/signing-key.ts',
			'/app/node_modules/@ogygia/core/dist/server/hmac.js'
		])
			expect(() => refuse_client_secrets({ a: chunk('x', [id]) }, [SECRET])).toThrow(
				/secret_in_client_chunk/
			);
	});

	it('a clean bundle passes; a missing or short secret is not looked for', () => {
		expect(() => refuse_client_secrets({ a: chunk('const k = "";') }, [SECRET, ''])).not.toThrow();
		expect(() => refuse_client_secrets({ a: chunk('const n = 1;') }, ['1'])).not.toThrow();
	});
});
