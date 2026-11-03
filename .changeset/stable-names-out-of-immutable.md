---
'@ogygia/core': patch
---

The stable-name files (`og-region.<id>.js`, `og-runtime.<id>.js`) move out of `<appDir>/immutable/` into `<appDir>/ogygia/`: their content follows each build, so a host serving `immutable/` for a year could hand a fallback load another build's code. The content-hashed files stay in `immutable/`.
