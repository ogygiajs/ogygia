// The gates `gated-entry.ts` waits on, by name: shared through the page, since each `?name` of the
// entry is its own module instance.
type Gates = Record<string, PromiseWithResolvers<void>>;

export function entry_gate(name: string): PromiseWithResolvers<void> {
	const g = globalThis as { __og_entry_gates?: Gates };
	const gates = (g.__og_entry_gates ??= {});
	return (gates[name] ??= Promise.withResolvers<void>());
}
