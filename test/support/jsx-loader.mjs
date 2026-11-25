// Lets `node --test` import catalyst's .jsx sources: node --import ./test/support/jsx-loader.mjs
import { register } from "node:module"

register("./jsx-hooks.mjs", import.meta.url)
