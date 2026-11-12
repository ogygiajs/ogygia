// The workload's shapes: a visitor who leaves a page and comes back a while later (10 to 50 s, under
// the 60 s a left page's hole answers linger in the frame store) is drawn, so a store that lets them
// go early is seen asking again (the frame-store EVICT_TTL mutant survived without it).
import { Window } from 'happy-dom';
import { describe, expect, it } from 'vitest';
import { rng } from '../src/rng.ts';
import {
	ACTION_KINDS,
	describe as say,
	next_action,
	user_click,
	type Action
} from '../src/workload.ts';

describe('the workload', () => {
	it('leaves a page and comes back 10 to 50 s later', () => {
		const r = rng(7);
		const away: Action[] = [];
		for (let i = 0; i < 2000; i++) {
			const a = next_action(r, 1, ['/', '/a']);
			if (a.kind === 'away') away.push(a);
		}
		expect(away.length).toBeGreaterThan(0);
		for (const a of away) {
			if (a.kind !== 'away') continue;
			expect(a.ms).toBeGreaterThanOrEqual(10_000);
			expect(a.ms).toBeLessThanOrEqual(50_000);
		}
		expect(ACTION_KINDS).toContain('away');
		expect(say({ kind: 'away', tab: 0, nth: 3, ms: 20_000 })).toBe(
			'tab 0: follow link #3, come back 20000 ms later'
		);
	});

	it('points at a link or a region without clicking (a router prefetch, an island warmed on intent)', () => {
		const r = rng(13);
		let hovers = 0;
		for (let i = 0; i < 2000; i++) if (next_action(r, 1, ['/']).kind === 'hover') hovers++;
		expect(hovers).toBeGreaterThan(0);
		expect(ACTION_KINDS).toContain('hover');
		expect(say({ kind: 'hover', tab: 0, nth: 4 })).toBe('tab 0: point at link or region #4');
	});

	it('clicks a second link before the first navigation lands (a navigation called off midway)', () => {
		const r = rng(11);
		const hurried: Action[] = [];
		for (let i = 0; i < 2000; i++) {
			const a = next_action(r, 1, ['/', '/a']);
			if (a.kind === 'hurry') hurried.push(a);
		}
		expect(hurried.length).toBeGreaterThan(0);
		for (const a of hurried) if (a.kind === 'hurry') expect(a.after).toBeLessThanOrEqual(300);
		expect(ACTION_KINDS).toContain('hurry');
		expect(say({ kind: 'hurry', tab: 0, nth: 3, next: 7, after: 20 })).toBe(
			'tab 0: click link #3, then link #7 20 ms later'
		);
	});

	it('presses a button while a page is still loading (an input before the first paint)', () => {
		const r = rng(17);
		const eager: Action[] = [];
		for (let i = 0; i < 3000; i++) {
			const a = next_action(r, 1, ['/', '/a']);
			if (a.kind === 'eager') eager.push(a);
		}
		expect(eager.length).toBeGreaterThan(0);
		for (const a of eager) if (a.kind === 'eager') expect(a.after).toBeLessThanOrEqual(300);
		expect(ACTION_KINDS).toContain('eager');
		expect(say({ kind: 'eager', tab: 0, path: '/a', nth: 2, after: 5 })).toBe(
			'tab 0: go to /a, press button #2 5 ms in'
		);
	});

	it('presses the same button again 0 to 300 ms later (two refreshes, two commands at once)', () => {
		const r = rng(19);
		const twice: Action[] = [];
		for (let i = 0; i < 3000; i++) {
			const a = next_action(r, 1, ['/', '/a']);
			if (a.kind === 'twice') twice.push(a);
		}
		expect(twice.length).toBeGreaterThan(0);
		for (const a of twice) if (a.kind === 'twice') expect(a.after).toBeLessThanOrEqual(300);
		expect(ACTION_KINDS).toContain('twice');
		expect(say({ kind: 'twice', tab: 0, nth: 2, after: 20 })).toBe(
			'tab 0: press button #2, then again 20 ms later'
		);
	});

	it("a visitor's click is a pointer's: down, up, then the click, as a browser sends them", () => {
		const window = new Window();
		const button = window.document.createElement('button');
		window.document.body.append(button);
		const heard: string[] = [];
		for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
			window.document.addEventListener(type, (e) => heard.push(e.type), { capture: true });
		user_click(button as unknown as Element);
		expect(heard).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
		window.close();
	});
});
