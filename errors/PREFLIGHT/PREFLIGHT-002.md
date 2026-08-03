# PREFLIGHT-002

**Category:** PREFLIGHT

## Message

config export is not an object

## Details

The config folder must export a plain object.

## Recoverable

Yes — you can fix this and retry without restarting your workflow.

## Suggested action

Ensure config/config.json exports an object, not a string, array, or function.
