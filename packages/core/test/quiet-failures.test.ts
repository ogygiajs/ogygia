// What may fail without failing its caller: each read below meets input it cannot use (no browser,
// no request, a broken marker, a bad path) and answers its plain fallback instead of throwing.
import { describe, expect, it, vi } from 'vitest';
import { Hmac } from '../src/server/hmac.ts';
import { fingerprint_args, record_source_read, set_source_observer } from '../src/source.ts';
import { mark_store } from '../src/store-transport.ts';
import { tool_fetch } from '../src/tool-fetches.ts';
import { register_router_css, router_css_of } from '../src/router-css.ts';
import { devtools_switched_on, testing_lean, write_switch } from '../src/contract/switch.ts';
import { real_posix } from '../src/contract/core-files.ts';
import { note_early_hole, take_early_holes } from '../src/context.ts';
import { collect_provided_context } from '../src/context-bridge.ts';
import { current_request, set_current_request } from '../src/plugin/facts.ts';

describe('off the browser', () => {
	it('the testing switch reads not lean', () => {
		expect(testing_lean()).toBe(false);
	});

	it('the devtools switch reads off', () => {
		expect(devtools_switched_on()).toBe(false);
	});

	it('writing the devtools switch is a no-op', () => {
		expect(() => write_switch(true)).not.toThrow();
	});
});

it('a path that does not exist is kept as given, with forward slashes', () => {
	expect(real_posix('/no/such/ogygia-path\\x.svelte')).toBe('/no/such/ogygia-path/x.svelte');
});

it('an early hole noted outside a request is dropped', () => {
	expect(() => note_early_hole('/__ogygia__?id=x')).not.toThrow();
	expect(take_early_holes()).toEqual([]);
});

it('a provided-context marker that does not parse provides nothing', () => {
	const provide = {
		tagName: 'OGYGIA-PROVIDE',
		querySelector: () => ({ textContent: 'not devalue' }),
		parentElement: null
	} as unknown as Element;
	expect(collect_provided_context(provide)).toBeUndefined();
});

it('a relative address (./ or ../) always resolves against a page URL', () => {
	const base = new URL('https://a.test/x/y');
	const tails = [
		'',
		'\u0000',
		'%',
		'%zz',
		'[',
		'\\\\evil',
		'\uD800',
		':::',
		'//host',
		'?q#h',
		' x '
	];
	for (const head of ['./', '../'])
		for (const tail of tails) expect(() => new URL(head + tail, base)).not.toThrow();
});

it('a signature that is not 64 lowercase hex is refused before any compare', () => {
	const sig = Hmac.sign('secret', 'message');
	expect(Hmac.verify('secret', 'message', sig)).toBe(true);
	for (const bad of [sig.slice(2), `${sig}00`, sig.toUpperCase(), `${sig.slice(0, 63)}g`])
		expect(Hmac.verify('secret', 'message', bad)).toBe(false);
});

it('arguments JSON cannot write share one opaque tag', () => {
	expect(fingerprint_args([1n])).toBe('opaque');
	expect(fingerprint_args([{ n: 2n }])).toBe('opaque');
});

it('a receipt observer that throws never fails the read, and is reported', () => {
	const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
	set_source_observer(() => {
		throw new Error('observer broke');
	});
	try {
		expect(() => record_source_read('t:1')).not.toThrow();
		expect(reported).toHaveBeenCalledTimes(1);
	} finally {
		set_source_observer(null);
		reported.mockRestore();
	}
});

it('a store that cannot take its tag is returned as is, and said', () => {
	const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
	try {
		const frozen = Object.freeze({ subscribe: () => () => {} });
		expect(mark_store(frozen, 'tag-1')).toBe(frozen);
		expect(warned).toHaveBeenCalled();
	} finally {
		warned.mockRestore();
	}
});

it('a tool fetch off the browser goes out as given', async () => {
	const fetched = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('ok'));
	try {
		expect(await (await tool_fetch('/x')).text()).toBe('ok');
		expect(fetched).toHaveBeenCalledWith('/x', undefined);
	} finally {
		fetched.mockRestore();
	}
});

it("a component's router CSS whose read throws is no CSS", () => {
	const component = () => {};
	register_router_css(component, () => {
		throw new Error('handoff unreadable');
	});
	expect(router_css_of(component)).toEqual([]);
});

it('a request reader that throws reads as no request', () => {
	set_current_request(() => {
		throw new Error('outside the request store');
	});
	try {
		expect(current_request()).toBeUndefined();
	} finally {
		set_current_request(null);
	}
});
