import { scope } from '@ogygia/machine';
import { describe, expect, it } from 'vitest';
import { patch } from './_patch.ts';

class Box {
	n = 1;
	read(): number {
		return this.n;
	}
}

describe('patch', () => {
	it('stands in until its scope closes, and the stand-in can call the original on its receiver', () => {
		const box = new Box();
		const s = scope();
		patch(
			s,
			Box.prototype,
			'read',
			(original) =>
				function (this: Box) {
					return original.call(this) * 10;
				}
		);
		expect(box.read()).toBe(10);
		s.close();
		expect(box.read()).toBe(1);
		expect(Object.getOwnPropertyDescriptor(Box.prototype, 'read')?.enumerable).toBe(false);
	});

	it('an inherited key is shadowed while patched and inherited again after', () => {
		const box = new Box();
		const s = scope();
		patch(s, box, 'read', () => () => 7);
		expect(Object.hasOwn(box, 'read')).toBe(true);
		expect(box.read()).toBe(7);
		s.close();
		expect(Object.hasOwn(box, 'read')).toBe(false);
		expect(box.read()).toBe(1);
	});

	it('two patches on one key put back the first original when the scope closes', () => {
		const box = new Box();
		const s = scope();
		patch(s, box, 'n', () => 2);
		patch(s, box, 'n', (two) => two + 1);
		expect(box.n).toBe(3);
		s.close();
		expect(box.n).toBe(1);
	});
});
