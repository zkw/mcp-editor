/**
 * MCP server shell.
 *
 * This server implements the anchor-completion editing protocol described in AGENTS.md.
 * It supports reading files and writing updates with strict `......` placeholders.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { AnchorRewriteError, containsAnchorPlaceholder, foldSource, matchAnchorTemplate, rewriteWithAnchors } from "./anchor.js";

function resolvePath(absolutePath: string): string {
	if (!path.isAbsolute(absolutePath)) {
		throw new Error("absolutePath must be an absolute path.");
	}
	return absolutePath;
}

export function createServer(): McpServer {
	const server = new McpServer({
		name: "mcp-anchor-server",
		version: "0.2.0",
	});

	server.tool(
		"read",
		"Read a file using anchor-folding semantics. LLM MUST pass absolutePath. See src/READ.md for exact usage, examples, and template rules.",
		{
			absolutePath: z.string().describe("Absolute path to target file. LLM MUST pass an absolute path."),
			template: z.string().optional().describe("Optional exact anchor template using a single '......' placeholder with non-empty prefix and suffix."),
		},
		async ({ absolutePath, template }) => {
			const target = resolvePath(absolutePath);
			try {
				const stat = await fs.stat(target);
				if (stat.isDirectory()) {
					return {
						content: [{ type: "text", text: `Read error: ${absolutePath} is a directory, expected a file.` }],
						isError: true,
					};
				}

				const raw = await Bun.file(target).text();
				const folded = template == null ? foldSource(raw) : matchAnchorTemplate(raw, template);
				return { content: [{ type: "text", text: folded }] };
			} catch (err) {
				return {
					content: [{ type: "text", text: `Read error: ${err instanceof Error ? err.message : String(err)}` }],
					isError: true,
				};
			}
		},
	);

	server.tool(
		"write",
		"Write a file with optional anchor-completion placeholders. LLM MUST pass absolutePath. See src/WRITE.md for exact usage, examples, and anchor rules.",
		{
			absolutePath: z.string().describe("Absolute path to target file. LLM MUST pass an absolute path."),
			template: z.string().describe("Template or file content to write. Include exact source anchors around '......' for anchor-based rewriting."),
		},
		async ({ absolutePath, template }) => {
			const target = resolvePath(absolutePath);

			try {
				if (containsAnchorPlaceholder(template)) {
					if (!(await Bun.file(target).exists())) {
						return {
							content: [{ type: "text", text: `Anchor write failed: source file does not exist at ${absolutePath}` }],
							isError: true,
						};
					}

					const original = await Bun.file(target).text();
					const transformed = rewriteWithAnchors(original, template);
					await Bun.write(target, transformed);
					return {
						content: [{ type: "text", text: `Anchor write applied to ${absolutePath}.` }],
					};
				}

				await Bun.write(target, template);
				return { content: [{ type: "text", text: `Wrote ${absolutePath}.` }] };
			} catch (err) {
				const message = err instanceof AnchorRewriteError ? err.message : err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Write error: ${message}` }],
					isError: true,
				};
			}
		},
	);

	return server;
}
