// The `when` / `wake` / `prefetch` / `revalidate` vocabulary (src/contract/trigger.ts, #482): one
// parse into a tagged union, read by the compiler's checks and the runtime's schedules alike.
import { describe, expect, it, vi } from 'vitest';
import { on_schedule, on_trigger, parse_trigger, SCHEDULE, WAKE } from '../src/contract/trigger.ts';

describe('parse_trigger', () => {
	it('reads a keyword its set allows, and a media query, into one shape', () => {
		expect(parse_trigger('idle', WAKE)).toEqual({ on: 'idle' });
		expect(parse_trigger('interaction', WAKE)).toEqual({ on: 'interaction' });
		expect(parse_trigger('(min-width: 600px)', SCHEDULE)).toEqual({
			on: 'media',
			query: '(min-width: 600px)'
		});
	});

	it('refuses a keyword its set does not allow, and anything else', () => {
		expect(parse_trigger('interaction', SCHEDULE)).toBeNull();
		expect(parse_trigger('soon', WAKE)).toBeNull();
		expect(parse_trigger('', WAKE)).toBeNull();
	});

	it('a media query is media conditions and media words, never a call or unbalanced parentheses', () => {
		for (const q of [
			'(min-width: 600px)',
			'screen and (min-width: 600px)',
			'(min-width: 600px) and (max-width: 900px), print and (color)',
			'not all and (monochrome)',
			'(width >= calc(300px + 2em))',
			'(prefers-reduced-motion)'
		])
			expect(parse_trigger(q, WAKE), q).toEqual({ on: 'media', query: q });
		for (const q of [
			'visible(200px)',
			'idle()',
			'screen and(min-width: 1px)',
			'(min-width: 1px',
			')(',
			'soon (x)'
		])
			expect(parse_trigger(q, WAKE), q).toBeNull();
	});
});

describe('on_schedule', () => {
	const arms = () => ({ idle: vi.fn(), visible: vi.fn(), media: vi.fn() });

	it('arms the schedule its value names', () => {
		const a = arms();
		const fire = vi.fn();
		on_schedule('idle', a, fire);
		on_schedule('visible', a, fire);
		on_schedule('(max-width: 1px)', a, fire);
		expect(a.idle).toHaveBeenCalledWith(fire);
		expect(a.visible).toHaveBeenCalledWith(fire);
		expect(a.media).toHaveBeenCalledWith('(max-width: 1px)', fire);
		on_schedule('load', a, fire);
		expect(fire).toHaveBeenCalledOnce();
	});

	it('a value no schedule takes (a hole fetched on interaction, cached as a lake) runs on load, never waits on matchMedia("interaction")', () => {
		const a = arms();
		const fire = vi.fn();
		on_schedule('interaction', a, fire);
		expect(a.media).not.toHaveBeenCalled();
		expect(fire).toHaveBeenCalledOnce();
	});
});

describe('on_trigger', () => {
	const arms = () => ({
		idle: vi.fn(),
		visible: vi.fn(),
		media: vi.fn(),
		interaction: vi.fn(),
		load: vi.fn()
	});

	it('a wake arms its gesture, and its load through its own start', () => {
		const a = arms();
		const fire = vi.fn();
		expect(on_trigger('interaction', WAKE, a, fire)).toEqual({ on: 'interaction' });
		expect(a.interaction).toHaveBeenCalledWith(fire);
		on_trigger('load', WAKE, a, fire);
		expect(a.load).toHaveBeenCalledWith(fire);
		expect(fire).not.toHaveBeenCalled();
	});

	it('a value that is not a trigger (a typo) runs on load and says so, never waits on matchMedia', () => {
		const a = arms();
		const fire = vi.fn();
		expect(on_trigger('visable', WAKE, a, fire)).toBeNull();
		expect(a.media).not.toHaveBeenCalled();
		expect(a.load).toHaveBeenCalledWith(fire);
	});
});
