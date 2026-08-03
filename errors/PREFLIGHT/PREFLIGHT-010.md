# PREFLIGHT-010

**Category:** PREFLIGHT

## Message

preServerInit named function should be defined in server/index.js

## Details

server/index.js must export a preServerInit function.

## Recoverable

Yes — you can fix this and retry without restarting your workflow.

## Suggested action

Export a preServerInit function from server/index.js, or remove the reference to it.
