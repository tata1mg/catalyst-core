// vite.config.js
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react" // Assuming React, but works similar for other frameworks

export default defineConfig({
    plugins: [react()],
    optimizeDeps: {
        include: ["invariant", "react-fast-compare", "shallowequal", "prop-types"],
        exclude: ["@tata1mg/router", "catalyst-core/router/ClientRouter"],
        force: true,
    },
    server: {
        hmr: true,
        watch: {
            usePolling: true,
        },
    },
})
