// The env reader's chunk, which the runtime loads for a prerendered page's ask (KIT-PUBLIC-ENV). Its
// own file: the chunk's failed download stays in this frame's module map.
import { afterEach, expect } from 'vitest';
import { commands } from 'vitest/browser';
import { PLAYWRIGHT, it_with_network_routes } from './_browsers.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

(globalThis as { __OGYGIA_KIT_MAJOR__?: number }).__OGYGIA_KIT_MAJOR__ = 3;
const READER = '/test/_stubs/boot.kit-env.ts';
const ISLAND = '/test/browser/fixtures/entry-gates.ts';
const MARK = 'a'.repeat(24);

afterEach(async () => {
	if (PLAYWRIGHT) await commands.keep_downloads(READER);
});

it_with_network_routes(
	"a prerendered page whose env reader's chunk does not load still runs its regions, and leaves nothing unhandled",
	async () => {
		await commands.drop_downloads(READER, 10);
		const { hold_code_for_env } = await import('../../src/runtime/kit-env-first.ts');
		const { import_file } = await import('../../src/runtime/import-again.ts');
		const { code_url_or_refuse } = await import('../../src/runtime/code-origins.ts');
		const unhandled: unknown[] = [];
		const on = (e: PromiseRejectionEvent) => void unhandled.push(e.reason);
		window.addEventListener('unhandledrejection', on);
		const page = document.createElement('template');
		page.innerHTML = `<script type="x" data-ogygia-runtime data-og-mark="${MARK}"></script><script type="application/ogygia-env-served" data-og-mark="${MARK}"></script>`;
		const placed = [...page.content.children];
		document.head.prepend(...placed);
		try {
			hold_code_for_env();
			await import_file(code_url_or_refuse(ISLAND));
			await new Promise((r) => setTimeout(r, 50));
			expect(unhandled).toEqual([]);
		} finally {
			for (const el of placed) el.remove();
			window.removeEventListener('unhandledrejection', on);
		}
	}
);
