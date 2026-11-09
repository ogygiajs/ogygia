/**
 * `source` with every opaque element stamped, or `null` when there is nothing to stamp (or the file
 * does not parse — the real compile reports that). Outermost wins: nothing is stamped inside a stamped
 * element (the repair never enters it anyway).
 */
export declare function stamp_opaque(raw: string, filename: string): string | null;
