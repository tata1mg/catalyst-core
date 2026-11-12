// Runs the real SSR handler in tests: maps @catalyst/template/* to test/fixtures/template and
// compiles .jsx. node --import ./test/support/handler-loader.mjs
import { register } from "node:module"

register("./template-hooks.mjs", import.meta.url)
register("./jsx-hooks.mjs", import.meta.url)
