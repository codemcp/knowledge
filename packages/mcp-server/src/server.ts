/**
 * MCP Server implementation
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  loadConfig,
  findConfigPath,
  calculateLocalPath,
  ConfigManager,
  ensureKnowledgeGitignoreSync,
  buildFileIndex,
  searchDocset,
  formatSearchResult,
  type KnowledgeConfig,
  type DocsetIndex,
  type SearchOptions,
} from "@codemcp/knowledge-core";
import { initDocset } from "@codemcp/knowledge-content-loader";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";

/** Shared pattern parameter description advertised to agents */
const PATTERN_DESCRIPTION =
  "The search pattern (regex) to find in the documentation. " +
  'Supports full regex syntax (e.g. "log.*Error", "function\\s+\\w+", "auth|login"). ' +
  "Returns file path, line number, matched line, and surrounding context lines. " +
  "⚠️ IMPORTANT: This is a regex pattern, NOT a list of keywords. " +
  "Spaces are literal (match a space character). " +
  "To search for multiple alternative terms, use | (pipe): " +
  'e.g. "auth|login" matches lines containing either "auth" OR "login".';

/**
 * Create an agentic knowledge MCP server
 * @returns MCP server instance
 */
export function createAgenticKnowledgeServer() {
  const server = new Server(
    {
      name: "knowledge",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Cache for configuration to avoid repeated loading
  let configCache: { config: KnowledgeConfig; configPath: string } | null =
    null;
  let configLoadTime: number = 0;
  const CONFIG_CACHE_TTL = 60000; // 1 minute cache

  // Per-docset search index cache (keyed by docset id)
  const indexCache = new Map<string, DocsetIndex>();

  /**
   * Load configuration with caching (returns null if no config found)
   */
  async function getConfiguration(): Promise<{
    config: KnowledgeConfig;
    configPath: string;
  } | null> {
    const now = Date.now();
    if (configCache && now - configLoadTime < CONFIG_CACHE_TTL) {
      return configCache;
    }

    try {
      // Find configuration file path. The server opts into the home fallback:
      // its working directory is dictated by the GUI client that launched it
      // (Claude Desktop reports /Applications, VS Code its own app bundle), so
      // without PROJECT_DIR/KNOWLEDGE_SUBDIR the upward walk reaches nothing
      // and ~/.knowledge/config.yaml is the only config it can find.
      const configPath = await findConfigPath(undefined, { includeHome: true });
      if (!configPath) {
        return null; // No config file found - server can still start
      }

      // Load configuration
      const config = await loadConfig(configPath);

      // Cache result
      configCache = { config, configPath };
      configLoadTime = now;
      return configCache;
    } catch (error) {
      // Clear cache on error to force retry next time
      configCache = null;
      configLoadTime = 0;
      // Return null instead of throwing - allow server to start
      console.error("Error loading configuration:", error);
      return null;
    }
  }

  /**
   * Resolve the absolute local path for an initialized docset.
   * Throws if the docset has not been initialized yet.
   */
  function resolveDocsetPath(
    docset: { id: string; sources?: Array<{ type: string }> },
    configPath: string,
  ): string {
    const primarySource = docset.sources?.[0];
    const configDir = dirname(configPath);

    if (primarySource?.type === "local_folder") {
      const symlinkDir = resolve(configDir, "docsets", docset.id);
      const metadataPath = resolve(symlinkDir, ".agentic-metadata.json");
      if (!existsSync(metadataPath)) {
        throw new Error(`Docset '${docset.id}' hasn't been initialized yet.`);
      }
      return symlinkDir;
    }

    if (
      primarySource?.type === "git_repo" ||
      primarySource?.type === "archive"
    ) {
      const localRelPath = calculateLocalPath(
        docset as Parameters<typeof calculateLocalPath>[0],
        configPath,
      );
      const projectRoot = dirname(configDir);
      const absolutePath = resolve(projectRoot, localRelPath);
      const metadataPath = resolve(absolutePath, ".agentic-metadata.json");
      if (!existsSync(metadataPath)) {
        throw new Error(`Docset '${docset.id}' hasn't been initialized yet.`);
      }
      return absolutePath;
    }

    // Fallback — unknown source type, no initialization check
    return resolve(
      dirname(configDir),
      calculateLocalPath(
        docset as Parameters<typeof calculateLocalPath>[0],
        configPath,
      ),
    );
  }

  // Register tool handlers
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Load configuration to get available docsets
    const configData = await getConfiguration();

    // If no configuration, return tools with setup instructions
    if (!configData) {
      return {
        tools: [
          {
            name: "search_docs",
            description: `Search for documentation in configured docsets. Returns file path, line number, matched content, and surrounding context.

⚠️ **NO DOCSETS CONFIGURED**

To configure docsets and use this tool:

**Option 1: Use CLI (recommended)**
\`\`\`bash
# Create a docset for a Git repository
npx @codemcp/knowledge create \\
  --preset git-repo \\
  --id my-docs \\
  --name "My Documentation" \\
  --url https://github.com/user/repo.git

# Initialize it (downloads the docs)
npx @codemcp/knowledge init my-docs

# Restart the MCP server
npx @codemcp/knowledge-server
\`\`\`

**Option 2: Manual configuration**
Create \`.knowledge/config.yaml\`:
\`\`\`yaml
version: "1.0"
docsets:
  - id: my-docs
    name: My Documentation
    sources:
      - type: local_folder
        paths: ["./docs"]
\`\`\`

After configuring, the tool will show available docsets here.`,
            inputSchema: {
              type: "object",
              properties: {
                docset_id: {
                  type: "string",
                  description:
                    "The identifier of the docset to search in. (No docsets configured - see tool description for setup instructions)",
                },
                pattern: {
                  type: "string",
                  description: PATTERN_DESCRIPTION,
                },
              },
              required: ["docset_id", "pattern"],
              additionalProperties: false,
            },
          },
          {
            name: "list_docsets",
            description:
              "List all available documentation sets (docsets) with detailed information. (Currently no docsets configured - see search_docs description for setup instructions)",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
          {
            name: "init_docset",
            description:
              "Initialize a docset by downloading and preparing its content sources. Run this when a docset is configured but not yet initialized.",
            inputSchema: {
              type: "object",
              properties: {
                docset_id: {
                  type: "string",
                  description: "The identifier of the docset to initialize.",
                },
                force: {
                  type: "boolean",
                  description:
                    "Force re-initialization even if the docset already exists.",
                },
              },
              required: ["docset_id"],
              additionalProperties: false,
            },
          },
        ],
      };
    }

    // Configuration exists - build rich description with available docsets
    const { config } = configData;
    const docsetInfo = config.docsets
      .map((docset) => {
        const description = docset.description
          ? ` - ${docset.description}`
          : "";
        return `• **${docset.id}** (${docset.name})${description}`;
      })
      .join("\n");

    const searchDocsDescription =
      `Search for documentation in available docsets. Returns file path, line number, matched content, and surrounding context lines.\n\n` +
      `📚 **AVAILABLE DOCSETS:**\n${docsetInfo}`;

    return {
      tools: [
        {
          name: "search_docs",
          description: searchDocsDescription,
          inputSchema: {
            type: "object",
            properties: {
              docset_id: {
                type: "string",
                description: "Choose the docset to search in.",
                enum: config.docsets.map((d) => d.id),
              },
              pattern: {
                type: "string",
                description: PATTERN_DESCRIPTION,
              },
              context_lines: {
                type: "number",
                description:
                  "Number of lines to show before and after each matching line (default: 2). " +
                  "Set to 0 for just the matching lines, or increase for more context.",
              },
            },
            required: ["docset_id", "pattern"],
            additionalProperties: false,
          },
        },
        {
          name: "list_docsets",
          description:
            "List all available documentation sets (docsets) with detailed information. Note: The search_docs tool already shows available docsets in its description, so this tool is mainly for getting additional metadata.",
          inputSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
        {
          name: "init_docset",
          description: `Initialize a docset by downloading and preparing its content sources. Run this when a docset is configured but not yet initialized.

📚 **AVAILABLE DOCSETS TO INITIALIZE:**
${config.docsets.map((d) => `• **${d.id}** (${d.name})`).join("\n")}`,
          inputSchema: {
            type: "object",
            properties: {
              docset_id: {
                type: "string",
                description: "The identifier of the docset to initialize.",
                enum: config.docsets.map((d) => d.id),
              },
              force: {
                type: "boolean",
                description:
                  "Force re-initialization even if the docset already exists.",
              },
            },
            required: ["docset_id"],
            additionalProperties: false,
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case "search_docs": {
          const { docset_id, pattern, context_lines } = args as {
            docset_id: string;
            pattern: string;
            context_lines?: number;
          };

          // Validate required parameters
          if (!docset_id || typeof docset_id !== "string") {
            throw new Error("docset_id is required and must be a string");
          }
          if (!pattern || typeof pattern !== "string") {
            throw new Error("pattern is required and must be a string");
          }

          // Load configuration
          const configData = await getConfiguration();
          if (!configData) {
            throw new Error(
              "No configuration file found.\n\n" +
                "To configure docsets:\n\n" +
                "**Option 1: Use CLI (recommended)**\n" +
                'npx @codemcp/knowledge create --preset git-repo --id my-docs --name "My Docs" --url <repo-url>\n' +
                "npx @codemcp/knowledge init my-docs\n\n" +
                "**Option 2: Manual configuration**\n" +
                "Create .knowledge/config.yaml in your project root or home directory.\n" +
                "See the search_docs tool description for example configuration.\n\n" +
                "**Option 3: Point at an existing configuration**\n" +
                "Set PROJECT_DIR to the project, or KNOWLEDGE_SUBDIR to the\n" +
                ".knowledge directory holding config.yaml.",
            );
          }

          const { config, configPath } = configData;

          // Find the requested docset
          const docset = config.docsets.find((d) => d.id === docset_id);
          if (!docset) {
            const availableIds = config.docsets.map((d) => d.id).join(", ");
            throw new Error(
              `Docset '${docset_id}' not found.\n\nAvailable docsets: ${availableIds}`,
            );
          }

          // Resolve the absolute local path (also validates initialization)
          const absoluteLocalPath = resolveDocsetPath(docset, configPath);

          // Get or build the search index for this docset
          let index = indexCache.get(docset_id);
          if (!index) {
            index = await buildFileIndex(absoluteLocalPath);
            indexCache.set(docset_id, index);
          }

          // Perform the search
          const searchOptions: SearchOptions = {};
          if (typeof context_lines === "number")
            searchOptions.contextLines = context_lines;
          const result = await searchDocset(
            absoluteLocalPath,
            pattern.trim(),
            searchOptions,
            index,
          );

          const text = formatSearchResult(result);

          return {
            content: [{ type: "text", text }],
          };
        }

        case "list_docsets": {
          // Load configuration
          const configData = await getConfiguration();
          if (!configData) {
            return {
              content: [
                {
                  type: "text",
                  text:
                    "No docsets configured.\n\n" +
                    "To configure docsets:\n\n" +
                    "**Option 1: Use CLI (recommended)**\n" +
                    "```bash\n" +
                    'npx @codemcp/knowledge create --preset git-repo --id my-docs --name "My Docs" --url <repo-url>\n' +
                    "npx @codemcp/knowledge init my-docs\n" +
                    "```\n\n" +
                    "**Option 2: Manual configuration**\n" +
                    "Create `.knowledge/config.yaml` in the project or home directory\n" +
                    "(`PROJECT_DIR` or `KNOWLEDGE_SUBDIR` override where the server looks):\n" +
                    "```yaml\n" +
                    'version: "1.0"\n' +
                    "docsets:\n" +
                    "  - id: my-docs\n" +
                    "    name: My Documentation\n" +
                    "    sources:\n" +
                    "      - type: local_folder\n" +
                    '        paths: ["./docs"]\n' +
                    "```",
                },
              ],
            };
          }

          const { config, configPath } = configData;

          // Return list of available docsets with calculated paths
          const docsets = await Promise.all(
            config.docsets.map(async (docset) => {
              const primarySource = docset.sources?.[0];
              let localPath: string;

              if (primarySource?.type === "local_folder") {
                // Use symlinked path for local folders
                const configDir = dirname(configPath);
                localPath = resolve(configDir, "docsets", docset.id);
                const projectRoot = dirname(configDir);
                localPath = resolve(projectRoot, localPath).replace(
                  projectRoot + "/",
                  "",
                );
              } else {
                // Use standard calculation for other types
                localPath = calculateLocalPath(docset, configPath);
              }

              return {
                docset_id: docset.id,
                docset_name: docset.name,
                docset_description:
                  docset.description || "No description provided",
                local_path: localPath,
              };
            }),
          );

          const summary =
            `Found ${docsets.length} available docset(s):\n\n` +
            docsets
              .map(
                (d) =>
                  `**${d.docset_id}** (${d.docset_name})\n` +
                  `  Description: ${d.docset_description}\n` +
                  `  Path: ${d.local_path}`,
              )
              .join("\n\n");

          return {
            content: [
              {
                type: "text",
                text: summary,
              },
            ],
          };
        }

        case "init_docset": {
          const { docset_id, force = false } = args as {
            docset_id: string;
            force?: boolean;
          };

          if (!docset_id || typeof docset_id !== "string") {
            throw new Error("docset_id is required and must be a string");
          }

          const configManager = new ConfigManager();
          // Same resolution as getConfiguration(): passing process.cwd()
          // explicitly would defeat PROJECT_DIR, and this tool must initialise
          // the docset in the config the other tools read from
          const { config, configPath } = await configManager.loadConfig(
            undefined,
            { includeHome: true },
          );

          // Invalidate config cache and search index cache so the next
          // search_docs call sees the newly initialized content
          configCache = null;
          configLoadTime = 0;
          indexCache.delete(docset_id);

          ensureKnowledgeGitignoreSync(configPath);

          const docset = config.docsets.find((d) => d.id === docset_id);
          if (!docset) {
            throw new Error(
              `Docset '${docset_id}' not found. Available: ${config.docsets.map((d) => d.id).join(", ")}`,
            );
          }

          const result = await initDocset(docset_id, docset, configPath, {
            force,
          });

          if (result.alreadyInitialized) {
            return {
              content: [
                {
                  type: "text",
                  text: `Docset '${docset_id}' is already initialized. Use force: true to re-initialize.`,
                },
              ],
            };
          }

          const summary = [
            `Successfully initialized docset '${docset_id}' (${docset.name}).`,
            `Location: ${result.localPath}`,
            `Total files: ${result.totalFiles}`,
            ...result.sourceResults.map(
              (r) => `Source ${r.index + 1} (${r.type}): ${r.message}`,
            ),
          ].join("\n");

          return {
            content: [{ type: "text", text: summary }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      // Return structured error information
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        content: [
          {
            type: "text",
            text: `Error: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start the MCP server with stdio transport
 */
export async function startMCPServer(): Promise<void> {
  const server = createAgenticKnowledgeServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log startup to stderr so it doesn't interfere with MCP protocol
  console.error("Agentic Knowledge MCP Server started");
}
