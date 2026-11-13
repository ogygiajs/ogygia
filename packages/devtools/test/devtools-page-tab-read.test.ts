// The Page tab's read of the visit has three outcomes: measured, not measured (no beacon record,
// read_page gives null), and failed (read_page threw). A failure is said as one, with its message,
// never as "not measured", whose fix (reload) does not help.
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

const read = { page: (): unknown => null };
vi.mock('../src/devtools/page.ts', async (real) => ({
	...(await real<typeof import('../src/devtools/page.ts')>()),
	read_page: () => read.page()
}));

const { default: PageTab } = await import('../src/devtools/PageTab.svelte');

describe('the Page tab when reading the visit', () => {
	it('no record: "not measured"', () => {
		read.page = () => null;
		const { body } = render(PageTab, { props: {} });
		expect(body).toContain('data-og-page-unmeasured');
	});

	it('a read that throws: said as a failure, with its message, not as "not measured"', () => {
		read.page = () => {
			throw new Error('beacon record of an older shape');
		};
		const { body } = render(PageTab, { props: {} });
		expect(body).not.toContain('data-og-page-unmeasured');
		expect(body).toContain('data-og-page-read-failed');
		expect(body).toContain('beacon record of an older shape');
	});
});
