/**
 * THE SOURCE'S LINE FOR A SAMPLED FRAME, IN THE PAGE. The browser's sampler names a frame by the line
 * of the code as served; on the dev server a `.svelte` file is served compiled, so that line is the
 * compiled output's (`save` read as SlowSave.svelte:18, written at line 5). The dev server puts each
 * module's source map inline at its end; this reads it once per file and answers the source line of a
 * served line (its first mapped segment). Asked synchronously: `undefined` while the file is being
 * read (the next look has it), `null` when it cannot say (no inline map: a build's chunk, a file the
 * dev server did not transform). No regex: the map's marker is found by search, the VLQ by table.
 */
import { flights } from '@ogygia/machine';
import { tool_fetch } from '@ogygia/core/internal/instruments';

const MARK = '//# sourceMappingURL=data:application/json;base64,';
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// static: base64's 64 digits and their values, filled once from B64
const B64_INDEX = new Map<string, number>([...B64].map((c, i) => [c, i]));

/** served line (1-based) → source line (1-based), or 0 where the line maps nowhere */
type Lines = Int32Array;

/** How many app files' tables are kept (the files a dev session's profiles name; the least
 *  recently read go first, and are read again when a profile names them). */
const TABLES_MAX = 256;

/** An app file's table, as the dev server serves the file (`null`: none to give). */
async function read_table(file: string): Promise<Lines | null> {
	try {
		const r = await tool_fetch(`/${file}`);
		const t = r.ok ? await r.text() : '';
		return t ? parse(t, file) : null;
	} catch {
		return null; // ok: a file that cannot be read has no source lines to give (said as `null`)
	}
}

/** Each app file's table, read once while it is kept (`null`: the file has no inline map, or it
 *  could not be read). One read per file at a time. */
const tables = flights({
	name: 'devtools source lines',
	max: TABLES_MAX,
	run: (file: string): Promise<Lines | null> => read_table(file)
});

/**
 * Each generated line's first segment that names a source → that source line; only segments of the
 * map's first source (a `.svelte` module maps to itself; helpers it inlined are not its lines).
 */
export function lines_of_map(mappings: string, want_source = 0): Lines {
	const rows = mappings.split(';');
	const out = new Int32Array(rows.length + 1);
	let src = 0;
	let src_line = 0;
	for (let r = 0; r < rows.length; r++) {
		const row = rows[r];
		let i = 0;
		let found = 0;
		while (i < row.length) {
			// one segment: up to five VLQ fields, `,` between segments
			const fields: number[] = [];
			while (i < row.length && row[i] !== ',') {
				let value = 0;
				let shift = 0;
				let more = true;
				while (more && i < row.length) {
					const digit = B64_INDEX.get(row[i++]) ?? 0;
					more = (digit & 32) !== 0;
					value += (digit & 31) << shift;
					shift += 5;
				}
				fields.push(value & 1 ? -(value >> 1) : value >> 1);
			}
			i++;
			if (fields.length >= 4) {
				src += fields[1];
				src_line += fields[2];
				if (!found && src === want_source) found = src_line + 1;
			}
		}
		out[r + 1] = found;
	}
	return out;
}

/** the served file's source line map, read from its inline map (null when it has none) */
function parse(text: string, file: string): Lines | null {
	const at = text.lastIndexOf(MARK);
	if (at === -1) return null;
	let end = text.indexOf('\n', at);
	if (end === -1) end = text.length;
	try {
		const map = JSON.parse(atob(text.slice(at + MARK.length, end).trim())) as {
			mappings?: unknown;
			sources?: unknown;
		};
		if (typeof map.mappings !== 'string' || !Array.isArray(map.sources)) return null;
		// the source that is this file (by its name), else the first
		const base = file.slice(file.lastIndexOf('/') + 1);
		const own = (map.sources as unknown[]).findIndex(
			(s) => typeof s === 'string' && s.slice(s.lastIndexOf('/') + 1) === base
		);
		return lines_of_map(map.mappings, own === -1 ? 0 : own);
	} catch {
		return null;
	}
}

/**
 * The source line of `line` in the app file `file` (`src/…`, as the CPU view names it). `undefined`
 * while it is being read, `null` when it cannot be told.
 */
export function source_line(file: string, line: number | null): number | null | undefined {
	if (line === null || !file.startsWith('src/')) return null;
	const seen = tables.peek(file);
	if (seen?.kind === 'kept') return seen.answer === null ? null : seen.answer[line] || null;
	// (being read: the next look has it)
	if (seen === undefined && typeof fetch === 'function') void tables.get(file); // ok: its read never rejects (a failure is a null table)
	return undefined;
}

/**
 * Functions with the source's lines: each mapped where the file's map says, else its line dropped
 * (a served line is not the source's). `mapped`: every app function among them has its source line.
 */
export function with_source_lines<F extends { file: string; line: number | null }>(
	fns: readonly F[]
): { fns: F[]; mapped: boolean } {
	let mapped = true;
	const out = fns.map((f) => {
		const l = source_line(f.file, f.line);
		if (l) return { ...f, line: l };
		if (f.file.startsWith('src/')) mapped = false;
		return { ...f, line: null };
	});
	return { fns: out, mapped };
}
