import { describe, expect, it } from 'vitest';
import type { Request, Route } from '@playwright/test';
import { while_open } from '../src/e2e/routes.ts';

const route = {} as Route;
const request = {} as Request;

const throwing = (message: string) =>
	while_open(async () => {
		throw new Error(message);
	});

describe('while_open', () => {
	it.each([
		'apiResponse.text: Response has been disposed',
		'apiResponse.body: Response has been disposed',
		'route.fulfill: Fetch response has been disposed',
		'route.fetch: Target page, context or browser has been closed',
		'apiRequestContext.fetch: Request context disposed.',
		'route.fetch: Test ended.\nCall log:\n  - → GET http://localhost:3051/_app/immutable/chunks/a.js',
		'route.fetch: Test timeout of 30000ms exceeded.'
	])('a handler whose request is gone ends quietly: %s', async (message) => {
		await expect(throwing(message)(route, request)).resolves.toBeUndefined();
	});

	it.each([
		'route.fetch: net::ERR_CONNECTION_REFUSED',
		'Route is already handled!',
		"Cannot read properties of undefined (reading 'includes')",
		'a test said Response has been disposed in its own words'
	])('any other error still fails the test: %s', async (message) => {
		await expect(throwing(message)(route, request)).rejects.toThrow(message);
	});

	it('a thrown value that is not an Error still fails the test', async () => {
		const handler = while_open(async () => {
			// oxlint-disable-next-line no-throw-literal -- the case under test: a handler that throws a non-Error
			throw 'apiResponse.text: Response has been disposed';
		});
		await expect(handler(route, request)).rejects.toBe(
			'apiResponse.text: Response has been disposed'
		);
	});

	it('a handler that ends normally is awaited, and its route and request reach it', async () => {
		const seen: unknown[] = [];
		await while_open(async (r, q) => void seen.push(r, q))(route, request);
		expect(seen).toEqual([route, request]);
	});
});
