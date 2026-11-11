// Test stub for `ogygia:server/sign` (the plugin's HMAC module). Plugin packages' unit tests only need
// the server graph (`ogygia/internal/server`) to load; a suite that signs mocks it itself.
export const sign = (_secret: string, message: string): string => message;
export const region_sign = (
	_secret: string,
	audience: string,
	exp: number,
	claim: { id: string; payload: string; session: string; ttl: string; render: string }
): string =>
	[audience, exp, claim.id, claim.payload, claim.session, claim.ttl, claim.render].join('|');
