// THE INLINED RESTORER IS SAFE AS SCRIPT TEXT. A document the app's transform reshaped carries the
// restorer inline (hooks.ts `RESTORER_SCRIPT`, `restore.toString()`). Inside a `<script>`, `</script`
// ends it early and `<!--` can keep the real `</script>` from closing it, swallowing the rest of the
// page. Like every other inline code ogygia writes (`script()`), its text holds neither.
import { describe, it, expect, vi } from 'vitest';

vi.mock('virtual:ogygia/sign', () => import('../src/server/hmac.ts'));
vi.mock('virtual:ogygia/rate-limit', () => ({ rateLimit: { max: 60, windowMs: 60_000 } }));
vi.mock('virtual:ogygia/server-plugins', () => ({ plugins: [] }));
vi.mock('virtual:ogygia/route-config', () => ({ route_config: {} }));
vi.mock('virtual:ogygia/devtools-boot-url', () => ({ default: '' }));
vi.mock('virtual:ogygia/server-manifest', () => ({
	load_islands: async () => ({ islands: {} }),
	island_url: {},
	island_name: {},
	island_render: {},
	render_island: {},
	island_reads_page_data: null
}));

const hooks = (await import('../src/hooks.ts')) as { RESTORER_SCRIPT?: string };

describe('the inlined restorer', () => {
	it('is one script element whose text holds no </script and no <!--', () => {
		const tag = hooks.RESTORER_SCRIPT ?? '';
		const open = '<script data-og-restore>';
		expect(tag.startsWith(open)).toBe(true);
		expect(tag.endsWith('</script>')).toBe(true);
		const text = tag.slice(open.length, -'</script>'.length);
		expect(/<\/script/i.test(text), 'holds </script').toBe(false);
		expect(text.includes('<!--'), 'holds <!--').toBe(false);
	});
});
