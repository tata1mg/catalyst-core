// vite.config.js
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react" // Assuming React, but works similar for other frameworks

export default defineConfig({
    plugins: [react()],
    build: {
        // Build both server and client
        ssr: true,
        // Output directory for client build
        outDir: "dist/client",
        // Generate manifest to help with SSR
        manifest: true,
    },
    ssr: {
        // Output directory for server build
        outDir: "dist/server",
        // External dependencies that shouldn't be bundled
        noExternal: ["react-helmet-asyc"],
        external: ["express"],
    },
    optimizeDeps: {
        entries: "./client/index.jsx",
        include: ["@tata1mg/router", "invariant"],
        force: true,
    },
})
