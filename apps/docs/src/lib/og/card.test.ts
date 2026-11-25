// The share image file names (./card.ts): any card turns into one path segment and back.
// Run by plain node: `node --test src/lib/og/card.test.ts`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card_key, card_of, card_path, type Card } from './card.ts';

const CARDS: Card[] = [
	{ home: true },
	{ title: 'Overview' },
	{ title: 'SPA router & PPR', category: 'App' },
	{ title: '@ogygia/content/markdown', category: '@ogygia/content' },
	{ title: 'ünïcödé — “quotes” ✓', category: 'Ω' },
	{ title: 'a+b/c=d?e#f%20' }
];

test('every card comes back from its key unchanged', () => {
	for (const card of CARDS) assert.deepEqual(card_of(card_key(card)), card);
});

test('a key is one path segment of URL-safe characters', () => {
	for (const card of CARDS) assert.match(card_key(card), /^[A-Za-z0-9_-]+$/);
});

test('a card path is /og/<key>.png', () => {
	assert.equal(card_path({ home: true }), `/og/${card_key({ home: true })}.png`);
});

test('a key that is not a card names none', () => {
	for (const key of ['', 'nope', '!!!', btoa('{"a":1}'), btoa('["page",1,""]')])
		assert.equal(card_of(key), null);
});
