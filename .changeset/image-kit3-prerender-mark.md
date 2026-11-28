---
'@ogygia/image': patch
---

On SvelteKit 3, a prerendered page's `<Img>` now points at the real image files, and the build writes them: before, every prerendered image URL kept the build's mark host (`//<hex>.ogygia.invalid/...`) and no file was written, so each image 404'd. The server build's encoder and platform checks, share cards and remote image list now also run on Kit 3.
