/**
 * A card's font, read at build: the family its CSS names it by, its weight and its style, from the
 * font file's own `name` and `OS/2` tables, so a card lists only the files (`fonts: ['./serif.woff']`).
 * TrueType and OpenType (`.ttf`, `.otf`) and WOFF (`.woff`) only: satori reads no WOFF2.
 *
 * @packageDocumentation
 */
import zlib from 'node:zlib';

/** What a font file says it is. */
export interface FontFace {
	/** The family its CSS names it by (the typographic family, else the family). */
	name: string;
	weight: number;
	style: 'normal' | 'italic';
}

/** A font file that cannot be read as a card's font. */
export class FontUnreadable extends Error {}

type Tables = Map<string, Buffer>;

function sfnt_tables(bytes: Buffer): Tables {
	const count = bytes.readUInt16BE(4);
	const tables: Tables = new Map();
	for (let i = 0; i < count; i++) {
		const at = 12 + i * 16;
		const tag = bytes.toString('latin1', at, at + 4);
		const offset = bytes.readUInt32BE(at + 8);
		const length = bytes.readUInt32BE(at + 12);
		tables.set(tag, bytes.subarray(offset, offset + length));
	}
	return tables;
}

function woff_tables(bytes: Buffer): Tables {
	const count = bytes.readUInt16BE(12);
	const tables: Tables = new Map();
	for (let i = 0; i < count; i++) {
		const at = 44 + i * 20;
		const tag = bytes.toString('latin1', at, at + 4);
		const offset = bytes.readUInt32BE(at + 4);
		const packed = bytes.readUInt32BE(at + 8);
		const length = bytes.readUInt32BE(at + 12);
		const data = bytes.subarray(offset, offset + packed);
		tables.set(tag, packed < length ? zlib.inflateSync(data) : data);
	}
	return tables;
}

function tables_of(bytes: Buffer): Tables {
	const magic = bytes.toString('latin1', 0, 4);
	if (magic === 'wOFF') return woff_tables(bytes);
	if (magic === 'wOF2') throw new FontUnreadable('a WOFF2 file, which satori cannot read');
	if (magic === 'OTTO' || magic === 'true' || bytes.readUInt32BE(0) === 0x0001_0000)
		return sfnt_tables(bytes);
	throw new FontUnreadable('not a TrueType, OpenType or WOFF font');
}

interface NameRecord {
	platform: number;
	language: number;
	id: number;
	text: Buffer;
}

function name_records(table: Buffer): NameRecord[] {
	const count = table.readUInt16BE(2);
	const strings = table.readUInt16BE(4);
	const out: NameRecord[] = [];
	for (let i = 0; i < count; i++) {
		const at = 6 + i * 12;
		const offset = strings + table.readUInt16BE(at + 10);
		out.push({
			platform: table.readUInt16BE(at),
			language: table.readUInt16BE(at + 4),
			id: table.readUInt16BE(at + 6),
			text: table.subarray(offset, offset + table.readUInt16BE(at + 8))
		});
	}
	return out;
}

function utf16be(bytes: Buffer): string {
	let out = '';
	for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode(bytes.readUInt16BE(i));
	return out;
}

const WEIGHT_WORD_RE =
	/\s+(?:Thin|Hairline|Extra\s?Light|Ultra\s?Light|Light|Regular|Book|Medium|Semi\s?Bold|Demi\s?Bold|Bold|Extra\s?Bold|Ultra\s?Bold|Black|Heavy)$/i;

function name_of(records: readonly NameRecord[], id: number): string | null {
	const mine = records.filter((r) => r.id === id);
	const windows =
		mine.find((r) => r.platform === 3 && r.language === 0x409) ??
		mine.find((r) => r.platform === 3 || r.platform === 0);
	if (windows) return utf16be(windows.text).trim() || null;
	const mac = mine.find((r) => r.platform === 1);
	return mac ? mac.text.toString('latin1').trim() || null : null;
}

function family_of(records: readonly NameRecord[]): string | null {
	return name_of(records, 16) ?? name_of(records, 1)?.replace(WEIGHT_WORD_RE, '') ?? null;
}

/** The face of the font in `bytes`; {@link FontUnreadable} when it is not one a card can use. */
export function font_face(bytes: Buffer): FontFace {
	let tables: Tables;
	try {
		tables = tables_of(bytes);
	} catch (e) {
		if (e instanceof FontUnreadable) throw e;
		throw new FontUnreadable(`its tables do not read (${(e as Error).message})`);
	}
	const name = tables.get('name');
	const os2 = tables.get('OS/2');
	if (!name) throw new FontUnreadable('it has no name table');
	const family = family_of(name_records(name));
	if (!family) throw new FontUnreadable('its name table names no family');
	const weight = os2 && os2.length >= 6 ? os2.readUInt16BE(4) : 400;
	const italic = os2 !== undefined && os2.length >= 64 && (os2.readUInt16BE(62) & 0x201) !== 0;
	return { name: family, weight: weight || 400, style: italic ? 'italic' : 'normal' };
}
