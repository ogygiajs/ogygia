---
'@ogygia/content': patch
---

`@ogygia/content`: a `::: code-group` fence whose info starts with the fence character (`~~~ ~x [t]`) no longer swallows the tab wrappers after it, and a ` ``` ` line whose info holds a backtick is no fence inside `::: tabs` / `::: code-group`, as in CommonMark.
