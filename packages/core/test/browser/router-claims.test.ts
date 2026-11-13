import { expect, test, vi } from 'vitest';
import { push_state, replace_state, SpaRouter } from '../../src/runtime/router.ts';

test('the router writes history past a pushState and replaceState patched on the instance', () => {
	const home = location.href;
	const patched_push = vi.fn();
	const patched_replace = vi.fn();
	history.pushState = patched_push;
	history.replaceState = patched_replace;
	try {
		push_state(null, '#router-claims-push');
		replace_state(null, home);
	} finally {
		delete (history as { pushState?: unknown }).pushState;
		delete (history as { replaceState?: unknown }).replaceState;
	}
	expect(patched_push).not.toHaveBeenCalled();
	expect(patched_replace).not.toHaveBeenCalled();
	expect(location.href).toBe(home);
});

test('a beforeNavigate hook that throws stops neither the hooks after it nor the navigation, and stays', () => {
	const router = new SpaRouter();
	const heard: string[] = [];
	const reported: unknown[] = [];
	const report = window.reportError;
	window.reportError = (e) => reported.push(e);
	router.beforeNavigate(() => {
		heard.push('throws');
		throw new Error('a hook bug');
	});
	router.beforeNavigate(() => heard.push('after'));
	const here = new URL(location.href);
	const next = new URL('/router-claims-next', location.href);
	try {
		expect(router.run_before(here, next, 'link')).toBe(true);
		expect(router.run_before(here, next, 'link')).toBe(true);
	} finally {
		window.reportError = report;
	}
	expect(heard).toEqual(['throws', 'after', 'throws', 'after']);
	expect(reported).toHaveLength(2);
});

test('afterNavigate hears the page already on screen the moment it is registered', () => {
	const heard = vi.fn();
	const off = new SpaRouter().afterNavigate(heard);
	expect(heard).toHaveBeenCalledTimes(1);
	expect(heard.mock.calls[0]![0]).toMatchObject({
		from: null,
		to: { url: new URL(location.href) }
	});
	off();
});
