# PROCESS-002

**Category:** PROCESS

## Message

A user-defined hook threw an error

## Details

A user-defined hook (e.g. onRouteMatch, onFetcherError, onServerError) threw. It was caught so the SSR pipeline keeps running; see the cause above for which hook and why.

## Suggested action

Fix the error thrown inside the hook (see the cause above).
