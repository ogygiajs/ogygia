---
'@ogygia/compiler': patch
---

The client build also fails when it holds a signing secret written as an escaped string literal (a secret with a quote, backslash, newline, slash or non-ASCII character), not only the raw text.
