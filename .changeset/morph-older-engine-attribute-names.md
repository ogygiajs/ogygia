---
'@ogygia/core': patch
---

A region or page update whose markup carries an attribute name the HTML parser accepts but older browsers' `setAttribute` refuses (`@click`, `:class`, a name that starts with `-`) now applies in full instead of throwing partway through.
