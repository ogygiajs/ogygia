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

	// (a bundler inlines a secret as a string literal, escaped: a raw search misses it, #1044)
	describe('a secret the bundler wrote escaped still fails the build', () => {
		const HARD = [
			'pa"ss\\word-0123456789',
			"it's-a-signing-secret-0123",
			'two\nlines-signing-secret-01',
			'tab\there-signing-secret-012',
			'sl/ash</script>-secret-0123',
			'café-signing-secret-0123456',
			'emoji-\u{1F511}-signing-secret-0123'
		];
		const json = (s: string) => JSON.stringify(s);
		const single = (s: string) =>
			`'${JSON.stringify(s).slice(1, -1).replaceAll('\\"', '"').replaceAll("'", "\\'")}'`;
		const ascii = (s: string) =>
			JSON.stringify(s).replace(/[^\x20-\x7e]/gu, (c) => `\\u{${c.codePointAt(0)!.toString(16)}}`);
		const latin = (s: string) =>
			JSON.stringify(s).replace(/[\x80-\xff]/g, (c) => `\\x${c.charCodeAt(0).toString(16)}`);
		const solidus = (s: string) => JSON.stringify(s).replaceAll('/', '\\/');
		for (const secret of HARD)
			for (const [form, write] of Object.entries({ json, single, ascii, latin, solidus })) {
				it(`${JSON.stringify(secret)}, written ${form}`, () => {
					expect(() =>
						refuse_client_secrets({ a: chunk(`const k = ${write(secret)};`) }, [secret])
					).toThrow(/secret_in_client_chunk/);
					const asset = { type: 'asset', fileName: 'x.json', source: `{"k":${write(secret)}}` };
					expect(() => refuse_client_secrets({ a: asset }, [secret])).toThrow(
						/secret_in_client_chunk/
					);
				});
			}
	});

	it('a clean bundle passes; a missing or short secret is not looked for', () => {
		expect(() => refuse_client_secrets({ a: chunk('const k = "";') }, [SECRET, ''])).not.toThrow();
		expect(() => refuse_client_secrets({ a: chunk('const n = 1;') }, ['1'])).not.toThrow();
	});
});
