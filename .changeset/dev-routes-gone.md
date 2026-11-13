---
'@ogygia/compiler': patch
---

In dev, deleting the app's last route file no longer throws `ENOENT ... scandir src/routes`: a routes directory that is not there holds no routes (#1496).
