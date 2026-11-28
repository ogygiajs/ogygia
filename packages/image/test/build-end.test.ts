// The build's end runs once per server leg, after the prerender and before the adapter: at the
// server leg's own end when Vite builds the legs (Kit 2), at this plugin's last `buildApp` when an
// app build hook builds them (Kit 3), and, late, as the server leg is written in a Kit 3 watch
// rebuild.
import { expect, test } from 'vitest';
import { BuildEnd, type End } from '../src/vite/build-end.ts';

function noted(ran: string[], name: string): End {
	return async (last) => {
		ran.push(last !== null ? `${name}, late` : name);
		return {};
	};
}

test('with no app build hook running (a single vite.build()), the server leg written is the end', async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	await end.written(noted(ran, 'end'), false);
	expect(ran).toEqual(['end']);
});

test('when Vite builds the legs after the app build hooks (Kit 2), the end runs as the server leg is written', async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	end.open();
	await end.close();
	await end.written(noted(ran, 'end'), false);
	expect(ran).toEqual(['end']);
});

test('when Vite builds and watches the legs (Kit 2), every rebuild ends as its server leg is written, not late', async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	end.open();
	await end.close();
	await end.written(noted(ran, 'build'), true);
	await end.written(noted(ran, 'rebuild'), true);
	expect(ran).toEqual(['build', 'rebuild']);
});

test("when an app build hook builds the legs (Kit 3), the end waits for this plugin's last buildApp", async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	end.open();
	await end.written(noted(ran, 'end'), false);
	ran.push('prerender');
	expect(ran).toEqual(['prerender']);
	await end.close();
	expect(ran).toEqual(['prerender', 'end']);
	await end.close();
	expect(ran).toEqual(['prerender', 'end']);
});

test("when an app build hook builds and watches the legs (Kit 3), a rebuild's end runs late, as its server leg is written", async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	end.open();
	await end.written(noted(ran, 'build'), true);
	ran.push('prerender');
	await end.close();
	await end.written(noted(ran, 'rebuild'), true);
	await end.written(noted(ran, 'next rebuild'), true);
	expect(ran).toEqual(['prerender', 'build', 'rebuild, late', 'next rebuild, late']);
});

test("a watch rebuild whose server leg is written while the first build's end runs (Kit 3) ends after it, late, never beside it", async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	const first = Promise.withResolvers<void>();
	end.open();
	await end.written(async () => {
		ran.push('build starts');
		await first.promise;
		ran.push('build ends');
		return {};
	}, true);
	const closed = end.close();
	const rebuilt = end.written(noted(ran, 'rebuild'), true);
	await Promise.resolve();
	expect(ran).toEqual(['build starts']);
	first.resolve();
	await closed;
	await rebuilt;
	expect(ran).toEqual(['build starts', 'build ends', 'rebuild, late']);
});

test("a watch rebuild whose server leg is written before this plugin's last buildApp (Kit 3) ends after the first build's end, late", async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	end.open();
	await end.written(noted(ran, 'build'), true);
	const rebuilt = end.written(noted(ran, 'rebuild'), true);
	await Promise.resolve();
	expect(ran).toEqual([]);
	await end.close();
	await rebuilt;
	expect(ran).toEqual(['build', 'rebuild, late']);
});

test('a watch rebuild whose server leg is written while the last rebuild ends (Kit 3) ends after it, never beside it', async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	const last = Promise.withResolvers<void>();
	end.open();
	await end.written(noted(ran, 'build'), true);
	await end.close();
	const rebuilt = end.written(async () => {
		ran.push('rebuild starts');
		await last.promise;
		ran.push('rebuild ends');
		return {};
	}, true);
	const next = end.written(noted(ran, 'next rebuild'), true);
	await Promise.resolve();
	expect(ran).toEqual(['build', 'rebuild starts']);
	last.resolve();
	await rebuilt;
	await next;
	expect(ran).toEqual(['build', 'rebuild starts', 'rebuild ends', 'next rebuild, late']);
});

test('a watch rebuild (Kit 3) gets what the last end named its files by, so its pages find the last build files', async () => {
	const end = new BuildEnd();
	const got: unknown[] = [];
	const naming =
		(named: Record<string, string>): End =>
		async (last) => {
			got.push(last);
			return { ...last, ...named };
		};
	end.open();
	await end.written(naming({ url: 'bytes' }), true);
	await end.close();
	await end.written(naming({ card: 'shown' }), true);
	await expect(
		end.written(() => Promise.reject(new Error('a file was not made')), true)
	).rejects.toThrow();
	await end.written(naming({}), true);
	expect(got).toEqual([null, { url: 'bytes' }, { url: 'bytes', card: 'shown' }]);
});

test('a watch rebuild whose end failed (Kit 3) leaves the next rebuild to end, late', async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	end.open();
	await end.written(noted(ran, 'build'), true);
	await end.close();
	await expect(
		end.written(() => Promise.reject(new Error('a file was not made')), true)
	).rejects.toThrow('a file was not made');
	await end.written(noted(ran, 'next rebuild'), true);
	expect(ran).toEqual(['build', 'next rebuild, late']);
});

test("a failing end fails this plugin's last buildApp, so the build stops before the adapter", async () => {
	const end = new BuildEnd();
	end.open();
	await end.written(() => Promise.reject(new Error('a file was not made')), false);
	await expect(end.close()).rejects.toThrow('a file was not made');
});

test('a build that failed after its server leg was written leaves the next build on the same plugin to start fresh', async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	end.open();
	await end.written(noted(ran, 'failed build'), false);
	end.open();
	await end.written(noted(ran, 'next build'), false);
	await end.close();
	expect(ran).toEqual(['next build']);
});

test('a build that failed before its server leg was written leaves the next build on the same plugin to start fresh', async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	end.open();
	end.open();
	await end.written(noted(ran, 'next build'), false);
	await end.close();
	expect(ran).toEqual(['next build']);
});

test('a new app build after a watched one (Kit 3) starts fresh, not late', async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	end.open();
	await end.written(noted(ran, 'watched build'), true);
	await end.close();
	end.open();
	await end.written(noted(ran, 'next build'), false);
	await end.close();
	expect(ran).toEqual(['watched build', 'next build']);
});
