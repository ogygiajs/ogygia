---
'@ogygia/core': patch
---

A waking region no longer searches the whole page for a script that needs devalue: the page is asked once, and again only when new markup comes in, so a 250-region page spends about 0.2 ms on it instead of about 48 ms.
