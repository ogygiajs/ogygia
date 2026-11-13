// A hole's answer that ended on another origin was taken by something in front of ogygia's handle,
// as a same-origin redirect is (runtime/hole-fetch.ts `read_hole`): refused, so the hole does not
// fetch again and dev names the URL that answered (#1482). A plain error read as a flaky network.
import { expect, test } from 'vitest';
import { read_hole } from '../../src/runtime/hole-fetch.ts';
import { RegionAnswerRefused } from '../../src/runtime/region-endpoint-url.ts';

const ENDPOINT = '/__ogygia__?id=cafebabe0103&props=W3t9XQ&exp=9999999999&sig=stub';

/** A 200 the browser followed a redirect to, ending at `url`. */
function redirected_to(url: string): Response {
	const res = new Response('<p>a sign-in page</p>', {
		status: 200,
		headers: { 'content-type': 'text/html' }
	});
	Object.defineProperty(res, 'url', { value: url });
	Object.defineProperty(res, 'redirected', { value: true });
	return res;
}

const refusal = (res: Response): Promise<unknown> =>
	read_hole(ENDPOINT, Promise.resolve(res)).then(
		() => 'read',
		(e: unknown) => e
	);

test('a hole answer redirected to another origin is refused as redirected, with the URL that answered', async () => {
	const err = await refusal(redirected_to('https://sign-in.example.com/login'));
	expect(err).toBeInstanceOf(RegionAnswerRefused);
	expect(err).toMatchObject({
		reason: 'redirected',
		final_url: 'https://sign-in.example.com/login'
	});
});

test('a hole answer redirected on its own origin is refused the same way', async () => {
	const err = await refusal(redirected_to(`${location.origin}/account/`));
	expect(err).toMatchObject({ reason: 'redirected', final_url: `${location.origin}/account/` });
});
