---
'@ogygia/machine': patch
---

The wait between two tries of a send (an outbox's, a `flights({ retry })` run's) keeps a Node process alive, so a process with nothing else to do no longer exits mid-retry and loses the send (#351).
