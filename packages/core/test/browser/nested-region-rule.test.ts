import { afterEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';

const OUTER = '<ogygia-region wake="none" entry="/outer.js">';

afterEach(() => {
	document.body.innerHTML = '';
});

const inner = async (html: string) => {
	document.body.innerHTML = html;
	bootDev();
	await new Promise((r) => setTimeout(r, 50));
	return document.querySelector('[data-inner]') as Element;
};

test('a region inside an awake region rides its hydration: marked nested, it never runs on its own', async () => {
	document.body.innerHTML = '';
	const el = await inner(
		`<ogygia-region wake="load" entry="/outer-awake.js"><ogygia-region data-inner wake="interaction" entry="/inner.js"></ogygia-region></ogygia-region>`
	);
	expect(el.hasAttribute('data-nested')).toBe(true);
});

test('a region in an adopted slot of an awake region runs on its own', async () => {
	const el = await inner(
		`<ogygia-region wake="load" entry="/outer-slot.js"><ogygia-slot><ogygia-region data-inner wake="interaction" entry="/inner.js"></ogygia-region></ogygia-slot></ogygia-region>`
	);
	expect(el.hasAttribute('data-nested')).toBe(false);
});

test('a region whose entry is on another origin runs on its own inside an awake region', async () => {
	const el = await inner(
		`<ogygia-region wake="load" entry="/outer-foreign.js"><ogygia-region data-inner wake="interaction" entry="https://peer.example.com/x.js"></ogygia-region></ogygia-region>`
	);
	expect(el.hasAttribute('data-nested')).toBe(false);
});

test('a region inside a sleeping one is no nested rider', async () => {
	const el = await inner(
		`${OUTER}<ogygia-region data-inner wake="none" entry="/inner.js"></ogygia-region></ogygia-region>`
	);
	expect(el.hasAttribute('data-nested')).toBe(false);
});
