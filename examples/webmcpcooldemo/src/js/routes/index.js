import Home from "@containers/Home/Home"
import BlendLab from "../pages/BlendLab"
import Inspector from "../pages/Inspector"
import PassReveal from "../pages/PassReveal"
import Journey from "../pages/Journey"

/**
 * Routes definitions with declarative WebMCP tool configs.
 * WebMcpProvider automatically turns routes with `.tool` into
 * app-wide WebMCP read tools so AI agents can discover and navigate to them.
 */
const routes = [
    {
        path: "/",
        end: true,
        component: Home,
        tool: {
            description: "Open the 3D WebMCP Studio. An interactive Three.js sculpture with real-time morphing, paint, and physics.",
            annotations: { readOnlyHint: true },
        },
    },
    {
        path: "/journey",
        component: Journey,
        tool: {
            description:
                "Open the 3D Living Quest. An interactive living 3D world where you move character Pip in 3D space, experience Day/Night cycles, talk to Elder Byte, and uncover ancient relics.",
            annotations: { readOnlyHint: true },
        },
    },
    {
        path: "/pass",
        component: PassReveal,
        tool: {
            description:
                "Open the Knockout Video Card laboratory. Inspect 3D perspective tilt, corner peel, and 4-layer exploded isometric view with chalk annotations.",
            annotations: { readOnlyHint: true },
        },
    },
    {
        path: "/stickers",
        component: BlendLab,
        tool: {
            description:
                "Open the CSS mix-blend-mode knockout typography laboratory. " +
                "Inspect knockout stencil text effects and place custom blend stickers.",
            annotations: { readOnlyHint: true },
        },
    },
    {
        path: "/inspector",
        component: Inspector,
        tool: {
            description:
                "Open the WebMCP Registry Inspector. Inspect JSON schemas, tool lifetimes, and test manual execution.",
            annotations: { readOnlyHint: true },
        },
    },
]

export default routes

