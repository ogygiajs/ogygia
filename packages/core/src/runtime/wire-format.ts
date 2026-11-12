/**
 * The wire format of a side-channel script, read back. The server (server/props-wire.ts) writes
 * two lanes: plain JSON under `data-og-format="json"` for a payload with nothing devalue exists
 * for, and devalue otherwise. The JSON lane never asks for devalue.
 *
 * @packageDocumentation
 */
import { boot_link } from './slots.ts';
import { OG_FORMAT } from '../wire-markup.ts';

export const WIRE_FORMAT_JSON = 'json';

/** Is this side-channel element's text the JSON lane? */
export function wire_is_json(el: Element): boolean {
	return el.getAttribute(OG_FORMAT) === WIRE_FORMAT_JSON;
}

/** Parse a side-channel's text in its lane: `JSON.parse` for the JSON lane (nothing to revive by
 *  construction), devalue `parse` with the caller's revivers otherwise. */
export function parse_wire_text(
	text: string,
	json: boolean,
	revivers?: Record<string, (value: never) => unknown>
): unknown {
	if (json) return JSON.parse(text);
	const { parse } = boot_link().devalue();
	return parse(text, revivers as Parameters<typeof parse>[1]);
}

/** A seed or props script's payload, in its lane: JSON when the server marked it plain, devalue
 *  with `revivers` otherwise. Every seed / props read goes through here. */
export function parse_sidecar_text(
	el: Element,
	revivers?: Record<string, (d: never) => unknown>
): unknown {
	return parse_wire_text(el.textContent ?? '', wire_is_json(el), revivers);
}
