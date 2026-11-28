// The build's end runs once per server leg, after the prerender and before the adapter: at the
// server leg's own end when Vite builds the legs (Kit 2), at this plugin's last `buildApp` when an
// app build hook builds them (Kit 3), and, late, as the server leg is written in a Kit 3 watch
// rebuild.
import { expect, test } from 'vitest';
import { BuildEnd, type End } from '../src/vite/build-end.ts';

function noted(ran: string[], name: string): End {
	return async (late) => {
		ran.push(late ? `${name}, late` : name);
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
