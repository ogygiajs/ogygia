/**
 * Attribute changes a test chooses to leave out of the hydration report (`ignoreAttributes`): by the
 * element's tag, the attribute's name and its new value (the old one when it was removed). Rules cross
 * from the test as plain data — a string matches exactly, `{ re, flags }` is a RegExp.
 */
import type { AttrChange } from '../runtime/beacon.ts';
export type Pat = string | {
    re: string;
    flags?: string;
};
export interface AttrRule {
    tag?: Pat;
    name: Pat;
    value?: Pat;
}
/** Split `changes` into those `rules` ignore and those left. */
export declare function apply_attr_rules(changes: AttrChange[], rules: AttrRule[]): {
    left: AttrChange[];
    ignored: AttrChange[];
};
