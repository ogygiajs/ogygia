export declare const WIRE_FORMAT_ATTR = "data-og-format";
export declare const WIRE_FORMAT_JSON = "json";
/** Is this side-channel element's text the JSON lane? */
export declare function wire_is_json(el: Element): boolean;
/** Parse a side-channel's text in its lane: `JSON.parse` for the JSON lane (nothing to revive by
 *  construction), devalue `parse` with the caller's revivers otherwise. */
export declare function parse_wire_text(text: string, json: boolean, revivers?: Record<string, (value: never) => unknown>): unknown;
/** A seed or props script's payload, in its lane: JSON when the server marked it plain, devalue
 *  with `revivers` otherwise. Every seed / props read goes through here. */
export declare function parse_sidecar_text(el: Element, revivers?: Record<string, (d: never) => unknown>): unknown;
