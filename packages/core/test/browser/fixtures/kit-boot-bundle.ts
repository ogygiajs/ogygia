export const app = {
	nodes: [
		() => import(/* @vite-ignore */ new URL('./kit-boot-missing-node.js', import.meta.url).href)
	]
};
