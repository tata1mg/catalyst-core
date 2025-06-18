const fs = require("fs")
const path = require("path")
const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js")
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js")

const server = new McpServer({
    name: "catalyst",
    version: "1.0.0",
    capabilities: {
        tools: {},
    },
})

server.tool("get_context", "Complete context of catalyst framework", {}, () => {
    const context = fs.readFileSync(path.join(__dirname, "context.md"), "utf-8")
    return {
        content: [
            {
                type: "text",
                text: context,
            },
        ],
    }
})

const init = async () => {
    try {
        const transport = new StdioServerTransport()
        await server.connect(transport)
        console.log("MCP Server Running!")
    } catch (error) {
        console.error("Error starting MCP server:", error)
    }
}

init()
