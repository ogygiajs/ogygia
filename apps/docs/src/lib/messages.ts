/**
 * ogygia's messages for the `/e` pages: every code of every first-party table, its kind, its page
 * (`details`, plain sentences with `code` in backticks), and its wording as printed — the link a
 * production build prints carries the message's arguments, so the page words it the way dev did.
 */
import {
	ERRORS,
	WARNINGS,
	SERVER_ERRORS,
	SERVER_WARNINGS,
	type MessageEntry
} from '@ogygia/core/internal/messages';
import { BUILD_ERRORS, BUILD_WARNINGS } from '@ogygia/compiler';
import * as bake from '@ogygia/bake/internal/messages';
import * as barrels from '@ogygia/barrels/internal/messages';
import * as content from '@ogygia/content/internal/messages';
import * as devtools from '@ogygia/devtools/internal/messages';
import * as federation from '@ogygia/federation/internal/messages';
import * as flags from '@ogygia/flags/internal/messages';
import * as machine from '@ogygia/machine';
import * as postrender from '@ogygia/postrender/internal/messages';
import * as reshape from '@ogygia/rewrite/internal/messages';
import * as testing from '@ogygia/testing/internal/messages';
import * as cli from '@ogygia/cli/internal/messages';

export type Kind = 'error' | 'warning';
/** A run of a paragraph: plain text, or `code`. */
export type Run = { code: boolean; text: string };

type Table = Record<string, MessageEntry<never>>;
const TABLES: Array<[Kind, Table]> = [
	['error', ERRORS],
	['warning', WARNINGS],
	['error', SERVER_ERRORS],
	['warning', SERVER_WARNINGS],
	['error', BUILD_ERRORS],
	['warning', BUILD_WARNINGS],
	// the first-party plugins', each its package's own
	['error', bake.BAKE_ERRORS],
	['warning', bake.BAKE_WARNINGS],
	['error', barrels.BARRELS_ERRORS],
	['warning', barrels.BARRELS_WARNINGS],
	['error', content.CONTENT_BUILD_ERRORS],
	['warning', content.CONTENT_BUILD_WARNINGS],
	['error', content.CONTENT_ERRORS],
	['warning', content.CONTENT_WARNINGS],
	['error', devtools.DEVTOOLS_BUILD_ERRORS],
	['warning', devtools.DEVTOOLS_BUILD_WARNINGS],
	['error', devtools.DEVTOOLS_ERRORS],
	['warning', devtools.DEVTOOLS_WARNINGS],
	['error', federation.FEDERATION_ERRORS],
	['warning', federation.FEDERATION_WARNINGS],
	['error', flags.FLAGS_ERRORS],
	['warning', flags.FLAGS_WARNINGS],
	['error', flags.FLAGS_BUILD_ERRORS],
	['warning', flags.FLAGS_BUILD_WARNINGS],
	['error', machine.MACHINE_ERRORS],
	['warning', machine.MACHINE_WARNINGS],
	['error', postrender.POSTRENDER_ERRORS],
	['warning', postrender.POSTRENDER_WARNINGS],
	['error', reshape.RESHAPE_ERRORS],
	['warning', reshape.RESHAPE_WARNINGS],
	['error', testing.TESTING_ERRORS],
	['warning', testing.TESTING_WARNINGS],
	['error', cli.CLI_ERRORS],
	['warning', cli.CLI_WARNINGS]
];

function all(): Map<string, { kind: Kind; entry: MessageEntry<never> }> {
	const out = new Map<string, { kind: Kind; entry: MessageEntry<never> }>();
	for (const [kind, table] of TABLES)
		for (const [code, entry] of Object.entries(table)) {
			if (out.has(code)) throw new Error(`messages: the code ${code} is in two tables`);
			out.set(code, { kind, entry });
		}
	return out;
}
const MESSAGES = all();

/** `a` and `b` in backticks → runs. */
function runs(paragraph: string): Run[] {
	return paragraph.split('`').map((text, i) => ({ code: i % 2 === 1, text }));
}

export function message_list(): Array<{ code: string; kind: Kind; summary: Run[] }> {
	return [...MESSAGES]
		.map(([code, { kind, entry }]) => ({
			code,
			kind,
			summary: runs(entry.details().split('\n')[0])
		}))
		.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * One code's page. `params` are the link's arguments: each fills its place in the wording; a missing
 * one shows as `‹name›`. `'true'` / `'false'` read as booleans (a message chooses its wording by them).
 */
export function message_page(
	code: string,
	params: URLSearchParams
): { code: string; kind: Kind; text: string; details: Run[][]; args: [string, string][] } | null {
	const found = MESSAGES.get(code);
	if (!found) return null;
	const args = new Proxy({} as Record<string, unknown>, {
		get: (_, name) => {
			if (typeof name !== 'string') return undefined;
			const value = params.get(name);
			return value === null
				? `‹${name}›`
				: value === 'true'
					? true
					: value === 'false'
						? false
						: value;
		}
	});
	let text: string;
	try {
		text = (found.entry.text as (a: unknown) => string)(args);
	} catch {
		text = '(this message could not be worded from the link)';
	}
	return {
		code,
		kind: found.kind,
		text,
		details: found.entry.details().split('\n').map(runs),
		args: [...params]
	};
}
