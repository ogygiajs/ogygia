// The response mark as the browser tests' documents carry it (RESPONSE-MARK): the side channels
// test/browser/setup.ts writes bear TEST_MARK, as the handle writes its response's mark on each, and a
// test that reads them gives the live head the runtime script that bears it. Without it, no channel is
// the server's (test/browser/side-channel-seeds.test.ts).

/** The mark every fixture side channel bears. */
export const TEST_MARK = '7e57da7a7e57da7a7e57da7a';

/** ` data-og-mark="…"`, as the handle writes it on a side channel. */
export const TEST_MARK_ATTR = ` data-og-mark="${TEST_MARK}"`;

/** The head runtime script, bearing TEST_MARK (a type that does not run: a stand-in). Call in
 *  `beforeEach`; returns its removal for `afterEach`. */
export function mark_live_head(): () => void {
	const el = document.createElement('script');
	el.setAttribute('data-ogygia-runtime', '');
	el.setAttribute('data-og-mark', TEST_MARK);
	el.type = 'application/x-runtime-stand-in';
	document.head.prepend(el);
	return () => el.remove();
}
