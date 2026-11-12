/**
 * The testing engine as one script a test injects before the page loads (`@ogygia/testing` builds
 * it with every import bundled in: Playwright's `page.addInitScript`). It installs
 * `window.__ogygia_testing` with the engine already in; the app's realm feeds it through the hook
 * record. `live` says whether such a realm has booted on this page.
 */
import { TESTING_ENGINE_VERSION } from '@ogygia/insights';
import { recorded_realm } from './hook-entries.ts';
import { hydration_json, page_json, record_start, record_stop, settled } from './testing-engine.ts';
import type { OgygiaTestingApi } from './ui.ts';
import { charge } from '@ogygia/core/internal/instruments';
import { scope } from '@ogygia/machine';
import { resume_session, take_saved_session } from './session.ts';

/** When the script began, before its bundled modules ran (the build's banner sets it). */
declare const __og_engine_t0: number | undefined;

if (typeof window !== 'undefined' && !window.__ogygia_testing) {
	// @why a visitor never runs the injected engine, so its evaluation is measuring's own cost (test: ogygia-testing e2e)
	if (typeof __og_engine_t0 === 'number') charge('engine', __og_engine_t0);
	const api: OgygiaTestingApi = {
		version: TESTING_ENGINE_VERSION,
		get live() {
			return !!recorded_realm();
		},
		page: (cpu_fns) => page_json(cpu_fns),
		hydration: (key_attr, ignore) => hydration_json(key_attr, ignore as never),
		record_start: async () => record_start(),
		record_stop: (blocked) => record_stop(blocked),
		settled: (quiet, timeout) => settled(quiet, timeout)
	};
	window.__ogygia_testing = api;
	// @why this engine answers record_stop, so a session the page before saved goes on in its copy, taken before the dock's copy can (test: ogygia-testing e2e › record() across a full page load)
	const saved = take_saved_session();
	if (saved) {
		if (document.readyState !== 'loading') resume_session(saved);
		else {
			// (the page owns it: the scope ends once the body is there and the session goes on)
			const s = scope();
			s.on(document, 'DOMContentLoaded', () => {
				s[Symbol.dispose]();
				resume_session(saved);
			});
		}
	}
}
