---
'@ogygia/cli': patch
---

`ogygia bisect` now measures the server it started: a commit's server is stopped and gone (SIGKILL after a grace time) before the next one starts, a port another process holds is refused as `cli_server_port_busy`, and a server that exits before it answers fails at once with its output as `cli_server_exited_early` (#250).
