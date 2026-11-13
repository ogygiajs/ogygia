// An `ogygia()` plugin's life (src/vite/session.ts): its compiler is made once the bundler resolved
// the build, with that build's context. A hook that needs it earlier, or a second resolve without a
// new `config`, is refused with a code, never a read of a context that is not there.
import { describe, expect, it } from 'vitest';
import type { Plugin } from 'vite';
import { compiler_of, configured, new_session, resolve } from '../src/vite/session.ts';
import type { Compiler } from '../src/compiler/driver.ts';
import { ogygia } from '../dist/vite/index.js';

const fake = (n: number) => ({ n }) as unknown as Compiler;

describe('the plugin session', () => {
	it('a hook before the build is resolved is refused, naming the hook and the state', () => {
		const s = new_session();
		expect(() => compiler_of(s, 'transform')).toThrow(
			/`transform` hook while the plugin was created/
		);
		configured(s);
		expect(() => compiler_of(s, 'load')).toThrow(/`load` hook while the plugin was configured/);
	});

	it('resolving makes the compiler the hooks get; config may run more than once first', () => {
		const s = new_session();
		configured(s);
		configured(s);
		const c = resolve(s, () => fake(1));
		expect(compiler_of(s, 'transform')).toBe(c);
	});

	it('a plugin shared across environments, resolved again with no config, keeps its build', () => {
		// (Vite's builder with shared plugins resolves each environment's config with the one
		// instance: configResolved runs again, its config hook does not)
		const s = new_session();
		configured(s);
		const first = resolve(s, () => fake(1));
		let given: Compiler | null = null;
		const again = resolve(s, (prev) => {
			given = prev;
			return fake(2);
		});
		expect(given).toBe(first);
		expect(compiler_of(s, 'buildStart')).toBe(again);
	});

	it('a second build (config again) gets its own compiler', () => {
		const s = new_session();
		configured(s);
		const first = resolve(s, () => fake(1));
		configured(s);
		expect(() => compiler_of(s, 'buildStart')).toThrow(/plugin_session_order|was configured/);
		const second = resolve(s, () => fake(2));
		expect(second).not.toBe(first);
		expect(compiler_of(s, 'buildStart')).toBe(second);
	});

	it('the plugin refuses a transform before configResolved with the code', async () => {
		const plugin = ogygia().find((p) => p.name === 'ogygia') as Plugin;
		const hook = plugin.transform as unknown as
			| ((...a: unknown[]) => unknown)
			| { handler: (...a: unknown[]) => unknown };
		const run = typeof hook === 'function' ? hook : hook.handler;
		await expect(
			Promise.resolve().then(() =>
				run.call({ environment: { name: 'ssr' } }, '<p></p>', '/app/src/A.svelte', { ssr: true })
			)
		).rejects.toThrow(/plugin_session_order/);
	});
});
