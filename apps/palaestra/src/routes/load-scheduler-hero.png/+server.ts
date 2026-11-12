// The /load-scheduler page's hero (`fetchpriority="high"`): a 1x1 PNG. e2e/load-scheduler.spec.ts
// holds it with its own route; the simulator's pages load it over the simulated network, so their
// critical wait sees an image not yet come (internal/sim/test/images.test.ts).
const PNG = Uint8Array.from(
	atob(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
	),
	(c) => c.charCodeAt(0)
);

export const GET = () =>
	new Response(PNG, {
		headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' }
	});
