const BOM = 0xfeff;

/** `source` without a leading byte-order mark (the same string when there is none). */
export function strip_bom(source: string): string {
	return source.charCodeAt(0) === BOM ? source.slice(1) : source;
}
