// THE SIGNING KEY (server/signing-key.ts): decided at first use, not at module eval — the field host
// (an adapter loading its `.env` after the server's modules) signed with the build's random key while
// the build itself had OGYGIA_SECRET, and the pages' holes 403'd on the other backend behind the same
// CDN. Its fingerprint rides every capability (`&k=`) so a refusal can name the split.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const build = vi.hoisted(() => ({ build_key: 'build-random-key', build_had_secret: false }));
vi.mock('ogygia:server/secret', () => build);
vi.mock('ogygia:server/sign', () => ({
	sign: (k: string, m: string) => Buffer.from(`${k}:${m}`).toString('base64url'),
	region_mac_message: (...parts: unknown[]) => parts.join('|')
}));

const { signing_key, key_fingerprint, reset_signing_key, configure_signing_secret } =
	await import('../src/server/signing-key.ts');

const WARNED = Symbol.for('ogygia.build-key-warned');
/** Where a production server's `secret_conflict` link says the first key came from. */
const conflict_from = (logged: unknown): string | null =>
	new URL(String((logged as Error).message ?? logged).replace('[ogygia] ', '')).searchParams.get(
		'from'
	);
const g = globalThis as Record<symbol, unknown>;

beforeEach(() => {
	reset_signing_key();
	delete g[WARNED];
	build.build_had_secret = false;
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

describe('the signing key', () => {
	it('is read at first use: an env filled after the module loaded still counts', () => {
		vi.stubEnv('OGYGIA_SECRET', 'filled-late-by-the-host');
		const key = signing_key();
		expect(key.secret).toBe('filled-late-by-the-host');
		expect(key.stable).toBe(true);
	});

	it('falls back to the build key without a runtime OGYGIA_SECRET', () => {
		vi.stubEnv('OGYGIA_SECRET', '');
		const key = signing_key();
		expect(key.secret).toBe('build-random-key');
		expect(key.stable).toBe(false);
	});

	it('names its key by a fingerprint: 8 chars, one per key, the same on every instance', () => {
		vi.stubEnv('OGYGIA_SECRET', 'shared-secret');
		const fp = signing_key().fp;
		expect(fp).toHaveLength(8);
		expect(fp).toBe(key_fingerprint('shared-secret'));
		expect(key_fingerprint('another-secret')).not.toBe(fp);
	});

	it('a server whose build had OGYGIA_SECRET but whose runtime has none says so, once', () => {
		vi.stubEnv('DEV', false);
		vi.stubEnv('OGYGIA_SECRET', '');
		build.build_had_secret = true;
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		signing_key();
		reset_signing_key();
		signing_key();
		expect(error).toHaveBeenCalledTimes(1);
		// (a production server prints the code's link alone: messages/server.ts)
		expect(String(error.mock.calls[0][0])).toContain('ogygiajs.dev/e/secret_missing_at_runtime');
	});

	it('a production server with no OGYGIA_SECRET anywhere warns, once', () => {
		vi.stubEnv('DEV', false);
		vi.stubEnv('OGYGIA_SECRET', '');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		signing_key();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0][0])).toContain('ogygiajs.dev/e/secret_missing');
	});

	it('an env key is silent', () => {
		vi.stubEnv('DEV', false);
		vi.stubEnv('OGYGIA_SECRET', 'a-real-secret');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		signing_key();
		expect(warn).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});
});

// `handle({ secret })`: a host whose server never sees its runtime env signed every build with its own
// random key, so a page a CDN held across a deploy had its holes refused at renewal (foreign-key)
// until a purge.
describe('handle({ secret })', () => {
	it('wins over OGYGIA_SECRET and the build key, and is stable', () => {
		vi.stubEnv('OGYGIA_SECRET', 'the-env-secret');
		configure_signing_secret('the-app-secret');
		const key = signing_key();
		expect(key.secret).toBe('the-app-secret');
		expect(key.stable).toBe(true);
		expect(key.source).toBe('option');
	});

	it('signs as the same value in OGYGIA_SECRET does: one fingerprint, either path', () => {
		vi.stubEnv('OGYGIA_SECRET', 'one-shared-secret');
		const from_env = signing_key().fp;
		reset_signing_key();
		vi.stubEnv('OGYGIA_SECRET', '');
		configure_signing_secret('one-shared-secret');
		expect(signing_key().fp).toBe(from_env);
	});

	it('a blank secret counts as none', () => {
		vi.stubEnv('OGYGIA_SECRET', 'the-env-secret');
		configure_signing_secret('');
		configure_signing_secret('   ');
		configure_signing_secret(undefined);
		expect(signing_key().source).toBe('env');
	});

	it('a production server signing with it is silent', () => {
		vi.stubEnv('DEV', false);
		vi.stubEnv('OGYGIA_SECRET', '');
		build.build_had_secret = true;
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		configure_signing_secret('the-app-secret');
		signing_key();
		expect(warn).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});

	it('reaches every copy of the module in the process', async () => {
		vi.stubEnv('OGYGIA_SECRET', '');
		configure_signing_secret('the-app-secret');
		vi.resetModules();
		const copy = await import('../src/server/signing-key.ts');
		expect(copy.signing_key).not.toBe(signing_key);
		expect(copy.signing_key().secret).toBe('the-app-secret');
		// (and the key a copy decides is the one every copy signs with)
		expect(signing_key()).toBe(copy.signing_key());
	});

	it('the same secret again (the hooks re-evaluated) is a no-op', () => {
		configure_signing_secret('the-app-secret');
		signing_key();
		expect(() => configure_signing_secret('the-app-secret')).not.toThrow();
		expect(signing_key().secret).toBe('the-app-secret');
	});

	it('another secret after the key is decided throws in dev, naming fingerprints only', () => {
		vi.stubEnv('OGYGIA_SECRET', 'the-env-secret');
		signing_key();
		let thrown = '';
		try {
			configure_signing_secret('a-later-secret');
		} catch (e) {
			thrown = String(e);
		}
		expect(thrown).toContain(
			`already signs with key ${key_fingerprint('the-env-secret')} (from OGYGIA_SECRET`
		);
		expect(thrown).not.toContain('a-later-secret');
		expect(thrown).not.toContain('the-env-secret');
		expect(signing_key().secret).toBe('the-env-secret');
	});

	it('another secret after the key is decided is logged in production, and the key stays', () => {
		vi.stubEnv('DEV', false);
		vi.stubEnv('OGYGIA_SECRET', '');
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		signing_key();
		configure_signing_secret('a-later-secret');
		expect(error).toHaveBeenCalledTimes(1);
		expect(conflict_from(error.mock.calls[0][0])).toContain("this build's random key");
		expect(signing_key().secret).toBe('build-random-key');
	});

	it('two handles with different secrets: the first stays', () => {
		vi.stubEnv('DEV', false);
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		configure_signing_secret('the-first-secret');
		configure_signing_secret('the-second-secret');
		expect(error).toHaveBeenCalledTimes(1);
		expect(conflict_from(error.mock.calls[0][0])).toBe('another handle({ secret })');
		expect(signing_key().secret).toBe('the-first-secret');
	});
});
