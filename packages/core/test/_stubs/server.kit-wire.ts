// Test stub for `ogygia:server/kit-wire` (real one re-exports Kit's internal wire helpers,
// resolved by the Vite plugin). Mirrors Kit's `id/payload` join shape closely enough for units.
export function create_remote_key(id: string, payload: string): string {
	return `${id}/${payload}`;
}
export function stringify_remote_arg(value: unknown, _transport: unknown): string {
	return JSON.stringify(value);
}
export async function stringify_command_arg(value: unknown, _transport: unknown): Promise<string> {
	return JSON.stringify(value);
}
