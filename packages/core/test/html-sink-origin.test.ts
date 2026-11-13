import { expect, it } from 'vitest';
import { is_allowed_region_endpoint, is_same_origin_response } from '../src/runtime/html-sink.ts';

const PAGE = 'https://app.example.com';

it('a region endpoint is allowed only on the page origin, over http(s)', () => {
	expect(is_allowed_region_endpoint('/_og/region?x=1', PAGE)).toBe(true);
	expect(is_allowed_region_endpoint('https://elsewhere.example.com/_og/region', PAGE)).toBe(false);
	expect(is_allowed_region_endpoint('//elsewhere.example.com/_og/region', PAGE)).toBe(false);
	expect(is_allowed_region_endpoint('javascript:alert(1)', PAGE)).toBe(false);
	expect(is_allowed_region_endpoint('', PAGE)).toBe(false);
});

it('a response that names no URL of its own is judged by the endpoint it was asked from', () => {
	expect(new Response('').url).toBe('');
	expect(is_same_origin_response(new Response(''), PAGE)).toBe(true);
});
