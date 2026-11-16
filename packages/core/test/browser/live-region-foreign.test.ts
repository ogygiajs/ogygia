// A PEER'S LIVE REGION (fragment federation): its entry is on another origin, so its own build
// hydrates it, and a later tick of the same module reaches it through that build. A peer built by an
// older ogygia hands back no push; its next tick still shows, by hydrating again.
import { afterEach, beforeAll, expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../_frames.ts';

const OLD_PEER_LABEL = '/test/browser/fixtures/old-peer-label.ts';
/** This test server, reached under another loopback name it answers on: another origin, the same
 *  files (it listens on one of IPv4 or IPv6, whichever `localhost` named first). */
let PEER = '';
async function find_peer(): Promise<string> {
	for (const host of ['127.0.0.1', '[::1]', 'localhost']) {
		const other = new URL(location.href);
		other.hostname = host;
		if (other.origin === location.origin) continue;
		const answered = await fetch(other.origin + OLD_PEER_LABEL).then(
			(r) => r.ok,
			() => false
		);
		if (answered) return other.origin;
	}
	throw new Error('this test server answers on no other loopback origin');
}
/** `render(Label, { text: 'one' })`. */
const label_html = (text: string) =>
	from_b64(inject('label_render_b64')).replace('>one<', `>${text}<`);

type LiveTick = {
	id: string;
	module: string;
	props: Record<string, unknown>;
	html: string;
	hydrate?: string;
};
type LiveRegion = HTMLElement & { applyLive(desc: LiveTick): Promise<void> };
const g = globalThis as { __og_old_peer_hydrates?: number };

beforeAll(async () => {
	PEER = await find_peer();
	const runtime = document.createElement('script');
	runtime.type = 'application/x-inert';
	runtime.setAttribute('data-ogygia-runtime', '');
	runtime.setAttribute('data-og-origins', PEER);
	document.head.prepend(runtime);
});
afterEach(() => {
	document.body.innerHTML = '';
	_reset();
	delete g.__og_old_peer_hydrates;
});

test('a peer’s live region whose older build takes no pushed props shows the next tick: it hydrates again', async () => {
	g.__og_old_peer_hydrates = 0;
	const live = document.createElement('ogygia-region') as LiveRegion;
	live.setAttribute('live', '');
	document.body.append(live);
	bootDev();
	const tick = (text: string) =>
		live.applyLive({
			id: 'old-peer',
			module: PEER + OLD_PEER_LABEL,
			props: { text },
			html: label_html(text),
			hydrate: 'load'
		});
	await tick('one');
	await expect.poll(() => g.__og_old_peer_hydrates, { timeout: 5_000 }).toBe(1);
	await tick('two');
	const label = () => live.querySelector('[data-testid="label"]')?.textContent;
	await expect.poll(label, { timeout: 5_000 }).toBe('two');
	expect(g.__og_old_peer_hydrates, 'hydrated again by its own build').toBe(2);
});
