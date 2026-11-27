import { expectTypeOf, test } from "vitest"
import { split, type SplitComponent } from "../../src/web-router/components/Split.js"

// Type-level: the rendering-mode statics documented in Rendering Modes can be set on a split()
// wrapper (tsc -p tsconfig.test.json checks this file; the runtime assertions are trivial).
test("split() wrappers accept renderMode and pprFallback", () => {
    const Page: SplitComponent = split(() => Promise.resolve({ default: () => null }))
    Page.renderMode = "static"
    Page.renderMode = "ppr"
    Page.pprFallback = null
    expectTypeOf<SplitComponent["renderMode"]>().toEqualTypeOf<"ppr" | "static" | undefined>()
    // @ts-expect-error only "ppr" and "static" are rendering modes
    Page.renderMode = "streaming"
})
