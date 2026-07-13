/**
 * Docset initialization logic shared between CLI and MCP server.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import * as path from "node:path";
import {
  calculateLocalPath,
  safelyClearDirectory,
  createSymlinks,
  type DocsetConfig,
} from "@codemcp/knowledge-core";
import { GitRepoLoader } from "./content/git-repo-loader.js";
import { ArchiveLoader } from "./content/archive-loader.js";
import { WebSourceType } from "./types.js";

export interface SourceResult {
  index: number;
  type: string;
  filesCount: number;
  files: string[];
  message: string;
  contentHash?: string;
}

export interface InitDocsetResult {
  localPath: string;
  totalFiles: number;
  sourceResults: SourceResult[];
  /** True when already initialized and force was not set */
  alreadyInitialized: boolean;
}

export interface InitDocsetOptions {
  force?: boolean;
  /** Called after each source is processed so callers can show progress */
  onSourceProgress?: (result: SourceResult) => void;
}

/**
 * Download / symlink all sources for a docset and write metadata files.
 * Does not load config or produce console output — callers handle both.
 */
export async function initDocset(
  docsetId: string,
  docset: DocsetConfig,
  configPath: string,
  options: InitDocsetOptions = {},
): Promise<InitDocsetResult> {
  const { force = false, onSourceProgress } = options;

  if (!docset.sources || docset.sources.length === 0) {
    throw new Error(`Docset '${docsetId}' has no sources configured`);
  }

  const localPath = calculateLocalPath(docset, configPath);

  let existsAlready = false;
  try {
    const stat = await fs.stat(localPath);
    if (stat.isDirectory()) existsAlready = true;
  } catch {
    // not yet created
  }

  if (existsAlready && !force) {
    const metadataPath = path.join(localPath, ".agentic-metadata.json");
    if (existsSync(metadataPath)) {
      return {
        localPath,
        totalFiles: 0,
        sourceResults: [],
        alreadyInitialized: true,
      };
    }
  }

  if (existsAlready && force) {
    await safelyClearDirectory(localPath);
  }

  await fs.mkdir(localPath, { recursive: true });

  const configDir = path.dirname(configPath);
  const projectRoot = path.dirname(configDir);

  let totalFiles = 0;
  const sourceResults: SourceResult[] = [];

  for (const [index, source] of docset.sources.entries()) {
    let result: SourceResult;

    if (source.type === "git_repo") {
      const loader = new GitRepoLoader();
      const webSourceConfig = {
        url: source.url,
        type: WebSourceType.GIT_REPO,
        options: {
          branch: source.branch || "main",
          paths: source.paths || [],
        },
      };

      const validation = loader.validateConfig(webSourceConfig);
      if (validation !== true) {
        throw new Error(`Invalid Git repository configuration: ${validation}`);
      }

      const loadResult = await loader.load(webSourceConfig, localPath);
      if (!loadResult.success) {
        throw new Error(`Git repository loading failed: ${loadResult.error}`);
      }

      result = {
        index,
        type: "git_repo",
        filesCount: loadResult.files.length,
        files: loadResult.files,
        message: `${loadResult.files.length} files loaded from ${source.url}`,
        contentHash: loadResult.contentHash,
      };

      await fs.writeFile(
        path.join(localPath, `.agentic-source-${index}.json`),
        JSON.stringify(
          {
            source_url: source.url,
            source_type: source.type,
            downloaded_at: new Date().toISOString(),
            files_count: loadResult.files.length,
            files: loadResult.files,
            docset_id: docsetId,
            content_hash: loadResult.contentHash,
          },
          null,
          2,
        ),
      );
    } else if (source.type === "local_folder") {
      if (!source.paths || source.paths.length === 0) {
        throw new Error(
          `Local folder source ${index + 1} has no paths configured`,
        );
      }

      const validatedPaths: string[] = [];
      for (const sourcePath of source.paths) {
        const absolutePath = path.isAbsolute(sourcePath)
          ? sourcePath
          : path.resolve(projectRoot, sourcePath);
        try {
          const stat = await fs.stat(absolutePath);
          if (!stat.isDirectory()) {
            throw new Error(`Path is not a directory: ${sourcePath}`);
          }
          validatedPaths.push(sourcePath);
        } catch {
          throw new Error(`Local folder path does not exist: ${sourcePath}`);
        }
      }

      await createSymlinks(validatedPaths, localPath, projectRoot);

      let fileCount = 0;
      const files: string[] = [];
      async function countFiles(dir: string): Promise<void> {
        const entries = await fs.readdir(dir);
        for (const name of entries) {
          const fullPath = path.join(dir, name);
          const stat = await fs.stat(fullPath);
          if (stat.isDirectory()) {
            await countFiles(fullPath);
          } else if (stat.isFile()) {
            fileCount++;
            files.push(path.relative(localPath, fullPath));
          }
        }
      }
      await countFiles(localPath);

      result = {
        index,
        type: "local_folder",
        filesCount: fileCount,
        files,
        message: `${validatedPaths.length} symlink(s) created, ${fileCount} files accessible`,
      };

      await fs.writeFile(
        path.join(localPath, `.agentic-source-${index}.json`),
        JSON.stringify(
          {
            source_paths: validatedPaths,
            source_type: source.type,
            initialized_at: new Date().toISOString(),
            files_count: fileCount,
            files,
            docset_id: docsetId,
          },
          null,
          2,
        ),
      );
    } else if (source.type === "archive") {
      const loader = new ArchiveLoader();
      const sourceUrl = source.url || source.path || "";
      const webSourceConfig = {
        url: sourceUrl,
        type: WebSourceType.ARCHIVE,
        options: { paths: source.paths || [] },
      };

      const validation = loader.validateConfig(webSourceConfig);
      if (validation !== true) {
        throw new Error(`Invalid archive source configuration: ${validation}`);
      }

      const loadResult = await loader.load(webSourceConfig, localPath);
      if (!loadResult.success) {
        throw new Error(`Archive loading failed: ${loadResult.error}`);
      }

      result = {
        index,
        type: "archive",
        filesCount: loadResult.files.length,
        files: loadResult.files,
        message: `${loadResult.files.length} files extracted from ${sourceUrl}`,
        contentHash: loadResult.contentHash,
      };

      await fs.writeFile(
        path.join(localPath, `.agentic-source-${index}.json`),
        JSON.stringify(
          {
            source_url: sourceUrl,
            source_type: source.type,
            downloaded_at: new Date().toISOString(),
            files_count: loadResult.files.length,
            files: loadResult.files,
            docset_id: docsetId,
            content_hash: loadResult.contentHash,
          },
          null,
          2,
        ),
      );
    } else {
      result = {
        index,
        type: (source as { type: string }).type,
        filesCount: 0,
        files: [],
        message: `source type '${(source as { type: string }).type}' not supported, skipped`,
      };
    }

    totalFiles += result.filesCount;
    sourceResults.push(result);
    onSourceProgress?.(result);
  }

  // Write the overall metadata file — this is what search_docs checks for
  await fs.writeFile(
    path.join(localPath, ".agentic-metadata.json"),
    JSON.stringify(
      {
        docset_id: docsetId,
        docset_name: docset.name,
        initialized_at: new Date().toISOString(),
        total_files: totalFiles,
        sources_count: docset.sources.length,
      },
      null,
      2,
    ),
  );

  return { localPath, totalFiles, sourceResults, alreadyInitialized: false };
}
