/**
 * Three small promises of the router: a page answers OPTIONS and a wrong verb with the verbs it
 * takes (POST only when it has an action); `c.visitor` is worked out once per request, and signed
 * claims a shell attached win over the app's resolver; late regions stream each once, in the order
 * they finish, and the stream ends.
 */
import { describe, expect, it } from 'vitest';
import { page, routes } from '../src/index.ts';
import { late_region_chunks } from '../src/stream.ts';

const req = (path: string, init?: RequestInit) => new Request(`http://x${path}`, init);
const body = async function* () {
	yield '<p>page</p>';
};

describe('a page’s verbs', () => {
	const app = routes({
		'/plain': page(body),
		'/form': page(body, { actions: { default: () => ({ ok: true }) } }),
		'/none': page(body, { actions: {} })
	});

	it('OPTIONS on a page answers 204 with the verbs it takes', async () => {
		const plain = (await app.fetch(req('/plain', { method: 'OPTIONS' })))!;
		expect(plain.status).toBe(204);
		expect(plain.headers.get('allow')).toBe('GET, HEAD');
		const form = (await app.fetch(req('/form', { method: 'OPTIONS' })))!;
		expect(form.status).toBe(204);
		expect(form.headers.get('allow')).toBe('GET, HEAD, POST');
	});

	it('a verb a page does not take is 405 with the same list', async () => {
		const res = (await app.fetch(req('/plain', { method: 'DELETE' })))!;
		expect(res.status).toBe(405);
		expect(res.headers.get('allow')).toBe('GET, HEAD');
	});

	it('an empty actions table takes no POST', async () => {
		const res = (await app.fetch(req('/none', { method: 'OPTIONS' })))!;
		expect(res.headers.get('allow')).toBe('GET, HEAD');
	});
});

describe('c.visitor', () => {
	function counting(answer: { sub: string } | undefined) {
		let calls = 0;
		const seen: unknown[] = [];
		const app = routes(
			{
				'/who': {
					GET: (c) => {
						seen.push(c.visitor, c.visitor);
						return c.json({});
					}
				}
			},
			{
				visitor: () => {
					calls++;
					return answer;
				}
			}
		);
		return { app, seen, calls: () => calls };
	}

	it('is worked out once per request, however often it is read', async () => {
		const v = counting({ sub: 'u1' });
		await v.app.fetch(req('/who'));
		expect(v.calls()).toBe(1);
		expect(v.seen).toEqual([{ sub: 'u1' }, { sub: 'u1' }]);
	});

	it('an anonymous answer is remembered too: the resolver runs once', async () => {
		const v = counting(undefined);
		await v.app.fetch(req('/who'));
		expect(v.calls()).toBe(1);
		expect(v.seen).toEqual([undefined, undefined]);
	});

	it('signed claims a shell attached win, and the resolver never runs', async () => {
		const v = counting({ sub: 'from-cookie' });
		const request = req('/who');
		(request as unknown as Record<symbol, unknown>)[Symbol.for('ogygia.claims')] = {
			sub: 'signed'
		};
		await v.app.fetch(request);
		expect(v.calls()).toBe(0);
		expect(v.seen).toEqual([{ sub: 'signed' }, { sub: 'signed' }]);
	});
});

describe('late regions', () => {
	const after = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

	it('stream each once, in the order they finish, and then end', async () => {
		const out: string[] = [];
		for await (const chunk of late_region_chunks([
			{ id: 'slow', promise: after(30, '<b>slow</b>') },
			{ id: 'fast', promise: after(5, '<b>fast</b>') },
			{ id: 'mid', promise: after(15, '<b>mid</b>') }
		]))
			out.push(chunk.slot);
		expect(out).toEqual(['fast', 'mid', 'slow']);
	});

	it('a rejected one streams its error card once, and the rest still come', async () => {
		const out: { slot: string; html: string }[] = [];
		for await (const chunk of late_region_chunks([
			{ id: 'bad', promise: Promise.reject(new Error('no data')) },
			{ id: 'ok', promise: after(5, '<b>ok</b>') }
		]))
			out.push(chunk);
		expect(out.map((c) => c.slot)).toEqual(['bad', 'ok']);
		expect(out[0].html).toContain('no data');
	});
});
