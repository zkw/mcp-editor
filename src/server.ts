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

function getProjectRoot(): string {
	const raw = process.env.WORKSPACE_FOLDER_PATHS
		?? process.env.WORKSPACE_FOLDER
		?? process.env.PROJECT_ROOT
		?? process.env.CURSOR_WORKSPACE;

	if (typeof raw === "string" && raw.length > 0) {
		const candidatePath = raw.split(",")[0].trim();
		if (candidatePath.length > 0) {
			const resolved = path.resolve(candidatePath);
			if (existsSync(resolved)) {
				console.log(`MCP Project Root: ${resolved}`);
				return resolved;
			}
			console.warn(`MCP Project Root candidate does not exist: ${resolved}`);
		}
	}

	const fallback = path.resolve(".");
	console.warn(`MCP Project Root fallback: ${fallback}`);
	return fallback;
}

const PROJECT_ROOT = getProjectRoot();

function resolvePath(filePath: string): string {
	return path.isAbsolute(filePath) ? filePath : path.resolve(PROJECT_ROOT, filePath);
}

export function createServer(): McpServer {
	const server = new McpServer({
		name: "mcp-anchor-server",
		version: "0.2.0",
	});

	server.tool(
		"read",
		"Read a file using anchor-folding semantics. See src/READ.md for exact usage, examples, and template rules.",
		{
			file: z.string().describe("Target file path"),
			template: z.string().optional().describe("Optional exact anchor template using a single '......' placeholder with non-empty prefix and suffix."),
		},
		async ({ file: filePath, template }) => {
			const target = resolvePath(filePath);
			try {
				const stat = await fs.stat(target);
				if (stat.isDirectory()) {
					return {
						content: [{ type: "text", text: `Read error: ${filePath} is a directory, expected a file.` }],
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
		"Write a file with optional anchor-completion placeholders. See src/WRITE.md for exact usage, examples, and anchor rules.",
		{
			file: z.string().describe("Target file path"),
			template: z.string().describe("Template or file content to write. Include exact source anchors around '......' for anchor-based rewriting."),
		},
		async ({ file: filePath, template }) => {
			const target = resolvePath(filePath);

			try {
				if (containsAnchorPlaceholder(template)) {
					if (!(await Bun.file(target).exists())) {
						return {
							content: [{ type: "text", text: `Anchor write failed: source file does not exist at ${filePath}` }],
							isError: true,
						};
					}

					const original = await Bun.file(target).text();
					const transformed = rewriteWithAnchors(original, template);
					await Bun.write(target, transformed);
					return {
						content: [{ type: "text", text: `Anchor write applied to ${filePath}.` }],
					};
				}

				await Bun.write(target, template);
				return { content: [{ type: "text", text: `Wrote ${filePath}.` }] };
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
