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

// test("Environment variables on client", async ({ page }) => {
//   await page.goto("http://localhost:3005");
// });

// Currently breaking - needs to be fixed in catalyst
// test("setMetaData on CSR", async ({ page }) => {
//   await page.goto("http://localhost:3005/");
//   await page.getByRole("link", { name: "About" }).click();
//   await expect(page).toHaveTitle("About");
// });
