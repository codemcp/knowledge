/**
 * Typed API for initialising docset sources.
 */

import {
  ConfigManager,
  ensureKnowledgeGitignoreSync,
  discoverDirectoryPatterns,
} from "@codemcp/knowledge-core";
import {
  initDocset as coreInitDocset,
  type InitDocsetOptions,
} from "@codemcp/knowledge-content-loader";
import type { InitDocsetParams, InitDocsetApiResult } from "./types.js";

/**
 * Initialise all sources for a docset that is already defined in the config.
 *
 * Downloads / symlinks each source and writes the metadata files that the MCP
 * server uses to serve the docset.
 *
 * @throws {Error} when the config cannot be found or the docset ID is unknown.
 */
export async function initDocset(
  params: InitDocsetParams,
): Promise<InitDocsetApiResult> {
  const {
    docsetId,
    force = false,
    discoverPaths = false,
    cwd = process.cwd(),
    onSourceProgress,
  } = params;

  const configManager = new ConfigManager();
  // init operates on a docset that is already declared somewhere, so the home
  // config is a legitimate source: docsets meant to be available everywhere
  // live in ~/.knowledge/config.yaml and must be initialisable from any
  // directory. Writes (metadata, .gitignore, discovered paths) go to the
  // config that declared the docset — never to a config the user did not mean.
  const { config, configPath } = await configManager.loadConfig(cwd, {
    includeHome: true,
  });

  ensureKnowledgeGitignoreSync(configPath);

  const docset = config.docsets.find((d) => d.id === docsetId);
  if (!docset) {
    const available = config.docsets.map((d) => d.id).join(", ");
    throw new Error(
      `Docset '${docsetId}' not found in configuration. Available: ${available}`,
    );
  }

  const coreOpts: InitDocsetOptions = { force };
  if (onSourceProgress !== undefined) {
    coreOpts.onSourceProgress = onSourceProgress;
  }

  const result = await coreInitDocset(docsetId, docset, configPath, coreOpts);

  if (result.alreadyInitialized) {
    return { ...result };
  }

  if (discoverPaths) {
    const allFiles = result.sourceResults.flatMap((r) => r.files);
    if (allFiles.length > 0) {
      const discovered = discoverDirectoryPatterns(allFiles);
      try {
        await configManager.updateDocsetPaths(docsetId, discovered, configPath);
      } catch {
        // Non-fatal: surface the discovered paths even if config update failed.
      }
      return { ...result, discoveredPaths: discovered };
    }
  }

  return { ...result };
}
