# NATIVE-005

**Category:** NATIVE

## Message

A step needs your answer and there is no terminal to ask on

## Details

Native commands only ask questions when stdin and stdout are terminals and CI is not set. This step needs an answer: --yes confirms installs and downloads, --accept-licenses accepts licences, and creating a signing key always needs a person at a terminal.

## Suggested action

Pass the flag named in the message, or run the command in an interactive terminal.
