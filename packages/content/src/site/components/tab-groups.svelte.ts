import { storage } from '@ogygia/machine';

const KEY = 'og-tabs:';

const selected = $state<Record<string, string>>({});

/**
 * A reactive handle for one tab group's selected label. Every `<TabGroup group="...">` with the same
 * `group` shares it (pick "pnpm" in one block and every `group="install"` block follows), and setting
 * it saves the choice to localStorage for later pages. Without storage it is kept in memory.
 */
export function tab_group(group: string) {
	return {
		get value(): string | undefined {
			return selected[group];
		},
		set value(label: string) {
			selected[group] = label;
			try {
				storage.local()?.setItem(KEY + group, label);
				// oxlint-disable-next-line ogygia/no-silent-failures -- no storage (private mode); the choice is kept in memory only
			} catch {}
		}
	};
}

/**
 * Seed a group's initial choice ONCE, from localStorage if present, else `fallback` (the first tab's
 * label). A choice made this session is never replaced. Client-only: call it on mount, so restoring a
 * saved choice is an update after hydration, not a server/client mismatch.
 */
export function hydrate_group(group: string, fallback: string): void {
	if (selected[group] != null) return;
	let saved: string | null = null;
	try {
		saved = storage.local()?.getItem(KEY + group) ?? null;
		// oxlint-disable-next-line ogygia/no-silent-failures -- no storage (private mode); the fallback is chosen
	} catch {}
	selected[group] = saved ?? fallback;
}
