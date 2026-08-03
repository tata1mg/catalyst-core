# PROCESS-001

**Category:** PROCESS

## Message

preServerInit threw an error during server startup

## Details

The preServerInit hook failed. Note: server startup currently continues despite this error (tracked separately as a fix — see issue #298); this code only identifies which hook failed.

## Recoverable

Yes — you can fix this and retry without restarting your workflow.

## Suggested action

Fix the error thrown inside your preServerInit hook (see the cause above).
