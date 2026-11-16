/**
 * THE FOREIGN-HYDRATE CONTRACT (fragment federation), in one place. A stitched fragment's island
 * entry may be woken by ANOTHER app's runtime. Svelte's hydrate/unmount carry module-level state
 * (hydration cursor, effect context), so the call must run against THIS build's svelte instance —
 * the consuming runtime only schedules and delegates. The hydration ENVELOPE is prepared here too:
 * anchor conventions belong to the svelte that compiled the entry, so the consumer never shapes them.
 * Same-origin wakes never call these.
 *
 * Every island entry of an app that federates re-exports these through `__og_hydrate` /
 * `__og_unmount` (compiler/region/emit.ts); an app that does not federate ships neither. This module
 * sits in the producer's own build, so its `svelte` is the producer's.
 *
 * The component itself is hydrated, as the local runtime does (runtime/hydrate-core.ts), marked
 * "inside an island" through its context: the SSR children are its nodes in one anchor pair (the
 * placed island's dynamic-component pair). `options.recover === false`: the consumer's self-heal
 * asks THIS svelte to throw on a mismatch instead of re-rendering; `options.context` is the
 * cross-island context the consuming page provides the region (its keys are strings or
 * `Symbol.for` names, the same in both builds). `options.pushable`: the region takes later props in
 * place (a live region's tick, a kept island's next page), so the props are THIS build's pushable
 * props, and the push is handed back through it (a consumer that gets none hydrates again instead).
 * The envelope is re-checked per call because a restore from the server markup drops it.
 */
import { hydrate, unmount, type Component } from 'svelte';
import { nested_context } from './nested.ts';
import { PushableProps } from './runtime/pushable-props.svelte.ts';

export function og_entry_hydrate(
	component: Component<Record<string, unknown>>,
	target: Element,
	props: Record<string, unknown>,
	options?: {
		recover?: boolean;
		context?: Map<string | symbol, unknown>;
		pushable?: (push: (next: Record<string, unknown>) => void) => void;
	}
): unknown {
	const first = target.firstChild;
	if (!(first && first.nodeType === 8 && (first as Comment).data === '[')) {
		target.insertBefore(document.createComment('['), target.firstChild);
		target.appendChild(document.createComment(']'));
	}
	const recovery = options && options.recover === false ? { recover: false } : {};
	const pushed = options?.pushable ? new PushableProps(props) : null;
	const app = hydrate(component, {
		target,
		props: pushed ? pushed.props : props,
		context: nested_context(options?.context, target),
		...recovery
	});
	if (pushed) options!.pushable!((next) => pushed.push(next));
	return app;
}

export function og_entry_unmount(app: Record<string, unknown>): unknown {
	return unmount(app);
}
