/**
 * Svelte's client `hydrate` / `mount` / `unmount`, as a stand-in for the bench runs (the
 * Heisenbench preload, internal/heisenbench/src/preload.ts, hands it to hydrate-core.ts only). In
 * Node, `svelte` resolves to its server build, where these throw. The stand-in keeps the contracts
 * the hydrate step relies on, and nothing of Svelte's own work:
 *
 * - with `recover: false`, a target that does not start with the hydration anchor (`<!--[-->`)
 *   throws, as Svelte's `hydration_failed`;
 * - a target marked `data-mismatch` is markup Svelte's walk would not match: with `recover: false`
 *   it throws, and with recovery Svelte discards the server's nodes and renders fresh ones (here:
 *   copies of them);
 * - then the component runs once with the target and its props.
 */
type Component = (target: unknown, props: Record<string, unknown>) => unknown;
type Options = { target: Element; props?: Record<string, unknown>; recover?: boolean };

export function hydrate(component: Component, options: Options): Record<string, unknown> {
	const target = options.target;
	const first = target.firstChild;
	const strict = options.recover === false;
	if (strict && !(first && first.nodeType === 8 && (first as Comment).data === '['))
		throw new Error('hydration_failed');
	if (target.hasAttribute('data-mismatch')) {
		if (strict) throw new Error('hydration_failed');
		target.replaceChildren(...Array.from(target.childNodes, (n) => n.cloneNode(true)));
	}
	component(target, options.props ?? {});
	return { component, target };
}

export function mount(component: Component, options: Options): Record<string, unknown> {
	component(options.target, options.props ?? {});
	return { component, target: options.target };
}

export function unmount(_app: Record<string, unknown>): void {}
