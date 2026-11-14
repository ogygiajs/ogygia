import { expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { schedule_idle } from '../../src/runtime/schedule.ts';

const COUNTER = '/test/browser/fixtures/Counter.svelte';
const SLOW = '/test/browser/fixtures/slow-entry.ts';
const counter = () => from_b64(inject('counter_render_b64'));
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

test('a region taken out while it waits for its hydrate turn never comes alive', async () => {
	await import(/* @vite-ignore */ COUNTER);
	document.body.innerHTML = [
		`<ogygia-region id="top" wake="load" entry="${SLOW}">${counter()}</ogygia-region>`,
		'<div style="height:30000px"></div>',
		`<ogygia-region id="low" wake="load" entry="${COUNTER}">${counter()}</ogygia-region>`
	].join('');
	const top = document.getElementById('top')!;
	const low = document.getElementById('low')!;
	bootDev();
	// `low` is ready at once; its turn is held while `top`, on screen, still loads (400 ms)
	await tick(250);
	expect(low.hasAttribute('data-hydrated'), 'held for the viewport island').toBe(false);
	expect(schedule_idle(), 'a turn is waiting').toBe(false);
	low.remove();
	await expect.poll(() => top.hasAttribute('data-hydrated'), { timeout: 5_000 }).toBe(true);
	await tick(100);
	const count = low.querySelector('[data-testid="count"]')!;
	const before = count.textContent;
	low.querySelector('button')!.click();
	await tick(10);
	expect(count.textContent, 'its island never ran').toBe(before);
	expect(low.hasAttribute('data-hydrated')).toBe(false);
});

test('a region moved while it waits for its hydrate turn comes alive once, by its new visit', async () => {
	await import(/* @vite-ignore */ COUNTER);
	document.body.innerHTML = [
		`<ogygia-region id="top" wake="load" entry="${SLOW}?moved">${counter()}</ogygia-region>`,
		'<div style="height:30000px"></div>',
		`<ogygia-region id="low" wake="load" entry="${COUNTER}">${counter()}</ogygia-region>`,
		'<div id="elsewhere"></div>'
	].join('');
	const top = document.getElementById('top')!;
	const low = document.getElementById('low')!;
	const hydrated: Element[] = [];
	document.addEventListener('ogygia:hydrated', (e) => hydrated.push(e.target as Element));
	bootDev();
	await tick(250);
	expect(low.hasAttribute('data-hydrated'), 'held for the viewport island').toBe(false);
	document.getElementById('elsewhere')!.append(low);
	await expect.poll(() => low.hasAttribute('data-hydrated'), { timeout: 5_000 }).toBe(true);
	await tick(100);
	expect(hydrated.filter((el) => el === low)).toHaveLength(1);
	expect(top.hasAttribute('data-hydrated')).toBe(true);
	const count = low.querySelector('[data-testid="count"]')!;
	const before = Number(count.textContent);
	low.querySelector('button')!.click();
	await tick(10);
	expect(Number(count.textContent), 'one live island counts one click once').toBe(before + 1);
});
