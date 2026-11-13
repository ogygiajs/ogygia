import { OgygiaError, warn } from '../messages/lazy.ts';
import { flights, say, scope, tasks, type Scope } from '@ogygia/machine';
import { code_url, import_code, type CodeUrl } from './code-origins.ts';

const KIT_PAGE_KEY = Symbol.for('ogygia.kit-page');
// @why Kit builds its `$app/state` page with status -1, and start()'s update() assigns the real status into a `$state.raw` field (test: test/browser/kit-page-thread.test.ts › the bridge is published but Kit has not applied its page (status -1): the island keeps waiting, and hydrates once initialize() lands it)
const KIT_PRE_START_STATUS = -1;

type Global = Record<symbol, unknown>;
type Bridge = { page?: { status?: number } } | null | undefined;

function bridge_of(): Bridge {
	return (globalThis as unknown as Global)[KIT_PAGE_KEY] as Bridge;
}

function page_applied(bridge: Bridge): boolean {
	if (bridge == null) return false;
	try {
		return bridge.page?.status !== KIT_PRE_START_STATUS;
	} catch {
		return false; // ok: Kit's page cannot be read yet: not applied
	}
}

const DEV_STILL_WAITING_MS = 5000;

/** `signal`: the waiter's (an island's wake). Once every waiter has left, the wait ends. */
export function kit_page_thread(signal?: AbortSignal): Promise<unknown> | null {
	if (page_applied(bridge_of())) return null;
	return pending.get(undefined, { signal });
}

const pending = flights({
	name: 'kit page thread',
	run: (_: void, signal: AbortSignal) => {
		const wait = scope();
		wait.on(signal, 'abort', () => wait.close());
		return new Promise<void>((resolve, reject) => {
			for (const url of kit_boot_imports()) {
				void wait
					.task(() => import_code(url))
					.then(undefined, (error: unknown) => {
						wait.close();
						reject(kit_boot_failed(url, error));
					});
			}
			if (import.meta.env.DEV) {
				wait.timeout(() => {
					warn('kit_page_waiting', {
						seconds: DEV_STILL_WAITING_MS / 1000,
						booted: bridge_of() != null
					});
				}, DEV_STILL_WAITING_MS);
			}
			await_bridge(wait, (bridge) =>
				await_applied(wait, bridge, () => {
					wait.close();
					resolve();
				})
			);
		});
	},
	keep: 0
});

const KIT_BOOT_ASSIGN = /__sveltekit_\w+\s*=/;
const KIT_BOOT_IMPORT = /\bimport\(\s*("(?:[^"\\\n]|\\.)*")\s*\)/g;

function kit_boot_imports(): CodeUrl[] {
	if (typeof document === 'undefined') return [];
	const urls = new Set<CodeUrl>();
	for (const s of document.querySelectorAll('script:not([src])')) {
		const type = s.getAttribute('type');
		if (
			type !== null &&
			type !== '' &&
			!/^(?:module|(?:text|application)\/javascript)$/i.test(type)
		)
			continue;
		const text = s.textContent || '';
		if (!KIT_BOOT_ASSIGN.test(text)) continue;
		for (const m of text.matchAll(KIT_BOOT_IMPORT)) {
			try {
				const url = code_url(new URL(JSON.parse(m[1]) as string, document.baseURI).href);
				if (url !== null) urls.add(url);
			} catch {
				// ok: not a URL Kit's import could load either; Kit's other files still decide
			}
		}
	}
	return [...urls];
}

const boot_said = say();

function kit_boot_failed(url: string, error: unknown): Error {
	const failure = new OgygiaError('kit_boot_failed', { url });
	failure.cause = error;
	boot_said.once(url, () => console.error(failure, error));
	return failure;
}

function await_bridge(wait: Scope, cb: (bridge: Bridge) => void): void {
	const g = globalThis as unknown as Global;
	if (g[KIT_PAGE_KEY] != null) return cb(g[KIT_PAGE_KEY] as Bridge);
	let value: unknown;
	const settle = (v: unknown) => {
		value = v;
		Object.defineProperty(g, KIT_PAGE_KEY, {
			value: v,
			writable: true,
			configurable: true,
			enumerable: true
		});
		cb(v as Bridge);
	};
	try {
		Object.defineProperty(g, KIT_PAGE_KEY, {
			configurable: true,
			enumerable: true,
			get: () => value,
			set: settle
		});
	} catch {
		const stop = wait.every(() => {
			if (g[KIT_PAGE_KEY] == null) return;
			stop();
			cb(g[KIT_PAGE_KEY] as Bridge);
		}, 50);
	}
}

function await_applied(wait: Scope, bridge: Bridge, done: () => void): void {
	if (page_applied(bridge)) return done();
	let ended = false;
	const end = () => {
		if (ended) return;
		ended = true;
		tasks.micro(() => stop());
	};
	const stop = $effect.root(() => {
		$effect(() => {
			if (!page_applied(bridge)) return;
			end();
			done();
		});
	});
	wait.defer(end);
}
