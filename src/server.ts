import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadInstructions } from "./instructions.js";

export function createServer(): McpServer {
  return new McpServer(
    {
      name: "waypoint",
      version: "0.1.0",
    },
    {
      instructions: loadInstructions(),
      capabilities: {
        tools: {},
      },
    },
  );
}
