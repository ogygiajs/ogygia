// A custom page driver gets the testing engine through its own addInitScript, before the page is asked.
import { describe, expect, it, vi } from 'vitest';
import { Ogygia, type OgygiaDriver } from '../src/index.ts';

describe('the engine reaches a custom driver', () => {
	it('addInitScript gets the engine script once, as the Ogygia is made, before any evaluate', async () => {
		const calls: string[] = [];
		const scripts: string[] = [];
		const driver: OgygiaDriver = {
			async addInitScript(source) {
				calls.push('init');
				scripts.push(source);
			},
			async evaluate() {
				calls.push('evaluate');
				return false;
			}
		};
		const o = new Ogygia(driver, { timeout: 20 });
		expect(calls).toEqual(['init']);
		await expect(o.settled()).rejects.toThrow();
		expect(scripts).toHaveLength(1);
		expect(scripts[0]!.startsWith('var __og_engine_t0=performance.now();')).toBe(true);
		expect(calls.filter((c) => c === 'init')).toHaveLength(1);
	});

	it('an addInitScript that fails is the error the first call gives', async () => {
		const unhandled = vi.fn();
		process.on('unhandledRejection', unhandled);
		try {
			const o = new Ogygia({
				async addInitScript() {
					throw new Error('no init scripts here');
				},
				async evaluate() {
					return true;
				}
			});
			await new Promise((r) => setTimeout(r, 10));
			expect(unhandled).not.toHaveBeenCalled();
			await expect(o.settled()).rejects.toThrow('no init scripts here');
		} finally {
			process.off('unhandledRejection', unhandled);
		}
	});

	it('a driver without addInitScript still works against a page that has the engine', async () => {
		const o = new Ogygia({ evaluate: async () => false as never }, { timeout: 20 });
		await expect(o.settled()).rejects.toThrow(/testing_api_absent/);
	});
});
