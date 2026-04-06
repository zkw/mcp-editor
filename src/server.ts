/**
 * MCP server shell.
 *
 * This repository is deprecated. All original hashline logic has been replaced
 * by a minimal stub implementation. Refer to design/AGENTS.md for the new
 * anchor-completion design.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as path from "node:path";

function resolvePath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

export function createServer(): McpServer {
    const server = new McpServer({
        name: "mcp-shell-server",
        version: "0.1.0",
    });

    server.tool(
        "read",
        "Stub read tool: returns plain file content or directory listing.",
        {
            path: z.string().describe("Path to read"),
            offset: z.number().optional().describe("1-indexed start line"),
            limit: z.number().optional().describe("Maximum lines to return"),
            plain: z.boolean().optional().describe("Return plain numbered lines instead of stub formatting"),
        },
        async ({ path: filePath, offset, limit }) => {
            const target = resolvePath(filePath);
            try {
                const raw = await Bun.file(target).text();
                const lines = raw.split("\n");
                const start = Math.max(1, offset ?? 1);
                const end = Math.min(lines.length, start - 1 + (limit ?? lines.length));
                const payload = lines.slice(start - 1, end);
                const text = payload.map((line, index) => `${start + index}|${line}`).join("\n");
                return { content: [{ type: "text", text }] };
            } catch (err) {
                return {
                    content: [{ type: "text", text: `Stub read error: ${err instanceof Error ? err.message : String(err)}` }],
                    isError: true,
                };
            }
        },
    );

    server.tool(
        "write",
        "Stub write tool: writes content to disk or handles edit-like operations in this deprecated shell.",
        {
            path: z.string().describe("Target file path"),
            content: z.string().optional().describe("File contents to write"),
            edits: z.array(z.any()).optional().describe("Optional edit operations"),
        },
        async ({ path: filePath, content, edits }) => {
            if (content != null) {
                const target = resolvePath(filePath);
                try {
                    await Bun.write(target, content);
                    return { content: [{ type: "text", text: `Stub write wrote ${filePath}` }] };
                } catch (err) {
                    return {
                        content: [{ type: "text", text: `Stub write error: ${err instanceof Error ? err.message : String(err)}` }],
                        isError: true,
                    };
                }
            }
            if (edits != null) {
                return {
                    content: [{ type: "text", text: "Stub write received edit operations. edit_file functionality is intentionally unimplemented in this deprecated shell." }],
                };
            }
            return {
                content: [{ type: "text", text: "Stub write requires either content or edits." }],
                isError: true,
            };
        },
    );

    return server;
}
