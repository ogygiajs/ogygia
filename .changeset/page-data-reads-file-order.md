---
'@ogygia/compiler': patch
---

A server region whose tree reads `page.data` is now always marked as reading it. Before, the answer could follow the folder the app was built in: when the bundle listed a component's style module after the component, the region was marked as reading nothing and rendered without the page's data.
