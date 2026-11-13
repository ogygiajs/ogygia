// The storage port (ports/storage.ts): where reading the page's storage throws (blocked by the
// browser's settings, a sandboxed frame), there is no storage, never a throw.
import { afterEach, expect, it } from 'vitest';
import { storage } from '../src/index.ts';

const g = globalThis as Record<string, unknown>;
const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
	if (had) Object.defineProperty(globalThis, 'localStorage', had);
	else delete g.localStorage;
});

it('storage that throws as it is read is no storage', () => {
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		get() {
			throw new DOMException('blocked', 'SecurityError');
		}
	});
	expect(storage.local()).toBeNull();
});
