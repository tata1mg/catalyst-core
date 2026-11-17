import { test, expect } from "@playwright/test"

test("Render landing page", async ({ page }) => {
    await page.goto("http://localhost:3005/")
})

test("serverFetcher", async ({ page }) => {
    // Disable JS
    await page.context().route("**/*", (route) => {
        return route.request().resourceType() === "script" ? route.abort() : route.continue()
    })

    await page.goto("http://localhost:3005/")
    const content = await page.evaluate(() => window.__ROUTER_INITIAL_DATA__)
    expect(content["/"].isFetched).toBe(true)
})

test("clientFetcher", async ({ page }) => {
    await page.goto("http://localhost:3005/")
    const firstElement = page.locator("[data-testid]").first()
    const breed = await firstElement.getAttribute("data-testid")
    await firstElement.click()
    expect(page.url()).toBe(`http://localhost:3005/breed/${breed}`)
    await page.waitForSelector("img")
    const imageCount = await page.locator("img").count()
    expect(imageCount).toBeGreaterThan(0)
})

test("setMetaData on SSR", async ({ page }) => {
    await page.goto("http://localhost:3005/")
    await expect(page).toHaveTitle("Home")
})

test("Server middleware", async ({ page }) => {
    const response = await page.goto("http://localhost:3005/api")
    const json = await response.json()
    expect(json.message).toBe("With regards, from server")
})

test("Environment variables on client", async ({ page }) => {
    await page.goto("http://localhost:3005/breed/affenpinscher")
    const clientVar = page.getByTestId("client-var")
    const serverVar = page.getByTestId("server-var")
    const clientText = await clientVar.textContent()
    const serverText = await serverVar.textContent()
    expect(clientText).toBe("random_api_url")
    expect(serverText).toBe("")
})

// The PPR route's server tree has a Suspense boundary first inside #app; the client root
// matches it with <PPRHydrationBoundary>. A mismatch shows as a React hydration error (#418)
// in the console and the page re-rendering on the client.
test("PPR route hydrates without console errors", async ({ page }) => {
    const errors = []
    page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text())
    })
    page.on("pageerror", (error) => errors.push(error.message))

    // First request builds the shell (ppr-miss), the second replays it (ppr-hit).
    for (const expectedMode of ["ppr-miss", "ppr-hit"]) {
        const response = await page.goto("http://localhost:3005/ppr")
        expect(response.headers()["x-rendering-mode"]).toBe(expectedMode)
        await expect(page.getByTestId("ppr-data")).toHaveText("ppr data")
        // Clicking only changes the text once React has hydrated the page.
        await expect(async () => {
            await page.getByTestId("ppr-counter").click()
            await expect(page.getByTestId("ppr-counter")).not.toHaveText("clicked 0", { timeout: 500 })
        }).toPass()
    }

    expect(errors).toEqual([])
})

// Currently breaking - needs to be fixed in catalyst.
// Re-verified 2026-08-19: title clears to "" on CSR navigation instead of
// updating (not stale — empty). Tracked as https://github.com/tata1mg/catalyst-core/issues/421.
// test("setMetaData on CSR", async ({ page }) => {
//   await page.goto("http://localhost:3005/");
//   await page.getByRole("link", { name: "About" }).click();
//   await expect(page).toHaveTitle("About");
// });
