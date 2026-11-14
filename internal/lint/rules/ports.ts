/**
 * `ogygia/ports` (DST): every source of nondeterminism goes through a port of @ogygia/machine
 * (packages/machine/src/ports.ts), so a simulated run (internal/sim) owns all of it and one seed
 * replays a run. Package source calls none of these raw: timers, the platform's timer-backed
 * `AbortSignal.timeout` and the browser's task hooks (`timers`, `tasks`), the clocks, `new Date()`
 * included (`clock.mono()` for a duration, which a wall-clock step never moves; `clock.wall()` for
 * a timestamp that leaves the process: #472), randomness (`random`), the
 * network (`net`), what is on screen (`seen`) and storage (`storage`). It grew out of
 * `ogygia/wall-clock`, which it replaces: `Date.now()` is `clock.wall()`.
 *
 * A raw call that must stay says why on the line before:
 * `// oxlint-disable-next-line ogygia/ports -- <why>` (the old `// port-ok:` mark excuses nothing:
 * internal/lint/reason-notes.test.ts). Code that
 * runs at build time (the compiler, Vite plugins, the CLI, test tooling) is not part of a running
 * app and is not simulated: `.oxlintrc.json` turns the rule off there.
 */

import type { Context, Node } from './shared.ts';

const PORT_CALLS: Record<string, string> = {
	setTimeout: 'timers.after()',
	setInterval: 'timers.every()',
	queueMicrotask: 'tasks.micro()',
	requestAnimationFrame: 'tasks.frame()',
	requestIdleCallback: 'tasks.idle()',
	fetch: 'net.fetch()',
	randomUUID: 'random.uuid()'
};
const PORT_MEMBERS: Record<string, Record<string, string>> = {
	Date: { now: 'clock.wall() (a timestamp) or clock.mono() (a duration)' },
	performance: { now: 'clock.mono()' },
	Math: { random: 'random.float()' },
	crypto: { getRandomValues: 'random.bytes()', randomUUID: 'random.uuid()' },
	// (a timer of the platform's own, which no simulated run can reach: a federation hop's)
	AbortSignal: { timeout: 'timers.timeout()' }
};
const PORT_NEWS: Record<string, string> = {
	IntersectionObserver: 'seen.observer()',
	EventSource: 'net.stream()'
};
const PORT_READS: Record<string, string> = {
	localStorage: 'storage.local()',
	sessionStorage: 'storage.session()'
};
/** Node's own randomness, imported from `node:crypto` (the process's, not the realm's). */
const PORT_IMPORTS: Record<string, string> = {
	randomBytes: 'random.bytes()',
	randomFillSync: 'random.bytes()',
	randomInt: 'random.float()',
	randomUUID: 'random.uuid()',
	getRandomValues: 'random.bytes()'
};
const CRYPTO_MODULES = new Set(['node:crypto', 'crypto']);
/** The objects a platform global is read through (`window.setTimeout`, `globalThis.fetch`). */
const REALMS = new Set(['window', 'globalThis', 'self']);
/** The ports themselves: ports.ts and its modules under ports/. */
const PORTS_FILE = /(^|\/)packages\/machine\/src\/ports(\.ts$|\/)/;
const IN_PACKAGE_SOURCE = /(^|\/)packages\/[^/]+\/src\//;

const port_message = (raw: string, port: string): string =>
	`${raw} is nondeterministic: go through the port, ${port} from @ogygia/machine (a simulated run owns it), or say why it stays raw on the line before: \`// oxlint-disable-next-line ogygia/ports -- <why>\`.`;

export const ports = {
	meta: {
		type: 'problem',
		docs: { description: 'Nondeterminism goes through the ports of @ogygia/machine.' }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!IN_PACKAGE_SOURCE.test(file) || PORTS_FILE.test(file)) return {};
		const report = (f: { node: Node; message: string }) => context.report(f);
		const name_of = (n: unknown): string | undefined =>
			(n as Node | undefined)?.type === 'Identifier' ? (n as { name?: string }).name : undefined;
		/** `x` itself, or `window.x` / `globalThis.x` / `self.x`: the global's name, if it is one. */
		const global_name = (n: Node): string | undefined => {
			const own = name_of(n);
			if (own !== undefined) return own;
			if (n.type !== 'MemberExpression' || n.computed) return undefined;
			const realm = name_of(n.object);
			return realm !== undefined && REALMS.has(realm) ? name_of(n.property) : undefined;
		};
		const member = (n: Node): string | undefined => {
			if (n.type !== 'MemberExpression' || n.computed) return undefined;
			const object = global_name(n.object as Node);
			const property = name_of(n.property);
			if (object === undefined || property === undefined) return undefined;
			const port = PORT_MEMBERS[object]?.[property];
			return port === undefined ? undefined : `${object}.${property}()|${port}`;
		};
		return {
			ImportDeclaration(node: Node) {
				const from = (node.source as { value?: unknown } | undefined)?.value;
				if (typeof from !== 'string' || !CRYPTO_MODULES.has(from)) return;
				for (const s of (node as { specifiers?: Node[] }).specifiers ?? []) {
					const name = name_of((s as { imported?: Node }).imported);
					if (name !== undefined && Object.hasOwn(PORT_IMPORTS, name))
						report({
							node: s,
							message: port_message(`${from}'s ${name}()`, PORT_IMPORTS[name])
						});
				}
			},
			CallExpression(node: Node) {
				const callee = node.callee as Node;
				const m = member(callee);
				if (m !== undefined) {
					const [raw, port] = m.split('|');
					report({ node, message: port_message(raw, port) });
					return;
				}
				const name = global_name(callee);
				if (name !== undefined && Object.hasOwn(PORT_CALLS, name))
					report({ node, message: port_message(`${name}()`, PORT_CALLS[name]) });
			},
			NewExpression(node: Node) {
				const name = global_name(node.callee as Node);
				if (name !== undefined && Object.hasOwn(PORT_NEWS, name))
					report({ node, message: port_message(`new ${name}()`, PORT_NEWS[name]) });
				// (`new Date(x)` is a plain value; with no argument it reads the clock)
				else if (name === 'Date' && !(node as { arguments?: unknown[] }).arguments?.length)
					report({ node, message: port_message('new Date()', 'new Date(clock.wall())') });
			},
			Identifier(node: Node) {
				const name = (node as { name?: string }).name;
				if (name === undefined || !Object.hasOwn(PORT_READS, name)) return;
				const parent = (node as { parent?: Node }).parent;
				// (a property named so, `x.localStorage` off a non-realm, or a key, is not the global)
				if (parent?.type === 'MemberExpression' && parent.property === node) {
					const realm = name_of(parent.object);
					if (realm === undefined || !REALMS.has(realm)) return;
				}
				if (parent?.type === 'Property' && parent.key === node) return;
				report({ node, message: port_message(name, PORT_READS[name]) });
			}
		};
	}
};
