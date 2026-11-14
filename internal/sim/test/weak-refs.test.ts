// A run's weak references hold on for the run (collection is real time), and let go once it is over.
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { Loop } from '../src/loop.ts';
import { install, platform } from '../src/platform.ts';
import { rng } from '../src/rng.ts';

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

const collect = async (): Promise<void> => {
	for (let i = 0; i < 3; i++) {
		await new Promise<void>((r) => setImmediate(r));
		gc();
	}
};

describe('a weak reference made in a run', () => {
	it('holds its target while the run lasts, and lets go once the run is over, even when a real finalization registry made before the run holds the reference (run 43495274517: a server Request’s abort reference in the host’s own registry kept every world alive, and the workers ran out of memory)', async () => {
		const loop = new Loop(rng(1));
		const realm: Record<string, unknown> = {};
		const restore = install(realm, platform({ name: 'server', loop, rng: rng(1) }));
		const SimWeakRef = realm.WeakRef as WeakRefConstructor;
		const registry = new FinalizationRegistry<unknown>(() => {});
		const watch = await (async () => {
			const target = { payload: Array.from({ length: 1000 }, () => 1) };
			const ref = new SimWeakRef(target);
			registry.register(target, { ref });
			return { ref, real: new WeakRef(target) };
		})();

		await collect();
		expect(watch.ref.deref()).toBeDefined();

		restore();
		await collect();
		expect(watch.real.deref()).toBeUndefined();
		expect(watch.ref.deref()).toBeUndefined();
	});
});

describe("a realm's platform", () => {
	it('lets go of its world once it ends, though code the world left behind still holds its timers and its clock (a server’s modules stay loaded in the process: each run kept its whole world, and the workers ran out of memory)', async () => {
		const kept = (() => {
			const loop = new Loop(rng(1));
			const p = platform({ name: 'server', loop, rng: rng(1), node: true });
			// oxlint-disable-next-line typescript/unbound-method -- the test keeps the method itself, as code the world left behind would
			const left = { timer: p.setTimeout(() => {}, 10), Date: p.Date, now: p.performance!.now };
			p.end();
			return { left, loop: new WeakRef(loop) };
		})();

		await collect();
		expect(kept.loop.deref()).toBeUndefined();
		expect(kept.left.Date.now()).toBe(kept.left.Date.now());
	});
});
