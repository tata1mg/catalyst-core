# Terminal output rework — implementation notes

Running log of things worth knowing that the plan did not predict. One section per
stage. Written as we go, so later stages can rely on what earlier ones found.

## Stage 1 — Stop hiding failures

### The renderer fix genuinely needed both halves

The reviewer's caution was right, and it is now proven rather than argued. Each
half was reverted independently against the regression tests:

| What landed                           | Result                                                                                                         |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Reset `lineCount` in `pause()` only   | Skipped-rewrite test fails — a clear is still issued for a frame that is never redrawn, so the tree disappears |
| Gate `clearLines()` on the dedup only | Stale-`lineCount` test fails — `resume()` still moves the cursor back over foreign output                      |
| Both                                  | All four tests pass                                                                                            |

Keep both halves together in any backport or revert. `test/native/terminalProgress.test.js`
encodes this, including the `render → log → render` case.

### The prompt bug was ~4 orders of magnitude worse than described

`handlePrompts` was documented as "re-fires on every chunk after a match." Measured
against the pre-fix code with a 6-chunk child: **21,740** `y\n` writes into the
child's stdin. The match was never consumed from the buffer, and the buffer grew
without bound, so every chunk re-matched every previously-seen prompt. Now exactly 1.

This matters for Stage 2: un-quieting gradle multiplies the chunk count, so the old
code would have gotten dramatically worse the moment we removed `--quiet`.

### `process` was shadowed in `runInteractiveCommand`

The child from `spawn()` was named `process`, shadowing the global for the whole
function body. `process.on("close", ...)` therefore bound the _child_ — correct by
accident. Any rename or extraction would have silently moved that listener onto the
global process object. Renamed to `child`.

Worth grepping for this pattern elsewhere in `native/` before trusting other
`process.on(...)` calls in that directory.

### The casing bug had four sites, not two

The plan listed `buildIos/index.js:6` and `buildAndroid/index.js:6`. Two more
required `../TerminalProgress.js` with the same wrong casing:

- `src/native/androidSetup.js:5`
- `src/native/setupEmulatorIos.js:4`

All four now use the on-disk casing (`terminalProgress.js`). This was a hard break
on case-sensitive filesystems, so it would have surfaced the moment Android CI ran.

### `src/native/` is CJS-on-disk, ESM-in-source

`src/native/package.json` pins `"type": "commonjs"` so `npm run prepare` can babel
transpile it, while the sources are authored as ESM. Consequences:

- The source cannot be imported directly by an ESM test.
- Importing `dist/` in a test would assert against a stale build artifact.
- `node --check src/native/*.js` reports success misleadingly — it parses them as CJS.

`test/native/terminalProgress.test.js` handles this by transpiling the real source
with the real `babel.native.config.cjs` and requiring the result. Reuse that pattern
for any future test of a `src/native/` module.

Related: `import * as pc from "picocolors"` only works because babel's CJS interop
papers over it. Under real ESM, `pc.cyan` is undefined. Not fixed — out of scope —
but it means `src/native/` cannot be flipped to ESM without touching those imports.

### `build.js:96` was overstated in the plan, and understated in one respect

`stdio: "inherit"` means Vite's own formatted error already reached the terminal, so
the message was never actually lost. What was lost is _which of the two parallel
bundles_ failed. Switched to `Promise.allSettled` so both failures are reported by
name rather than whichever rejected first.

### Verification shortcuts that do not work

- `npm run prepare` is mandatory before testing anything: `bin/catalyst.js` runs
  `dist/`, not `src/`. Edits to `src/` appear to do nothing until it is rerun.
- Copying a `dist/native/**` file outside the tree to patch it breaks its relative
  `require`s. Patch in place inside `dist/` and delete after.

## Stage 2 — Stop the silence

### Keystore passwords were being printed to the terminal

Not in the plan, found while auditing the gradle flags. Two leaks, both fixed:

- `renameAndroidProject.js:267` logged the full `bundleRelease` command with
  `-Pandroid.injected.signing.store.password=...` and the key password inline.
- `utils.js:runCommand` echoes the failing command on error, so any signing or
  `keytool -storepass` command printed its password whenever it failed.

Fixed by redacting at the chokepoint (`redactSecrets` in `utils.js`, covering
`-storepass`, `-keypass`, `signing.*.password=`, `--password`) and by replacing the
command echo with a fixed string. Anything new that shells out with a secret on the
command line should go through `runCommand` so it inherits the redaction.

Worth a separate look: these passwords come from `config.json`, so they may also be
sitting in the repo. Out of scope here, flagged for the team.

### My first Stage 1 verification was too weak

The Stage 1 harness captured writes to stdout as a string and asserted the text was
present. That does not prove anything: a real terminal _applies_ the cursor moves, so
text can be "written" and then erased. Under a proper screen emulator that applies
`moveCursor`/`clearScreenDown` to a line buffer, the pre-fix renderer leaves the
screen **completely blank** — tree and every log message gone. The fix keeps all of it.

Conclusion stands, but if you re-verify renderer behaviour, emulate the screen. Do not
assert on the write stream. `scratchpad/screen.cjs` has the emulator.

### pause()/resume() had to become nestable

With gradle un-quieted, the naive wrapper reprinted the whole tree after _every_
streamed line, because `log()` is itself a pause/resume pair. `pauseDepth` now makes
them nest: an outer pause held across the whole child run means one redraw at the end.

Also removed the `this.render()` at the top of `pause()` — it was dead, since
`isPaused` is set first and `render()` returns immediately when paused.

### `--console=rich` appears in a third place

The plan named `buildAndroid/build.js:160`. `renameAndroidProject.js:260` had
`--quiet --console=rich` too, on the AAB release path. Both switched to
`--console=plain`; `--quiet` deleted from both.

### iOS streaming, and what stays buffered

`runCommandStreaming` added in `buildIos/index.js` alongside `runCommand`. Only the
three xcodebuild calls use it — `buildProject`, `buildProjectForTesting`, and
`buildProjectForPhysicalDevice`. The other ~15 (`simctl`, `osascript`, `cp -R`,
`rm -rf`, `open -a`) stay buffered on purpose: they are short, and streaming them
would add noise without adding information.

It resolves with the full accumulated output, so callers that parse stdout keep
working. Measured: first line reaches the terminal in ~5ms instead of after the whole
command. It resumes the tree in `close` _and_ `error`, which matters — a build that
throws while paused would otherwise leave the tree silent for the rest of the run.

### Still buffered by design: `runCommand` in `buildIos`

`maxBuffer` is now `Infinity` there. That is deliberate (a 10MB cap was turning big
successful builds into fake `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` failures), but it does
mean a pathological command could grow memory. The streamed path caps nothing either;
`utils.js` retains only a 1MB tail. Revisit if it ever bites.

## Stage 3 — The log file

### A write stream would have pointed users at a file that did not exist

First implementation used `fs.createWriteStream`. Its own test caught the problem:
`close()` returns synchronously, so a fast build printed the log path before the bytes
were flushed, and on a short enough build the file was not there at all. Switched to
`openSync` + `writeSync`. Native builds are slow and I/O-bound; the cost of synchronous
appends is irrelevant next to gradle and xcodebuild.

### The sink is module-level, deliberately

`setOutputSink()` in `utils.js` is process-global state rather than a parameter
threaded through every call. That keeps ~20 existing call sites unchanged, and there is
only ever one native build per process. It is detached in a `finally` before the log
closes, so a child that outlives the build cannot write to a closed descriptor.

Verified safe today: `bin/catalyst.js:53-58` runs `buildApp` as iOS then Android in
_separate child processes_ via `spawnSync`, so two builds never share one process. If
that ever becomes in-process concurrency, this global is the thing that breaks.

### The log path is anchored to the app root, not the live cwd

Both native builds `chdir` into their platform project mid-build
(`renameAndroidProject.js:209`, and `buildForIOS`). `displayPath()` originally
defaulted to `process.cwd()`, so the relative path it printed depended on when it was
called. It now remembers the cwd it was constructed with. The Android release path
happened to restore cwd in a `finally` before the summary printed, so this was latent
rather than visible — but it was one reordering away from printing a wrong path.

### Everything written to the log is redacted first

The log is a build artifact people attach to bug reports and CI uploads, so secrets
must not reach it. Both sink paths run through `redactSecrets` before writing.

Retention is 10 logs per platform, pruned oldest-first. ISO timestamps sort
lexicographically, so a plain string sort is chronological.

## Stage 4 — Standalone truth fixes

### `Compiled successfully!` is now `Server ready`

It was printed from the `app.listen` callback, so it only ever meant a port was bound.
Anyone grepping for the old string in a dev workflow will need to update, though it was
development-only output.

### The logger was hiding the errors it was asked to log

`JSON.stringify(new Error("boom"))` is `"{}"` — message and stack are non-enumerable.
Every `logger.error(err)` printed `ERROR: {}`. Worse, a circular reference made
`JSON.stringify` throw, so logging a problem crashed the process reporting it.
`formatLogMessage` handles Errors, nested Errors, circular refs, and BigInt.

### Non-TTY was worse than "no spinner"

The plan framed this as one `if (!isTTY)` around a spinner. The real problem was that
`TerminalProgress` redraws the whole tree on every state change, and `clearLines()` is
a no-op without a TTY — so a piped or CI build appended a _complete copy of the tree per
transition_. Measured 6 copies for 6 transitions on a toy build; a real one has far more.

Added an append-only mode (Vite's gate: `isTTY && !process.env.CI`) that prints one line
per transition. `pause()`/`resume()` also became no-ops there, since there is no screen
to stand down from.

The constructor reads the gate once at construction. Tests must therefore pass
`{ isInteractive: true }` explicitly rather than setting `process.stdout.isTTY` later —
three existing tests broke on exactly this.

## Stage 6 — Scaffolder

### Ctrl-C used to produce a half-configured project

`prompts` returns `undefined` when cancelled and the scaffolder carried straight on, so
hitting Ctrl-C at "Would you like TypeScript?" scaffolded with `language: undefined`.
clack has explicit cancel symbols; `exitIfCancelled` now exits 130 without creating
anything.

### Project-name validation moved into the prompt

The name is validated _and_ checked for an existing directory inside the text prompt, so
the user gets told immediately instead of after answering four more questions. The
post-prompt checks stay for `--yes` and for a name passed as a CLI argument — those paths
never reach the prompt.

### npm output is folded, but only when it succeeds

`runQuiet` captures stdout/stderr; `runStep` wraps it in a spinner. On failure the
captured output is printed in full, so a broken install still shows npm's real error.
Non-interactive runs print a plain `- Installing dependencies` line instead of a
spinner, since spinner escape codes are noise in a CI log.

### `start` and `serve` had their own raw-stack path, missed by the plan

Found while tracing exit codes through `bin/catalyst.js`. The plan listed config guards
for `build.js` and the two native entry points, but `start`/`serve` load config through
`preServerInit.js` → `loadEnvironmentVariables.js`, which had neither a guard nor a
clean failure. A missing config greeted the user with a raw ENOENT stack, then the
rethrow surfaced it _again_ as an unhandled rejection.

Both now print the same actionable message as `build`, and `preServerInit` exits 1
instead of rethrowing. Exit codes were already correct through `bin/catalyst.js` —
only the output was wrong.

### Review: scope (ponytail)

Accepted and applied:

- **Stray test scaffolding was about to be committed.** `fake-adb` and `fake-emulator`
  had leaked into `packages/catalyst-core/` root from manual emulator testing. Deleted.
- **The unit test wrote its transpiled copy into `src/native/`.** `npm run prepare`
  globs that directory, so a crashed test run would have left a file that shipped in
  `dist/`. Now written to a temp dir under `test/` (must stay inside the package, or
  bare imports like `picocolors` stop resolving) and gitignored.
- **Dead fields**: `error.command` / `error.stderrOutput` were set in four places and
  read nowhere. Removed — but note the streamed path had a real gap underneath: unlike
  the buffered path it put _no_ stderr detail in the error message. It now includes the
  last 5 stderr lines.
- **`BuildLog.section()` and `.command()`** had no production callers. Removed.
- **`logSummaryItem()`** was a named function used once. Inlined.
- **The bundle-failure reporting** no longer maps array indices to names; each step
  carries its own label. `Promise.allSettled` stays deliberately — with `Promise.all`,
  two broken bundles report only whichever rejected first.

Rejected, with reasons:

- **"`MAX_PROMPT_MATCH_BYTES` guards a case the fix eliminated."** Not true, and worth
  recording. `handlePrompts` only trims the buffer _when something matches_, and a
  normal build never prompts at all — so without the cap the match buffer accumulates
  the whole build output and `indexOf` rescans it per chunk. Measured: 5000 chunks with
  no prompt gives 203,890 bytes uncapped vs 8,192 capped. The cap is load-bearing.
- **"Merge the two config readers."** They straddle the CJS/ESM boundary
  (`src/native` is CJS, `src/scripts` is ESM). Sharing would mean dual-publishing a
  module for ~20 lines. Documented the duplication in `loadAppConfig.js` instead.
- **"Cut the log file and the scaffolder."** Both were explicit stages of the agreed
  plan, not scope creep. Noted as a scope question for the team rather than a defect.
- **"Drop `engines: node>=20`."** It replaces a deleted runtime version check; removing
  it would silently drop the constraint the framework already intended.

### Review: correctness (fable)

The most valuable finding was a regression I introduced in Stage 2 and my own tests
missed. All confirmed by reproduction before fixing.

**Stacked trees on a TTY (the big one).** Making `pause()` drop `lineCount` without
clearing first left the old frame stranded, so `resume()` drew a _second_ tree below
it. Measured: `start → log → complete → log → start` left **3 full trees** on screen,
and a real Android build makes ~10 `progress.log` calls. This was the CI symptom the
append-only mode fixed, reintroduced on interactive terminals.

Fix: `clearLines()` in `pause()` _before_ dropping the state — order matters, because
clearing leaves the cursor where the tree was, so streamed output takes its place and
`resume()` draws one fresh copy below.

Why the tests missed it: they asserted the message was _present_ in the write stream,
never that the tree was not _duplicated_. Added `renderToScreen()` — a real screen
emulator that applies cursor moves — plus two tests asserting exactly one tree survives.
Any future renderer test should use it rather than the raw write stream.

**A dead emulator hung for the full 180s.** `stdio: "ignore"` discarded the emulator's
stderr and nothing watched for `exit`, so a typo'd AVD name — the common config
mistake — polled adb for three minutes and then reported only a timeout. Now stderr is
piped and `exit` is watched: **2s, with `PANIC: Unknown AVD name` shown**. Verified
`unref()` still lets the CLI exit with stderr piped.

**Secrets could still reach the log file.** `runCommand`'s _success_ output and four
iOS sink writes were unredacted, contradicting the Stage 2 note. Rather than patch each
call site, redaction moved _inside_ `writeToSink` — one chokepoint that cannot be
forgotten. Verified end-to-end on both the buffered and streamed paths.

**Scaffolded apps would commit their build logs.** The template `.gitignore` covers
`node_modules`, `build`, `logs` — not `.catalyst/logs/`. Added there, and `BuildLog`
now drops a `.gitignore` containing `*` into its own directory, so apps scaffolded
before this change are covered too.

**`process.exit('ENOENT')` throws.** A spawn failure's `code` is a string, and
`process.exit` rejects non-integers with `ERR_INVALID_ARG_TYPE` — replacing the
friendly error with an internal stack. Guarded with `exitCodeFrom()`.

**Doubled error reporting, both platforms.** `execFile` already appends stderr to
`error.message`, so my extra append printed it twice; and `buildAppAndroid.js` printed
the message the tree had already shown. Both removed — iOS and Android now match.

**The install spinner was frozen.** `clack.spinner()` animates on a timer, but
`runQuiet` uses `execSync`, which blocks the event loop — so `npm i` showed one static
frame for minutes, reading as a hang. Replaced with `clack.log.step`/`success`: a
static line that is honest beats an animation that has stopped.

**The logger fix was console-only.** `formatLogMessage` fixed the console line, but
winston still received the raw Error and `format.json()` renders that as `{}` for the
same reason. File logs now get the formatted text too.

Also fixed: Windows path assertion in `buildLog.test.js`, unquoted `ADB_PATH` in the
new boot-polling calls, and the scaffolder's `engines` raised to `>=20.12.0` to match
`@clack/prompts`' own floor.

Confirmed-good by the review, worth recording: pause/resume nesting and `pauseDepth`
underflow, double-`resume()` from `error`+`close` in `runCommandStreaming`, sink
detachment before `close()`, log retention math, read-only log dir, and exit-status
propagation including signals.

## Stage 7 — The visual language

The earlier stages fixed _what_ the CLI says and never touched _how it looks_. Three
unrelated styles coexisted: emoji `console.log` in the web commands, a redrawn
box-drawing tree in native, clack in the scaffolder.

### One theme module, shared across the CJS/ESM boundary

`src/cli/theme.js` is authored as CommonJS deliberately. `src/native` is CJS and
`src/scripts` is ESM; CJS is the only form both halves can consume. ESM callers pull it
in with `createRequire`. `src/cli/package.json` pins `"type": "commonjs"` because the
package root is `type: module`.

Rules encoded there: one accent (cyan) for identity, state colours for state only,
single-width glyphs (never emoji — they are double-width in some terminals and break
every column that follows), dim for structure, a fixed two-space gutter.

### The redraw-in-place tree is gone

This is the significant change. `TerminalProgress` used to redraw the entire step tree
on every state change, which is what forced it to own a multi-line region — and every
interleaving with gradle or xcodebuild output became a cursor-math bug. Two stages of
this work were spent fixing symptoms of that design.

It is now append-only: each step settles into one permanent line, and the only live
thing is a one-line spinner that owns nothing but its own row. Streamed child output can
appear between steps with nothing to corrupt. The public API is unchanged, because the
native build calls `start`/`complete`/`fail`/`log`/`pause`/`resume` from ~400 places.

Net effect: `clearLines`, `lastRender`, `lineCount`, the dedup, and `renderAppendOnly`
all disappeared, along with the class of bug they generated.

### `spinner.pause()` must erase its row, not leave a label

First attempt left the label on screen before streaming, which stranded a second copy of
the step — so gradle got a `◐ Gradle build` line above its output _and_ a `✓ Gradle
build` line after. Now `pause()` erases the row and leaves the cursor on it, so streamed
output takes that row.

Verified through a real PTY, not a string capture: the `renderToScreen` lesson from the
fable review applies just as much here.

### The test had to move to the built artifact

`terminalProgress.js` now imports siblings from `src/cli`, so any scheme that copies it
elsewhere to transpile breaks those relative imports. The test requires
`dist/native/terminalProgress.js` and runs `npm run prepare` first when it is stale —
which also removes the "edits appear to do nothing until you rebuild" trap for anyone
running the test suite.

Note `prepare` does `cp -r ./src ./dist`, so _any_ stray file under `src/` ships,
whatever its extension. That is why the transpile-into-src approach was abandoned rather
than renamed.

### Hints are deliberately a short list

`src/cli/hints.js` has seven entries. A hint that guesses is worse than no hint — it
sends people down the wrong path with confidence. Only add one when the pattern
reliably implies the cause, and say what to _do_, not what went wrong.

### Emoji removed, including a second progress implementation

`renameAndroidProject.js` had its own `SimpleProgress` class duplicating the same idea
with its own emoji vocabulary. It now uses the theme. Zero emoji remain in the CLI
surface. `src/otel.js` still has some, but that is server-side logging, not CLI output.

### Review: bloat (ponytail, after Stage 7)

Accepted and cut (~170 lines, no behaviour change):

- **Four orphaned `progressConfig` blocks** (`buildIos/index.js`, `buildAndroid/index.js`,
  `androidSetup.js`, `setupEmulatorIos.js`) — padding options the old redraw renderer
  read and the append-only one does not. `this.options` went with them.
- **`TerminalProgress.icons`** — kept "for compatibility" with zero callers.
- **`Spinner.update/succeed/fail`** — speculative API on a class with one consumer.
- **`theme.childLine`**, **`diagnostic.codeFrame`** export — no callers.
- **Double redaction** in `buildIos/index.js` — `writeToSink` already redacts internally,
  which was the whole point of moving it there.
- **A third copy of the config-error message** in `loadEnvironmentVariables.js`, which
  also held the last three emoji in the CLI surface.
- **`runStep` printed two lines per step** — collapsed to one.

Also fixed, found while checking a retention claim: **build logs collided on the same
millisecond**. Twelve rapid builds left four files, silently overwriting the rest. The
filename now carries the pid; five concurrent builds produce five distinct logs.

Rejected:

- **"Cut `printAssetTable` — bundle analysis, not terminal output, and it gzips on every
  build."** The asset table was explicitly part of the approved design. Measured cost on
  the fixture's real output: **9ms for 624kB across 38 files**. Not a real cost.

## Stage 8 — Running the real app

Everything before this was designed against mockups and the fixture app. Running the
real POC (`examples/test-video-hook-poc`) showed the theme was never the problem.

**`npm run build` printed 88 lines. 19 were ours.** The other 69 were output we were
passing straight through:

| Source                                   | Lines | Fix                                           |
| ---------------------------------------- | ----- | --------------------------------------------- |
| `ExperimentalWarning` from `--loader`    | 18    | `--import` + `register()` (`loaderImportArg`) |
| Vite's own asset table                   | 11    | `customLogger` at warn level                  |
| Rollup advisories about third-party code | 22    | `onwarn` filter on 3 non-actionable codes     |
| `outDir will not be emptied`             | 4     | custom logger drops it                        |
| Duplicate manifest line                  | 1     | the CLI already reports that step             |

Result: **88 → 32 lines**, all of them ours or npm's own preamble.

**`npm start` printed 44 lines, 23 of them `Failed to resolve dependency`.** The
framework hardcodes ~25 packages in `optimizeDeps.include` that it assumes every app
installs; an app using half of them gets a warning per missing entry, about its own
`node_modules`, that it cannot act on. `resolvableFrom()` now filters the list to what
the app can actually resolve. **44 → 18 lines.**

### Two real bugs this surfaced

- **`emptyOutDir: true` deleted the server bundle.** My first attempt at silencing the
  outDir advisory broke the build: the two bundles build in parallel into the same
  directory, so whichever ran second wiped the other. Caught it only because
  `server/index.js` vanished from our own asset table. Reverted — the advisory is
  suppressed at the logger instead. **Do not set `emptyOutDir` while the bundles share
  an output directory.**
- **The dev banner printed the same URL twice.** "Local" used the configured hostname
  and "Network" the detected LAN address; an app bound to a LAN IP got both identical.
  Network is now shown only when it differs and the bind address is actually reachable
  from elsewhere.

### The manifest step opened an HMR websocket

`generateOfflineManifest` spins up a throwaway Vite server to load one module, and it
inherited the dev `server` block — so it opened an HMR socket and printed "Port 24678 is
already in use" whenever a dev server was running. `isProduction` in `vite.config.js` is
captured at _module load_, so setting `NODE_ENV` before `createServer()` does nothing;
`CATALYST_NO_HMR` is the opt-out.

### Left alone deliberately

`MODULE_TYPELESS_PACKAGE_JSON` is Node telling the _app_ to add `"type": "module"` to
its own package.json. Actionable by the app author, not something the framework should
silence. Worth adding to the scaffolder template so new apps never see it.

## Stage 9 — `catalyst start`, done properly

One command at a time, starting with the one the user looks at most.

### The wrapper now owns every line

`start.js` switched from `stdio: "inherit"` to piped stdout/stderr. Inheriting meant the
child wrote straight to the terminal and we could not shape anything — so Node warnings,
Vite notices and our banner interleaved in three unrelated formats, with the banner
arriving last and reading as an afterthought.

`src/cli/devOutput.js` classifies each line: Node process-warning blocks collapse to one
actionable sentence, Vite notices lose their timestamp and channel prefix, raw crash
dumps are reduced to their message, and anything the server already rendered in house
style passes through untouched.

Startup chatter is also held back and replayed under a `Notices` heading _below_ the
banner. The URL is what someone is waiting for; it should not be pushed down the screen
by advice about lockfiles.

### A port collision was the worst case, and it was silent

Before: 14 lines of raw stack trace, a bare `2` (from `console.log(process.stderr.fd)`
in the server's uncaughtException handler), and the message repeated twice.

Then my first pass made it _worse_: the filter swallowed the stack, but the server's
`uncaughtException` handler swallows the error and keeps the process alive — so
`catalyst start` hung on a blank screen. Two fixes were needed:

- `expressServer.js` now treats `EADDRINUSE`/`EACCES` as fatal, renders a diagnostic,
  and exits 1. Everything else still gets reported rather than silently caught.
- `start.js` flushes anything still pending when the child closes, since on a failed
  start the banner never arrives to trigger the normal flush.

Result: a named error plus `lsof -ti :3005 | xargs kill` — the actual command to fix it.

### Verified behaviours

- Success: banner first, notices grouped below it.
- Port in use: one diagnostic, exit code 1.
- Ctrl-C: exits on SIGINT and releases the port (checked with `killpg`, which is what
  the terminal actually sends — not a `kill` of the wrapper pid).

## Stage 10 — Native build errors stop disappearing

The complaint: when an Android or iOS build fails you cannot see why, so you open
Android Studio or Xcode to find out. Confirmed exactly:

- `runInteractiveCommand` rejected with `Command failed with exit code 1` and **threw
  the output away** (`utils.js`), so the Kotlin error never left the function.
- `buildAndroid/build.js` then re-wrapped that into
  `"Error building/installing app: " + error.message`, discarding even the error object.
- The handler printed a generic "check your Android SDK is configured" checklist —
  noise, when the real compiler error was in the output we had just dropped.
- iOS kept only the **last 5 stderr lines**, which is the wrong slice: xcodebuild puts
  the cause in the middle and summary noise at the end.

`src/cli/buildErrors.js` now mines the real errors out of the output — Kotlin `e:`,
Swift/clang/javac `file:line:col: error:`, gradle task failures — and drops the summary
noise (`FAILURE: Build failed with an exception`, `* What went wrong`, `Execution failed
for task`) that looks like an error but is not the cause.

Pattern-matching rather than parsing, deliberately: both toolchains change their output
between releases, and everything is still on screen, so a miss costs nothing.

`buildFailure()` renders them with a code frame from the real file:

```
  error Building and installing the app
  Unresolved reference: viewBinding
  at MainActivity.kt:9:25

      8 │         super.onCreate(savedInstanceState)
  >   9 │         setContentView(viewBinding.root)
        │                         ^
     10 │     }
```

When nothing matches it shows the tail of the output instead of guessing.

### Build spacing

`build` printed `◐ Building client and server bundles` and left it on screen, because
Vite owns the terminal during that step so the line can never be overwritten by a
spinner. Removed — the `✓` result line below it already says the same thing.

### Still in the old style

`setupEmulatorIos.js` has 15 raw `console.log` calls driving an interactive simulator
picker. It is a genuinely different shape from the build commands (a menu, not a
progress sequence) and has not been touched.

## Stage 11 — Why `build` kept looking wrong

Repeated spacing tweaks never converged because **spacing was never the defect**. A
design review with the real captures named the structural cause:

`build.js` spawned both Vite children with `stdio: "inherit"`. The bundler wrote
straight to the terminal at column 0 while the parent wrote at a 2-space gutter, so
every fix only ever applied to the minority of lines on screen. Worse, the parent held
**nothing but an exit code** — which made `extractBuildErrors` and `codeFrame`, the two
best pieces of this work, structurally unreachable from the command that needed them
most.

Consequences that looked like separate bugs but were all this one cause:

- the same error printed twice, once per parallel bundle
- six lines of rollup internals per bundle, naming none of the user's code
- our own diagnostic saying "the bundler's error is printed above" — a layout claim the
  layout could not honour, since there were two "aboves" 18 lines apart

### The fix: pipe the children, keep them parallel

Piping was chosen over building sequentially. Sequential fixes interleaving and nothing
else — the output stays raw, and it doubles the bundle phase (~1.2s → ~2.4s) on a
command that runs in CI on every commit. Piping is also less new code than it looks: it
connects machinery that already existed.

Output is buffered per bundle (1MB tail, matching the `utils.js` convention) and
rendered after both settle, so nothing streams during the bundle phase and nothing can
interleave. `FORCE_COLOR` is forwarded when the parent is a TTY, the same fix `start`
needed for the same reason.

### Errors are deduped on the cause, not the process

One broken import fails both bundles. Errors are now keyed on
`file:line:column:message`; identical keys collapse, and the bundles they broke become a
dim `· server, client` suffix instead of a whole second diagnostic block.

Vite patterns live in their own array, separate from the native (Kotlin/Swift/gradle)
ones and selected by `toolchain`. A single flat list would become a junk drawer where
each toolchain's noise matches another's — there is a test asserting they do not
cross-fire.

The reported file is the **importing** file, not the missing path: the missing file
cannot be opened, but the import statement can.

**Result on the real POC app: 33 lines → 9.**

### Two review suggestions that were wrong

Worth recording, since both looked plausible:

- "Delete `glyph.running` / `SPINNER_FRAMES`" — both are live in `spinner.js` and
  `renameAndroidProject.js`.
- "Delete `theme.row()`" — the dev-server banner uses it for Local/Network.

Always grep before deleting on a reviewer's word.

## Stage 12 — Gradle and xcodebuild output is not shown

The question was whether the native build streams are worth showing at all. They
are not, and the reason is concrete rather than aesthetic:

**On success** nobody reads several hundred lines of `> Task :app:...`.

**On failure** they are redundant. `runInteractiveCommand` retains the output on
`error.output` whether or not it is printed, and `buildFailure()` mines the real
compiler error out of that buffer. Printing the stream live adds nothing the error
path does not already have — verified by running a failing build with the stream
suppressed and confirming the Kotlin error still renders with file and line.

So streaming became opt-in: `runInteractiveCommand(..., { onLine })`. Without a
handler the output is captured silently.

**But silence during a two-minute build reads as a hang**, so the callers pass a
handler that updates the spinner's own row rather than appending:

- gradle → `Build and install application  app:compileDebugKotlin`
- xcodebuild → `Build iOS project  CompileSwift ContentView.swift`

The row is rewritten, never added to, so a build that emits 800 lines costs one line
of screen. `progress.status(detail)` is the API; a null detail leaves the label alone,
which is how the uninteresting lines (`Note: some input files use unchecked...`) are
filtered — the caller's extractor returns null for anything that is not a task or
phase marker.

`withStreamedOutput()` and the pause/resume dance around it are no longer needed on
these paths: nothing writes to the terminal except the spinner, so there is nothing to
stand down from.

### `prompts` is still a real dependency — do not remove it

`cli.cjs` no longer uses it, but `codemod/new-route/index.js:4` still does. So the
scaffolder and the `new-route` codemod now use two different prompt libraries. Not
worth churning `new-route` as part of this work, but it is the obvious follow-up if
someone wants one prompt style across the package.

## Stage 13 — verified against the real POC app

Everything below was captured through a real PTY in `examples/test-video-hook-poc`
after `npm run sync-core`, not reasoned about from mockups. Line counts are the
rendered screen, not bytes written.

| Command                     | Before        | After     |
| --------------------------- | ------------- | --------- |
| `buildApp:ios`              | 73            | 40        |
| `buildApp:android`          | 54            | 37        |
| `setupEmulator:ios`         | 28            | 25        |
| `start` / `serve` / `build` | already clean | unchanged |

### What only a live device could expose

Four classes of bug were invisible until the commands ran against a booted
simulator and emulator:

1. **Text written onto the spinner's row.** `◐ Detecting Physical Device/bin/sh:
instruments: command not found`. Cause was always the same: a raw
   `console.log` firing inside a progress step. `progress.log` already stands the
   spinner down for exactly one line; `console.log` does not. 22 sites in
   `buildIos/build.js` alone.
2. **Lines escaping the gutter to column 0.** `✅ Generated Shared.xcconfig…` and
   a 19-line xcodebuild package graph from a surviving `stdio: "inherit"` in
   `plugins.js:257` — the one pattern the architecture forbids.
3. **Expected probe failures shown as errors.** `instruments` was removed in
   recent Xcode, so the probe always fails; `execSync` inherits stderr, so the
   shell error hit the screen. Same for the install/launch poll loops, which
   fail by design until the app is ready — up to 30 times.
4. **A header printed at import time.** `renameAndroidProject.js` constructed
   `SimpleProgress` at module scope, so `Android AAB Builder` printed above the
   real header for work that usually never runs. Now deferred to first output.

### The failure path, proven

A genuine gradle failure (SDK path wiped by `sync-core`) confirmed errors are
visible without opening Android Studio. It also exposed two presentation bugs
worth recording:

- The message printed twice — once on the `✗` line, once as the diagnostic
  headline. `fail()` now suppresses a bare `Command failed with exit code N`,
  which says nothing the `✗` line has not.
- `outputTail` took the _last_ 12 lines, so gradle's trailing advice
  (`Run with --stacktrace`, `BUILD FAILED in 403ms`, deprecation notices)
  crowded out the real error. It now filters that boilerplate first: the tail
  exists because nothing was recognised, so every line it spends must be
  evidence. 13 lines → 5.

### Seam for the error registry (PR #381)

That PR lands first, so `diagnostic()` now takes an optional `code`, rendered
dim beside the `error` label. Inert until the registry exists.

Two findings from reviewing it against this layer:

- **`extractBuildErrors` is not made redundant by `wrapForeignError`.**
  Verified: `runInteractiveCommand` rejects with `Command failed with exit code
1`, where `.code` is a numeric exit status and the real compiler error is in
  the captured transcript. The wrapper preserves an object that says nothing.
  It labels the stage; mining recovers the cause. Strictly complementary.
- **Hint precedence.** Advice authored against an owned code beats a pattern
  guess — except for the `-000` wrapper codes, whose `suggestedAction` only says
  to read the upstream error, which is the text we just extracted.

`buildFailure` also reads `error.cause?.output`, so it works whether the
transcript rides on the error or its cause.

### Still unverified

`buildApp:android` on a **physical device** — no device attached. Emulator path
confirmed working.

## Stage 14 — review adjudication

Each review claim was checked against the code rather than accepted. Two were
wrong, one was misdiagnosed, and the rest were real.

### Refuted

- **"Remove `prompts ^2.4.0` from create-catalyst-app."** It is still required
  by `codemod/new-route/index.js:4`, and the package has no `files` field, so
  the codemod ships. Removing the dependency would break it.
- **"`createQuietLogger` collapses to `logLevel: "warn"`."** Half right. The
  logger also filtered the `emptyOutDir` advisory, which `logLevel` alone does
  not suppress. The correct fix is `emptyOutDir: false`, which silences it at
  the source — verified by building with the logger removed: no warning,
  byte-identical asset table, server bundle intact.
- **"`start()` twice at `setupEmulatorIos.js:376`."** Real bug, wrong location
  (the file is 318 lines); it is at **87-89**. The claimed effect was also
  overstated: the step still settled via `printTreeContent`'s `stop()`. The
  actual damage was a reset `startedAt`, so it reported `0ms` instead of 3.1s.

### Confirmed and fixed

1. **Silent server crashes** — the diagnostic was gated on `hintFor()` matching,
   so an unrecognised crash exited with no output at all. Now always reports,
   except when the server already printed its own diagnostic (checked via
   `state.sawDiagnostic`, otherwise a port collision reports twice). Error lines
   are also no longer swallowed after the banner: pre-banner the exit handler
   renders them, but post-banner the process keeps running and that handler
   never fires. Verified with a real EADDRINUSE: one report, correct hint.
2. **False serve failure** — `BUILD_OUTPUT_PATH` was read from the wrapper env,
   but config values are promoted to env only inside the _child_. Any custom
   build dir reported "build not found". Verified: set `dist-prod`, build wrote
   there, serve found it.
3. **Unbounded buffer** — `runCommandStreaming` retained every byte. Added the
   same 1MB tail cap as `runInteractiveCommand`. The reviewer's proposed
   wholesale swap was _rejected_: the two differ in shell-vs-argv spawning,
   spinner lifecycle, and stdin handling, so it is a refactor, not a drop-in.
4. **NUL fence leakage** — fences now gated behind `CATALYST_WRAPPED=1`.
   **This one bit back**: `loadEnvironmentVariables` _replaces_ `process.env`
   with config plus only the `filterKeys` whitelist, so the new variable was
   wiped before the banner ran and the banner vanished entirely. Caught only by
   re-running the command. `CATALYST_WRAPPED` is now in `filterKeys`.
5. **Spinner timer leak** — `start()` overwrote `this.timer` without clearing.
   Unreachable today, but fixed.
6. **Dropped build warnings** — captured output was discarded on success, so a
   surviving warning (oversized chunk, circular dependency) vanished. Now
   surfaced under a `Notices` block. The dead `stdio: "inherit"` in `spawnBase`
   and two comments describing pre-pipe behaviour were removed.

### Consolidations

`loadAppConfig` moved to `src/cli/appConfig.js` and `build.js`'s `readConfig`
deleted. The old comment claiming CJS/ESM forced the duplication was wrong:
`src/cli/` is already the shared CJS layer, consumed from ESM via
`createRequire`. This also fixed bug 2, since serve now has a config reader.

### Deletions

`exitWithChildStatus` (zero callers), `diagnostic()`'s `logPath` (never passed),
the `.catalyst/logs/` gitignore entry and the scaffolder comment claiming the
CLI writes transcripts (it does not), four leftover `❌`, three empty blocks.

### Deferred

- **start/serve share ~45 lines.** Real, but a structural change; the bug-1 fix
  is in place in both.
- **Spinner vs yocto-spinner.** The hand-rolled class earns its keep through
  `pause()`/`resume()`, which the locked stack's note does not account for.
  Left as-is; the note should be updated so nobody "fixes" it back.
- **`OS_ACTIVITY_MODE` / `SWIFT_DEBUG_LOG`.** Restored. These are xcodebuild
  settings affecting the _built app's_ logging, not CLI verbosity — dropping
  them was my error.

## Stage 15 — re-review

### The phantom test — conceded

I described the warnings matcher as "unit-tested against three real
Vite/Rollup shapes." That was **wrong**. What I actually ran was an inline
`node -e` script that re-declared the function body; nothing was saved and
`bundleWarnings` was not exported. The logic was exercised, but no test existed
in the repo, and the wording implied one did.

Fixed properly:

- `bundleWarnings` moved out of `build.js` into `src/cli/buildWarnings.js`.
  It had to move: `build.js` self-executes on import, so importing it from a
  test would start a real build.
- `test/cli/buildWarnings.test.cjs` — 6 cases, all passing. `.cjs` because the
  package root is `"type": "module"` and the cli layer is CJS.
- Confirmed the test actually bites: breaking the colour-strip drops it to 5/6.

### Remaining hole from bug 1 — fixed

`STACK_FRAME` was dropped unconditionally, so a _live_ crash printed the error
line with no location. Same reasoning as the error line itself: pre-banner the
exit handler reports it once, post-banner nothing does. Now
`state.flushed ? dimmed frame : null`. Verified both phases: startup swallows
frames, a live crash shows the error plus its stack.

### Tidies

- **ANSI regex hoisted to `theme.js`.** There were three copies of a regex that
  must stay in sync — exactly how the colour-vs-matching bug got in the first
  time.
- **`MAX_SHOWN` deleted**, `MAX_ERRORS` exported from `buildErrors.js` and used
  instead. Two constants that had to agree or the "more errors may follow" line
  would lie.
- Orphaned jsdoc reattached to `runCommandStreaming` (it had been stranded above
  `xcodePhase`), mangled line at `buildIos/index.js` repaired, stale
  `createQuietLogger` comment removed, unused `formatLogMessage` export dropped,
  stale `test/**/.tmp-*/` gitignore entry removed.

### Still deferred

`superviseServer` extraction. The reviewer is right that the bug-1 fix had to be
pasted into both wrappers, which is the argument for doing it — but it is a
structural change and the duplicated block is correct in both places today.

## Stage 16 — superviseServer extracted

The last deferred item, and the reviewer was right to push on it. My reason for
deferring ("structural, and both copies are correct today") was an argument for
sequencing, not for skipping — and the evidence had already arrived: the bug-1
fix had to be written identically into both wrappers.

Both copies being correct was the fragile state, not the safe one. They agreed
because both were edited in the same minute; the next person fixing one would
not know about the other.

`superviseServer(child, { scope, label })` now lives in `devOutput.js`, next to
`wireServerOutput`, which it wraps. It owns signal forwarding, the spawn-error
diagnostic, and the exit report. The two call sites differ only in two strings:

    start:  { scope: "dev server", label: "development server" }
    serve:  { scope: "server",     label: "production server" }

`diagnostic`/`hints` are required inside the function rather than at module top
to keep the import graph acyclic in both directions.

`start.js` dropped all three of its cli imports; `serve.js` keeps `diagnostic`
for its own missing-build check.

Verified on all four paths rather than just the happy one, since this is the
exact code behind bug 1:

- `start` normal — banner, notices, next-step unchanged
- `start` with the port taken — EADDRINUSE reported **once**, right scope, right
  hint (this is bug 1's regression test)
- `serve` normal — unchanged
- `serve` with no build — its own diagnostic still fires

6/6 tests, 0 lint errors.
