import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadInstructions } from "./instructions.js";
import { registerUploadTools } from "./tools/upload.js";
import { registerStrategyTools } from "./tools/strategies.js";
import { registerRetrieveTools } from "./tools/retrieve.js";

export function createServer(): McpServer {
  const server = new McpServer(
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

  registerUploadTools(server);
  registerRetrieveTools(server);
  registerStrategyTools(server);

  return server;
}
