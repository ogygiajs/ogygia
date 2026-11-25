import {
	cloudflare,
	sharp,
	vercel,
	type Encoder,
	type VercelImages,
	type VercelRemotePattern
} from '@ogygia/image/vite';

// The fixture's encoder, read by vite.config.ts (`image({ encoder })`) and by svelte.config.js
// (adapter-vercel's `images`), so both say the same. IMAGE_E2E_ADAPTER=cloudflare: `cloudflare()`
// (IMAGE_E2E_LINKS=1 links on). IMAGE_E2E_ADAPTER=vercel: `[vercel({ sizes }), sharp()]`, or
// `vercel({ sizes })` alone with IMAGE_E2E_VERCEL=alone. Otherwise the default, `sharp()`.
const ADAPTER = process.env.IMAGE_E2E_ADAPTER;

export const VERCEL: Encoder & { readonly images: VercelImages } = vercel({
	sizes: [64, 128, 256, 640, 1280, 2048]
});

export const VERCEL_REMOTE: VercelRemotePattern[] = [
	{ protocol: 'http', hostname: '^127\\.0\\.0\\.1$', port: '4176' }
];

function encoder_of(): Encoder | Encoder[] | undefined {
	if (ADAPTER === 'cloudflare') return cloudflare({ links: process.env.IMAGE_E2E_LINKS === '1' });
	if (ADAPTER !== 'vercel') return undefined;
	return process.env.IMAGE_E2E_VERCEL === 'alone' ? VERCEL : [VERCEL, sharp()];
}

export const encoder: Encoder | Encoder[] | undefined = encoder_of();
