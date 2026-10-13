# CLI output

Every Catalyst command prints through this layer, so the whole CLI reads as one
program rather than a dozen scripts that happen to ship together.

## The rule

Every command opens with `header("catalyst <command>", subject)` and prints
nothing at column 0 — every line starts with the two-space gutter, which means
child processes are always **piped, never inherited**. Progress is append-only:
each step is one `✓`/`✗` line, the only moving thing is the one-line spinner,
and anything printed while it spins goes through `progress.log` (it becomes a
dim `│` sub-line — only if it says something the `✓` line will not). Blank lines
separate _kinds_, not lines: steps stick together; a titled block (`Output`,
`Config`, `Notices`), the summary, and a diagnostic each get one blank line
before them. End with `✓ <result> in <time>` plus a dim line naming the next
command in cyan. Cyan marks the one thing to act on, green/red/yellow mark
state, dim marks structure, and the only glyphs are `✓ ✗ ▲ • › ├ └ │ ─`. Fail
through `diagnostic()`/`buildFailure()` on stderr with a non-zero exit, never a
raw stack.

## Why piped, never inherited

With `stdio: "inherit"` a child writes straight to the terminal at column 0.
The parent cannot indent it, cannot suppress it, cannot deduplicate it — and,
worst of all, never sees the text, so it cannot find the compiler error inside
it. Two parallel children with inherited stdio also interleave
non-deterministically.

Piping is what makes `extractBuildErrors` and `codeFrame` reachable. It is the
difference between:

```
  error  Command failed with exit code 1
```

and:

```
  error  gradle build
  Unresolved reference: viewBinding
  at MainActivity.kt:9:25

      8 │         super.onCreate(savedInstanceState)
  >   9 │         setContentView(viewBinding.root)
        │                        ^
```

When you pipe, forward `FORCE_COLOR` if the parent is a TTY — otherwise the
child sees a pipe and strips its own colour.

## The modules

| File             | What it owns                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `theme.js`       | Colours, glyphs, gutter, `header()`, `step()`, `row()`, `displayPath()`, `isVerbose()`   |
| `spinner.js`     | The single live line, plus `withSpinnersPaused()` for anything that must write or ask    |
| `diagnostic.js`  | `diagnostic()` for one failure, `buildFailure()`, `runtimeFailure()`, `verboseOutput()`  |
| `buildErrors.js` | Mines real errors out of gradle/xcodebuild/Vite output, incl. gradle's "What went wrong" |
| `hints.js`       | The short list of failures we can give real advice for                                   |
| `devOutput.js`   | Classifies a dev/production server's lines; `superviseServer()`, `ensurePortFree()`      |

## Default and --verbose

The default view keeps what someone acts on: steps, results, warnings, errors
and the one next command. Everything else -- a native build's narration
("Package.swift already up to date"), Vite's dependency bookkeeping, Node's
typeless-package warning -- is still produced, and `--verbose` prints it.

In the native builds that split is the `progress.log` level. `info` and
`success` are narration: they replace the spinner's detail text and leave no
line behind. `warning`, `error` and `note` always print; use `note` for the rare
line a person must act on or keep (a manual launch step, where a keystore was
written). On failure, `--verbose` adds the tool's full output, and `--debug`
adds stacks and the environment.

## Runtime errors

An error while the server is up -- a component that throws, a fetcher that
rejects -- is reported once per request through `runtimeFailure()`: the
registry code and route as the label, the first frame in the app's own code as
the location with its source, and no library frames unless `--verbose`. The
SSR handler is bundled into the app, so it cannot import this layer; the server
exposes the reporter as `globalThis.__catalystReportRuntimeError`. A repeat of
the same error prints one `✗ Same error again` line.

## Adding a hint

`hints.js` is deliberately short. A hint that guesses is worse than no hint —
it sends people down the wrong path with confidence. Add one only when the
pattern reliably implies the cause, and say what to **do**, not what went wrong;
the message above it already said that.

## Error codes

Codes come from the error registry, not from here. This layer decides only how
one looks: dim, beside the `error` label, ahead of the scope.

Advice has a precedence. A code we own carries an authored `suggestedAction`,
and that always beats a pattern guess from `hints.js`. The per-stage wrapper
codes (`BUNDLE-000`, `IOS-000`, `ANDROID-000`) are the exception: their action
only says to read the upstream error, which is the text `extractBuildErrors`
just recovered, so the mined hint wins instead.

That mining stays load-bearing. A wrapped toolchain error preserves the child
process object, whose message is `Command failed with exit code 1` -- the real
compiler error lives in the captured transcript, and nothing else recovers it.
So never add a `hints.js` entry for a failure that has an owned code; that
advice belongs in the registry.

## Prompts

A prompt and a progress sequence are opposite contracts: progress is output you
watch, a prompt is a region you drive. They must never overlap. Stop the spinner
before asking, and collapse the answered prompt to a single settled line
(`✓ Simulator  iPhone 15 Pro`) so the transcript reads as if it had always been
a step. In a non-TTY, never prompt — print a diagnostic naming the config key
and exit 1, because a prompt that waits forever in CI is the worst possible
output.
