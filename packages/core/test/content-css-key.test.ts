// The content CSS key (src/contract/content.ts): the preprocessor and the build compute it alike.
import { describe, expect, it } from 'vitest';
import { content_css_key } from '../src/contract/content.ts';

describe('content_css_key', () => {
	it('is the path from the first /src/ segment, POSIX, query dropped', () => {
		expect(content_css_key('/proj/src/content/docs/x.svx')).toBe('content/docs/x.svx');
		expect(content_css_key('C:\\proj\\src\\content\\x.svx?raw')).toBe('content/x.svx');
	});

	it('a path with no /src/ segment keeps itself, without its leading slash', () => {
		expect(content_css_key('/elsewhere/x.md')).toBe('elsewhere/x.md');
	});
});
