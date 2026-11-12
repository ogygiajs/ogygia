/** What the content preprocessor and the build agree on for a markup module's own CSS. */

const BACKSLASHES = /\\/g;
const LEADING_SLASH = /^\//;
/**
 * The stable cross-build key for a markup module's own scoped CSS (a `.svx` body with a `<style>`):
 * the path from the first `/src/` segment, POSIX (`/…/proj/src/content/docs/x.svx` →
 * `content/docs/x.svx`). The preprocessor that bakes the key into the module and the build that emits
 * the CSS and writes the handoff compute it identically from the same absolute filename.
 */
export function content_css_key(abs: string): string {
	const p = abs.replace(BACKSLASHES, '/').split('?')[0];
	const i = p.indexOf('/src/');
	return i >= 0 ? p.slice(i + 5) : p.replace(LEADING_SLASH, '');
}
