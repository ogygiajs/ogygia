---
'@ogygia/core': patch
'@ogygia/router': patch
'@ogygia/devtools': patch
'@ogygia/postrender': patch
'@ogygia/federation': patch
---

The head's end is found as the browser reads it: an `app.html` that writes `</HEAD>` gets ogygia's head injections, and a `</head>` inside a head script's text (a JSON-LD string) no longer takes them into the script. The body's end is found in any case.
