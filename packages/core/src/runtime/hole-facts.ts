/**
 * The holes record: what the server minted for each deferred hole on a Kit-hydrated document,
 * keyed by the hole's identity (`data-og-hole`), in the document tail outside Kit's root
 * (server/document-tail.ts). When Kit gives up hydrating and mounts its root fresh, the client
 * renders each hole again with no signed address; the record outlives that, so a rebuilt hole gets
 * its endpoint and sidecar back by identity and fetches (test/browser/hole-rebuild.test.ts).
 *
 * @packageDocumentation
 */
import { HOLES_SCRIPT_TYPE } from '../holes-record.ts';
import { parse_region_html, vouch_page_html } from './html-sink.ts';
import { server_channel } from './response-mark.ts';
import { warn } from '../messages/core.ts';

export type HoleFacts = {
	/** The signed capability URL the server minted. */
	endpoint: string;
	/** A hydrating hole's props sidecar, rebuilt from the recorded HTML; `null` for a static hole. */
	sidecar: HTMLScriptElement | null;
};

const HOLES_SELECTOR = `script[type="${HOLES_SCRIPT_TYPE}"]`;

type RawRecord = Record<string, { endpoint?: unknown; sidecar?: unknown }>;

const records = new WeakMap<Document, Map<string, HoleFacts> | null>();

function parse_record(doc: Document): Map<string, HoleFacts> | null {
	const el = server_channel(doc, HOLES_SELECTOR);
	if (!el) return null;
	let raw: RawRecord;
	try {
		raw = JSON.parse(el.textContent || '') as RawRecord;
	} catch (e) {
		// (the server writes it with JSON.stringify: only a record mangled on its way here)
		if (import.meta.env.DEV) warn('page_payload_unreadable', { what: 'holes record' }, e);
		return null;
	}
	const map = new Map<string, HoleFacts>();
	for (const identity in raw) {
		const entry = raw[identity];
		if (!entry || typeof entry.endpoint !== 'string' || !entry.endpoint) continue;
		map.set(identity, {
			endpoint: entry.endpoint,
			sidecar:
				typeof entry.sidecar === 'string' && entry.sidecar ? sidecar_element(entry.sidecar) : null
		});
	}
	return map;
}

function sidecar_element(html: string): HTMLScriptElement | null {
	// @why the record is the page's own (its server wrote it) and the sidecar a data script, so it is vouched and parsed inert (test: test/browser/hole-facts.test.ts › a recorded sidecar never runs: a script in the record is parsed inert)
	const el = parse_region_html(vouch_page_html(html)).firstElementChild;
	return el && el.tagName === 'SCRIPT' ? (el as HTMLScriptElement) : null;
}

/** The server-minted facts of the hole with this identity on `doc`, or `null`. The record is
 *  parsed once per document; a recorded sidecar comes back as an inert script (it never runs). */
export function hole_facts_of(doc: Document, identity: string): HoleFacts | null {
	let record = records.get(doc);
	if (record === undefined) {
		record = parse_record(doc);
		records.set(doc, record);
	}
	return record?.get(identity) ?? null;
}
