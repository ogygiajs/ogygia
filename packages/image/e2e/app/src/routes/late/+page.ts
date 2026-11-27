declare const __IMAGE_E2E_STATIC__: boolean;
declare const __IMAGE_E2E_LIVE__: boolean;

export const prerender = __IMAGE_E2E_STATIC__ && !__IMAGE_E2E_LIVE__;
