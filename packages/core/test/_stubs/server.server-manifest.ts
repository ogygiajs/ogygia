// Test stub for `ogygia:server/server-manifest` (the plugin's server-region table): no server regions.
export const load_server_regions = async (): Promise<{
	regions: Record<string, () => Promise<{ default: unknown }>>;
}> => ({ regions: {} });
export const region_url: Record<string, string> = {};
export const region_name: Record<string, string> = {};
export const region_render: Record<string, string> = {};
export const render_region: Record<string, string> = {};
export const region_reads_page_data: Record<string, boolean> | null = null;
