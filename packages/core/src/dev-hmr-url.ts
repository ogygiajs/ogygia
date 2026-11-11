/**
 * The dev server's soft-HMR bridge (the `dev` realm's `ogygia:dev/hmr`), by its served URL: the
 * `__OGYGIA_DEV_HMR_URL__` define. `''` in a build, so the script that loads the bridge folds out of
 * every leg, and no build's output holds a `dev` module (the bundle check proves it).
 */
export const dev_hmr_url: string =
	typeof __OGYGIA_DEV_HMR_URL__ !== 'undefined' ? __OGYGIA_DEV_HMR_URL__ : '';
