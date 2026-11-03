---
'@ogygia/core': minor
---

Every file a build writes under `<appDir>/immutable/` is now named by its content, so a host's year-long rule for that directory can never serve another build's code: the stable-name files (`og-region.<id>.js`, `og-runtime.<id>.js`), whose content changed every build, are gone. An island's `entry` is now a name, not a file. The one file at a fixed name is `<appDir>/ogygia.json`, beside Kit's `version.json`: the current build's locations, which a page that outlived its build reads to wake its islands on the current code. Serve it as you serve `version.json` (revalidated); a federated app also needs the same `Access-Control-Allow-Origin` on it as on its `immutable/` files. A page cached from before content hashing, which loaded the runtime by its stable name, no longer recovers.
