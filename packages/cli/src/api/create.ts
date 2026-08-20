/**
 * Typed API for creating new docsets.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { URL } from "node:url";
import { ConfigManager } from "@codemcp/knowledge-core";
import type { DocsetConfig } from "@codemcp/knowledge-core";
import type {
  CreateDocsetParams,
  CreateDocsetOptions,
  CreateDocsetResult,
} from "./types.js";

/**
 * Create a new docset entry in the knowledge configuration.
 *
 * Validates the parameters for the chosen preset, creates the
 * `.knowledge/config.yaml` if it doesn't exist yet, and appends the new
 * docset to it.
 *
 * @throws {Error} when validation fails or the docset ID already exists.
 */
export async function createDocset(
  params: CreateDocsetParams,
  options?: CreateDocsetOptions,
): Promise<CreateDocsetResult> {
  const cwd = options?.cwd ?? process.cwd();
  const configManager = new ConfigManager();

  // The home config is never a write target for a project that has none:
  // creating a docset here would silently edit the user's global config
  const discovery = { includeHome: false };
  const configExists = await configManager.configExists(cwd, discovery);
  let config: { version: string; docsets: DocsetConfig[] };
  let configPath: string;
  let configCreated = false;

  if (!configExists) {
    configPath = path.join(cwd, ".knowledge", "config.yaml");
    config = { version: "1.0", docsets: [] };
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    configCreated = true;
  } else {
    const loaded = await configManager.loadConfig(cwd, discovery);
    config = loaded.config;
    configPath = loaded.configPath;
  }

  if (config.docsets.find((d) => d.id === params.id)) {
    throw new Error(`Docset with ID '${params.id}' already exists`);
  }

  let newDocset: DocsetConfig;

  if (params.preset === "git-repo") {
    newDocset = buildGitRepoDocset(params);
  } else if (params.preset === "local-folder") {
    newDocset = await buildLocalFolderDocset(params);
  } else if (params.preset === "archive") {
    newDocset = await buildArchiveDocset(params);
  } else {
    throw new Error(
      `Unknown preset: '${params.preset}'. Use 'git-repo', 'local-folder', or 'archive'`,
    );
  }

  config.docsets.push(newDocset);
  await configManager.saveConfig(config, configPath);

  return { docset: newDocset, configPath, configCreated };
}

function buildGitRepoDocset(params: CreateDocsetParams): DocsetConfig {
  if (!params.url) {
    throw new Error("url is required for the git-repo preset");
  }
  if (!params.url.match(/^https?:\/\/.*\.git$|^git@.*\.git$/)) {
    throw new Error("Invalid git URL format. Expected a URL ending with .git");
  }
  return {
    id: params.id,
    name: params.name,
    description: params.description ?? `Git repository: ${params.url}`,
    sources: [
      {
        url: params.url,
        type: "git_repo" as const,
        branch: params.branch ?? "main",
        ...(params.paths !== undefined ? { paths: params.paths } : {}),
      },
    ],
  };
}

async function buildLocalFolderDocset(
  params: CreateDocsetParams,
): Promise<DocsetConfig> {
  if (!params.path) {
    throw new Error("path is required for the local-folder preset");
  }
  const fullPath = path.resolve(params.path);
  let stat;
  try {
    stat = await fs.stat(fullPath);
  } catch {
    throw new Error(`Path does not exist: ${params.path}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${params.path}`);
  }
  return {
    id: params.id,
    name: params.name,
    description: params.description ?? `Local documentation: ${params.path}`,
    sources: [
      {
        type: "local_folder",
        paths: [params.path],
      },
    ],
  };
}

async function buildArchiveDocset(
  params: CreateDocsetParams,
): Promise<DocsetConfig> {
  if (!params.path && !params.url) {
    throw new Error("Either path or url is required for the archive preset");
  }
  if (params.path) {
    const fullPath = path.resolve(params.path);
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      throw new Error(`Path does not exist or is invalid: ${params.path}`);
    }
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${params.path}`);
    }
    const lower = params.path.toLowerCase();
    if (
      !lower.endsWith(".zip") &&
      !lower.endsWith(".tar.gz") &&
      !lower.endsWith(".tgz")
    ) {
      throw new Error(
        `Unsupported archive format. Expected .zip, .tar.gz or .tgz: ${params.path}`,
      );
    }
  }
  if (params.url) {
    try {
      new URL(params.url);
    } catch {
      throw new Error(`Invalid URL format: ${params.url}`);
    }
  }
  return {
    id: params.id,
    name: params.name,
    description: params.description ?? `Archive: ${params.path ?? params.url}`,
    sources: [
      {
        type: "archive",
        ...(params.path ? { path: params.path } : {}),
        ...(params.url ? { url: params.url } : {}),
        ...(params.paths ? { paths: params.paths } : {}),
      },
    ],
  };
}
