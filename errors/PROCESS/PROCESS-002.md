# PROCESS-002

**Category:** PROCESS

## Message

A user-defined hook threw an error

## Details

A user-defined hook (e.g. onRouteMatch, onFetcherError, onServerError) threw. It was caught so the SSR pipeline keeps running; see the cause above for which hook and why.

## Recoverable

Yes — you can fix this and retry without restarting your workflow.

## Suggested action

Fix the error thrown inside the hook (see the cause above).
