// A recording goes on across a full page load even when the browser keeps the page it left in its
// back-forward cache (the pagehide then says `persisted`). The page's
// part is saved for the next document either way, and a page restored from that cache with the
// session still unclaimed takes it back.
import { afterEach, expect, test } from 'vitest';
import { recording, start_session } from '../../../devtools/src/devtools/session.ts';

const SAVED_KEY = 'ogygia:devtools:session';
const hide = (persisted: boolean) =>
	dispatchEvent(new PageTransitionEvent('pagehide', { persisted }));
const show = (persisted: boolean) =>
	dispatchEvent(new PageTransitionEvent('pageshow', { persisted }));

afterEach(async () => {
	const r = recording();
	if (r) await r.stop();
	sessionStorage.removeItem(SAVED_KEY);
});

test('a page hidden into the back-forward cache saves its part for the next document', () => {
	start_session();
	hide(true);
	const saved = JSON.parse(sessionStorage.getItem(SAVED_KEY) ?? 'null') as unknown[] | null;
	expect(saved).toHaveLength(1);
	expect(recording()).toBeNull();
});

test('a page restored from the back-forward cache with its session unclaimed records on', async () => {
	start_session();
	hide(true);
	show(true);
	const r = recording();
	expect(r).not.toBeNull();
	const data = await r!.stop();
	expect(data.pages.length).toBeGreaterThanOrEqual(1);
	expect(sessionStorage.getItem(SAVED_KEY)).toBeNull();
});

test('a page restored after the next document took its session stays stopped', () => {
	start_session();
	hide(true);
	sessionStorage.removeItem(SAVED_KEY); // the next document took it
	show(true);
	expect(recording()).toBeNull();
});
