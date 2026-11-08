import { json } from '@sveltejs/kit';

/** A newsletter sign-up: a form post that changes nothing any stored page shows (deck S22). */
export async function POST({ request }) {
	const { email } = (await request.json()) as { email?: string };
	return json({ subscribed: typeof email === 'string' && email.includes('@') });
}
