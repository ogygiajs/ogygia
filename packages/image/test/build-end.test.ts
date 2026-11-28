// The build's end runs once per server leg, after the prerender and before the adapter: at the
// server leg's own end when Vite builds the legs (Kit 2), at this plugin's last `buildApp` when an
// app build hook builds them (Kit 3).
import { expect, test } from 'vitest';
import { BuildEnd } from '../src/vite/build-end.ts';

test('with no app build hook running (a single vite.build()), the server leg written is the end', async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	await end.written(async () => {
		ran.push('end');
	});
	expect(ran).toEqual(['end']);
});

test('when Vite builds the legs after the app build hooks (Kit 2), the end runs as the server leg is written', async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	end.open();
	await end.close();
	await end.written(async () => {
		ran.push('end');
	});
	expect(ran).toEqual(['end']);
});

test("when an app build hook builds the legs (Kit 3), the end waits for this plugin's last buildApp", async () => {
	const end = new BuildEnd();
	const ran: string[] = [];
	end.open();
	await end.written(async () => {
		ran.push('end');
	});
	ran.push('prerender');
	expect(ran).toEqual(['prerender']);
	await end.close();
	expect(ran).toEqual(['prerender', 'end']);
	await end.close();
	expect(ran).toEqual(['prerender', 'end']);
});

test("a failing end fails this plugin's last buildApp, so the build stops before the adapter", async () => {
	const end = new BuildEnd();
	end.open();
	await end.written(() => Promise.reject(new Error('a file was not made')));
	await expect(end.close()).rejects.toThrow('a file was not made');
});
