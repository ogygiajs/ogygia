// THE INLINED RESTORER IS SAFE AS SCRIPT TEXT. A document the app's transform reshaped carries the
// restorer inline (src/pass.ts `RESTORER_SCRIPT`, `restore.toString()`). Inside a `<script>`,
// `</script` ends it early and `<!--` can keep the real `</script>` from closing it, swallowing the
// rest of the page. Like every other inline code ogygia writes (`script()`), its text holds neither.
import { describe, it, expect } from 'vitest';
import { RESTORER_SCRIPT } from '../src/pass.ts';

describe('the inlined restorer', () => {
	it('is one script element whose text holds no </script and no <!--', () => {
		const open = '<script data-og-restore>';
		expect(RESTORER_SCRIPT.startsWith(open)).toBe(true);
		expect(RESTORER_SCRIPT.endsWith('</script>')).toBe(true);
		const text = RESTORER_SCRIPT.slice(open.length, -'</script>'.length);
		expect(/<\/script/i.test(text), 'holds </script').toBe(false);
		expect(text.includes('<!--'), 'holds <!--').toBe(false);
	});
});
