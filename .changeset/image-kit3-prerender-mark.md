---
'@ogygia/image': patch
---

On SvelteKit 3, a prerendered page's `<Img>` now points at the real image files, and the build writes them: before, every prerendered image URL kept the build's mark host (`//<hex>.ogygia.invalid/...`) and no file was written, so each image 404'd. Share cards and the remote image list in server chunks now also work on Kit 3.
On SvelteKit 3, the build now runs the encoder and platform checks, which it skipped before: an app with sharp missing now fails the build with `image_sharp_missing`, an app on Cloudflare with no encoder chosen with `image_option_invalid`, and a platform encoder on another adapter with `image_option_invalid` (`cloudflare()`) or `image_vercel_config` (`vercel()`).
On SvelteKit 3, a `vite build --watch` rebuild now names the image files a build has already made (the last build's, remote images and share cards included, and the warmed ones), instead of keeping the build's mark; a rebuilt prerendered page that names an image file no build made (a new image, a new remote URL or share card, or new options on one) now stops the rebuild before the adapter with `image_watch_rebuild`.
