import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools/index";
import { registerResources } from "./resources";
import packageJson from "../../package.json";

export function createMcpServer(projectRoot: string | null): McpServer {
  const server = new McpServer({
    name: "archgate",
    version: packageJson.version,
  });

  registerTools(server, projectRoot);
  registerResources(server, projectRoot);

  return server;
}

export async function startStdioServer(
  projectRoot: string | null
): Promise<void> {
  const server = createMcpServer(projectRoot);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
