/**
 * THE MESSAGE SYSTEM ogygia and its first-party plugins share. Each package keeps its messages in two
 * tables — its errors and its warnings: a code, its wording from its arguments, what to do about it —
 * and makes its error class and its `warn()` from them:
 *
 *   export const ERRORS = { some_error: { text: (a: { entry: string }): string => …, details } }
 *     satisfies MessageTableShape;
 *   export const WARNINGS = { … } satisfies MessageTableShape;
 *   const own: MessagesOf<typeof ERRORS, typeof WARNINGS> = define_messages(
 *     import.meta.env.DEV ? ERRORS : null,
 *     import.meta.env.DEV ? WARNINGS : null
 *   );
 *
 *   throw new OgygiaError('goto_not_http');
 *   console.error(new OgygiaError('island_load_failed', { entry }), err);   // a caught failure
 *   warn('island_healed', { entry, drift });                                 // console.warn
 *
 * Every message ends with its code's page, `https://ogygiajs.dev/e/<code>?<args>` (the docs fill the
 * wording in from the arguments). In dev it starts with the wording; in a production build it is the
 * link alone: the tables are only passed under `import.meta.env.DEV`, so the bundler drops them and
 * no wording reaches the bundle (the way Svelte ships `https://svelte.dev/e/<code>`). An error
 * carries its code (`err.code`). Codes are one namespace across every package (the docs' `/e` pages
 * list them all and check it).
 */

/** One message: its wording from its arguments, and its page (plain sentences, `code` in backticks,
 *  one paragraph a line). `details` is a function so a table makes no call as it loads — the bundler
 *  can then drop it whole from a production build. */
export type MessageEntry<A> = { text: (a: A) => string; details: () => string };

/** What a table satisfies. Each `text` declares its own arguments (`(a: { entry: string }): string`),
 *  the one place they are written; {@link MessagesOf} reads them back. */
export type MessageTableShape = Record<string, MessageEntry<never>>;

/** Each code's arguments, read off its `text` (`void`: none). */
type ArgsOf<T> = {
	[C in keyof T]: T[C] extends { text: () => string }
		? void
		: T[C] extends { text: (a: infer A) => string }
			? A
			: never;
};
type Args<M, C extends keyof M> = M[C] extends void ? [] : [M[C]];

/** A package's `OgygiaError` (its error codes) and `warn()` (its warning codes). */
export type MessagesOf<E, W> = {
	OgygiaError: new <C extends keyof E & string>(
		code: C,
		...args: Args<ArgsOf<E>, C>
	) => Error & { code: C };
	warn: <C extends keyof W & string>(
		code: C,
		...rest: [...Args<ArgsOf<W>, C>, ...unknown[]]
	) => void;
	/** A code's line as a string, for a logger that takes one (Rollup's `this.warn`, an injected
	 *  `warn`): what `OgygiaError` and `warn` print. */
	line: <C extends (keyof E | keyof W) & string>(
		code: C,
		...args: Args<ArgsOf<E & W>, C & keyof (E & W)>
	) => string;
};

/** The line for a code: the wording and its link with the table, the link alone without it. */
/** Dev, or a prerender (the server's handle publishes Kit's `building`, hooks.ts): the moments a
 *  server-side message prints its wording. Asked when it prints, never as a module loads. */
export function dev_or_prerender(): boolean {
	return (
		!!import.meta.env?.DEV ||
		(globalThis as unknown as Record<symbol, unknown>)[Symbol.for('ogygia.prerendering')] === true
	);
}

function line(table: MessageTableShape | null, code: string, a: unknown): string {
	let link = 'https://ogygiajs.dev/e/' + code;
	if (a && typeof a === 'object') {
		const params = new URLSearchParams();
		for (const name in a) {
			const value = (a as Record<string, unknown>)[name];
			if (value != null && value !== '') params.set(name, String(value).slice(0, 300));
		}
		const query = params.toString();
		if (query) link += '?' + query;
	}
	const entry = table && (table[code] as MessageEntry<unknown> | undefined);
	return entry ? '[ogygia] ' + entry.text(a) + '\n' + link : '[ogygia] ' + link;
}

/**
 * A package's `OgygiaError`, `warn` and `line` from its tables. A table left out (`null`) prints the
 * link alone; `worded`, asked as each message prints, says whether a table it was given is used —
 * a server bundle keeps its tables for a prerender and words a message only then (and in dev).
 */
export function define_messages<E extends MessageTableShape, W extends MessageTableShape>(
	errors_table: E | null,
	warnings_table: W | null,
	worded: () => boolean = () => true
): MessagesOf<E, W> {
	type Out = MessagesOf<E, W>;
	const errors = () => (errors_table && worded() ? errors_table : null);
	const warnings = () => (warnings_table && worded() ? warnings_table : null);
	class OgygiaError extends Error {
		code: string;
		constructor(code: string, a?: unknown) {
			super(line(errors(), code, a));
			this.name = 'OgygiaError';
			this.code = code;
		}
	}
	return {
		OgygiaError: OgygiaError as unknown as Out['OgygiaError'],
		warn: ((code: string, ...rest: unknown[]) => {
			// a code with arguments takes them first, as a plain object; what follows rides along to the
			// console as it is (an error, a node)
			const first = rest[0];
			const proto = first !== null && typeof first === 'object' ? Object.getPrototypeOf(first) : 0;
			const has_args = proto === Object.prototype || proto === null;
			console.warn(
				line(warnings(), code, has_args ? first : undefined),
				...(has_args ? rest.slice(1) : rest)
			);
		}) as Out['warn'],
		line: ((code: string, a?: unknown) =>
			line(errors_table && code in errors_table ? errors() : warnings(), code, a)) as Out['line']
	};
}
