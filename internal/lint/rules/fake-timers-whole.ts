// ── ogygia/fake-timers-whole ──────────────────────────────────────────────

import type { Context, Node } from './shared.ts';

const TIMER_CALLS: ReadonlySet<string> = new Set([
	'setTimeout',
	'clearTimeout',
	'setInterval',
	'clearInterval'
]);
const MESSAGE_FAKE_TIMERS =
	"Fake all four timer calls or none: @ogygia/machine ends every timer through clearInterval, so a fake setTimeout with a real clearInterval is never ended. List 'setTimeout', 'clearTimeout', 'setInterval' and 'clearInterval'.";

export const fake_timers_whole = {
	meta: {
		type: 'problem',
		docs: { description: 'Fake timers fake all four timer calls, or none.' }
	},
	create(context: Context) {
		return {
			CallExpression(node: Node) {
				const callee = node.callee as Node;
				const name =
					callee.type === 'MemberExpression'
						? (callee.property as { name?: string }).name
						: (callee as { name?: string }).name;
				if (name !== 'useFakeTimers') return;
				const options = (node.arguments as Node[])[0];
				if (options?.type !== 'ObjectExpression') return;
				const to_fake = (options.properties as Node[]).find(
					(p) =>
						p.type === 'Property' &&
						((p.key as { name?: string }).name === 'toFake' ||
							(p.key as { value?: unknown }).value === 'toFake')
				);
				const list = to_fake?.value as Node | undefined;
				if (list?.type !== 'ArrayExpression') return;
				const named = new Set<string>();
				for (const el of list.elements as (Node | null)[]) {
					if (el?.type !== 'Literal' || typeof el.value !== 'string') return;
					named.add(el.value);
				}
				const faked = [...TIMER_CALLS].filter((t) => named.has(t)).length;
				if (faked > 0 && faked < TIMER_CALLS.size)
					context.report({ node, message: MESSAGE_FAKE_TIMERS });
			}
		};
	}
};
