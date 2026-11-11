/**
 * The devtools LAUNCHER — the only part of devtools the runtime chunk carries. Called from the runtime
 * boot on a devtools build (behind the `__OGYGIA_DEVTOOLS__` gate: off, all of it tree-shakes away).
 * It makes the shadow host and, in a build, one small plain-DOM button: the dock itself (ui-app.ts,
 * Svelte, every tab, their CSS) loads when someone opens it — a dynamic import the bundler splits
 * off. In a build even the button waits for the browser's DEVTOOLS SWITCH (switch.ts: `?og-devtools=on`,
 * `ogygia.devtools.on()`): a QA or preview deploy's visitors see nothing and pay nothing. On the dev
 * server the button is always there and the dock loads at once.
 *
 * The panel mounts on the LIVE page (not an iframe), so its host element carries a **shadow root** for
 * total CSS isolation: host-page globals can't reach in (a stray `.spacer { height: 140vh }` once
 * ballooned the header) and the devtools' own styles can't leak out. The host is attached to
 * `<html>` (not `<body>`) so a full-body SPA swap never tears the panel out.
 *
 * The switch's cookie also starts the rest, for that browser only: the server writes its event
 * side-channel and the page is measured from the start (runtime/beacon.ts).
 */
import {
	devtools_switched_on,
	switch_in_url,
	testing_lean,
	without_switch,
	write_switch
} from '@ogygia/insights';
import { import_again } from '@ogygia/core/internal/instruments';
import { machine, STALE, type Machine, type Scope } from '@ogygia/machine';
import { OgygiaError } from '../messages/runtime.ts';

/** The dock's code: after a failed download, asked for again under a fresh URL. */
const import_app = import_again(() => import('./ui-app.ts'));

const DEVTOOLS = typeof __OGYGIA_DEVTOOLS__ !== 'undefined' ? __OGYGIA_DEVTOOLS__ : false;
const LAZY = typeof __OGYGIA_DEVTOOLS_LAZY__ !== 'undefined' ? __OGYGIA_DEVTOOLS_LAZY__ : false;

const LAYOUT_KEY = 'ogygia:devtools:layout:v4';

type DockStates = {
	/** The launcher's button is up; the dock's code is not in. */
	button: {};
	/** The dock's code downloads. Its answer counts only while the dock is still here. */
	loading: {};
	/** The dock is mounted. Leaving it unmounts the app, its observers and its Alt+O listener. */
	mounted: {};
	/** Devtools turned off in this browser: nothing of this dock is left. A new one starts over. */
	off: {};
};

const dock_steps = {
	button: ['loading', 'off'],
	loading: ['button', 'mounted', 'off'],
	mounted: ['off'],
	off: []
} as const;

const dock_definition = machine<DockStates>()({
	name: 'devtools-dock',
	initial: 'button',
	steps: dock_steps
});

/** The page's dock: its machine, and what turning it off takes away. */
interface Dock {
	readonly machine: Machine<DockStates, typeof dock_steps>;
	/** the host element, and the launcher's button and Alt+O listener */
	readonly host: HTMLElement;
	readonly launcher: AbortController;
}

/** This module's dock, until devtools is turned off. */
let dock: Dock | null = null;
let launch_opts: { csr_true?: boolean } | undefined;

export function install_devtools_ui(opts?: { csr_true?: boolean }): void {
	if (!DEVTOOLS || typeof document === 'undefined' || dock) return;
	// Never mount on a profiler page — including the Profiler tab's embedded `/run` iframe. Profiler pages
	// tag themselves with `<meta name="ogygia-devtools" content="off">`; the devtools has no business
	// x-raying its own tooling (and a launcher inside the iframe is nonsense).
	if (document.querySelector('meta[name="ogygia-devtools"][content="off"]')) return;
	launch_opts = opts;
	install_console_api();
	// A BUILD: nothing shows until this browser turns devtools on (switch.ts) — a QA or preview
	// deploy's visitors never see the launcher. The dev server always has it.
	if (LAZY) {
		apply_url_switch();
		if (!devtools_switched_on()) return;
	}
	// LEAN TESTING (switch.ts): the injected testing engine, and nothing of the dock to see or load
	if (testing_lean()) return;
	mount_launcher(opts);
}

/** The launcher (and, on the dev server or for a dock left open, the dock). */
function mount_launcher(opts?: { csr_true?: boolean }): void {
	// ONE dock per document, whichever copy of this module asks: a Kit-hydrated page with holes
	// boots both the standalone dock and the ogygia runtime, and two copies of this module (two
	// URLs for one file) each have their own `dock` — the host element is the shared truth
	if (dock || document.querySelector('[data-ogygia-devtools-host]')) return;
	// a session the page before was recording (a full page load mid-session) goes on here — the
	// recorder loads only then (the key: session.ts SAVED_KEY)
	try {
		if (sessionStorage.getItem('ogygia:devtools:session'))
			import('./session.ts').then(
				(m) => m.resume_session_if_any(),
				// (the recorder's code did not load: the session does not go on, and that is said)
				(error: unknown) => console.error(new OgygiaError('devtools_dock_load_failed'), error)
			);
	} catch {
		// ok: no storage: no session to go on with
	}
	// A 0×0 fixed host holds the shadow root; the real UI is a fixed, viewport-filling root inside it.
	// MAX z-index (int32) on the HOST: without one the host stacks at `auto` in the page's root
	// context, so any app overlay with a z-index paints over the dock. At 2147483647 — plus being
	// appended to documentElement AFTER body, which wins the DOM-order tiebreak against equal-z page
	// elements — nothing a page can write out-stacks it. Everything inside the shadow root then only
	// orders against itself.
	const host = document.createElement('div');
	host.setAttribute('data-ogygia-devtools-host', '');
	host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
	document.documentElement.appendChild(host);
	const root = host.attachShadow({ mode: 'open' });
	const csr_true = opts?.csr_true ?? false;
	const here: Dock = { machine: dock_definition.create(), host, launcher: new AbortController() };
	dock = here;
	const state = here.machine;

	// The button shows at once; the dock replaces it when its code is in. A click while it loads is
	// remembered (`want_open`), so the dock opens when it arrives.
	let want_open = false;
	const button = document.createElement('button');
	// A download that fails puts the button back as it was, so the next click asks again, under a
	// fresh URL (the browser keeps the failed one: core's import-again.ts). It once stayed on
	// "loading…" for good. Devtools turned off meanwhile: the download's answer is dropped (a task of
	// `loading`), so nothing mounts into the detached root.
	const load = () => {
		if (!state.move('button', 'loading')) return;
		void state.scope
			.task(() => import_app())
			.then(
				(app) => {
					if (app === STALE || !state.move('loading', 'mounted')) return;
					here.launcher.abort();
					button.remove();
					state.scope.defer(
						app.mount_app(root, {
							csr_true,
							start_open: want_open,
							...(LAZY ? { hide: devtools_off } : {})
						})
					);
				},
				(error: unknown) => {
					if (!state.move('loading', 'button')) return;
					want_open = false;
					button.textContent = 'og devtools';
					console.error(new OgygiaError('devtools_dock_load_failed'), error);
				}
			);
	};
	button.setAttribute('data-og-panel-toggle', '');
	button.title = 'ogygia devtools (Alt+O)';
	button.textContent = 'og devtools';
	button.style.cssText =
		'position:fixed;right:24px;bottom:8px;padding:7px 12px;border-radius:999px;border:1px solid rgba(148,163,184,.35);' +
		'background:#0b1220;color:#e2e8f0;font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer;' +
		'opacity:.55;box-shadow:0 4px 16px rgba(0,0,0,.4)';
	button.onmouseenter = () => (button.style.opacity = '1');
	button.onmouseleave = () => (button.style.opacity = '.55');
	const open = () => {
		want_open = true;
		button.textContent = 'loading…';
		load();
	};
	button.onclick = open;
	// the launcher's Alt+O, until the dock mounts (it has its own) or devtools is turned off
	addEventListener(
		'keydown',
		(e: KeyboardEvent) => {
			if (e.altKey && (e.key === 'o' || e.key === 'O')) {
				e.preventDefault();
				open();
			}
		},
		{ signal: here.launcher.signal }
	);
	root.appendChild(button);
	// a dock left open: its code now (it restores its own state). On the dev server a closed dock
	// still loads, but only once the page is done and the browser idle — the dock's own work must
	// not land in the page load it measures (it once pushed a healthy island's wake a second late)
	if (was_open()) load();
	// (the waits are the launcher's visit: a click that loads it sooner, or devtools turned off, ends them)
	else if (!LAZY) after_load_idle(state.scope, load);
}

/** Runs `fn` once the page is loaded and the browser idle, unless `s` closes first. */
function after_load_idle(s: Scope, fn: () => void): void {
	const idle = () => {
		const host = globalThis as {
			requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
			cancelIdleCallback?: (id: number) => void;
		};
		if (!host.requestIdleCallback) {
			s.timeout(fn, 1000);
			return;
		}
		// (a scope's idle wait has no deadline: this one gives up waiting after 3 s)
		const id = host.requestIdleCallback(fn, { timeout: 3000 });
		s.defer(() => host.cancelIdleCallback?.(id));
	};
	if (document.readyState === 'complete') s.timeout(idle, 500);
	else s.on(globalThis, 'load', () => s.timeout(idle, 500), { once: true });
}

/** Has this browser opened the dock before (from then on the page is measured from the start). */
/** `?og-devtools=on|off` on this page: flip the switch and drop the param from the address. */
function apply_url_switch(): void {
	try {
		const url = new URL(location.href);
		const want = switch_in_url(url);
		if (want === null) return;
		write_switch(want);
		history.replaceState(history.state, '', without_switch(url).href);
	} catch {
		// ok: no URL or history (an embedded frame): the cookie alone
	}
}

/** Turn devtools on in this browser, now: the launcher shows (measuring starts with the next load). */
export function devtools_on(): void {
	if (!LAZY) return;
	write_switch(true);
	mount_launcher(launch_opts);
}

/** Turn devtools off in this browser, now: the launcher and the dock go, and nothing is measured from
 *  the next load on. */
export function devtools_off(): void {
	if (!LAZY) return;
	write_switch(false);
	try {
		localStorage.removeItem(LAYOUT_KEY); // (a dock left open must not come back with the switch)
	} catch {
		// ok: no storage: no layout was kept
	}
	// the dock goes whatever it is doing: a mounted one is unmounted, a download's answer is dropped
	if (dock) {
		dock.machine.go('off');
		dock.launcher.abort();
		dock.host.remove();
		dock = null;
	}
	// (the host another copy of this module made: the shared truth, see mount_launcher)
	document.querySelector('[data-ogygia-devtools-host]')?.remove();
}

/**
 * `ogygia.devtools.on()` / `.off()` in the console (and `.status()`). On the dev server devtools is
 * always on, and they say so.
 */
declare global {
	interface Window {
		ogygia?: { devtools?: { on(): string; off(): string; status(): string } };
	}
}
function install_console_api(): void {
	const say = (on: boolean) =>
		on
			? 'ogygia devtools: on in this browser (stays on; ogygia.devtools.off() to hide it)'
			: 'ogygia devtools: off in this browser';
	const g = (window.ogygia ??= {});
	if (g.devtools) return;
	g.devtools = {
		on() {
			if (!LAZY) return 'ogygia devtools: always on on the dev server';
			devtools_on();
			return say(true);
		},
		off() {
			if (!LAZY) return 'ogygia devtools: always on on the dev server';
			devtools_off();
			return say(false);
		},
		status() {
			return !LAZY ? 'ogygia devtools: always on on the dev server' : say(devtools_switched_on());
		}
	};
}

function was_open(): boolean {
	try {
		return !!JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}')?.open;
	} catch {
		return false;
	}
}
