/**
 * Configuration discovery functionality
 */

import { promises as fs } from "node:fs";
import * as fsSync from "node:fs";
import { homedir } from "node:os";
import { resolve, dirname, join } from "node:path";
import type { ConfigDiscoveryOptions } from "../types.js";
import {
  CONFIG_DIR,
  CONFIG_FILENAME,
  CONFIG_SUBDIR_ENV,
  PROJECT_DIR_ENV,
} from "../types.js";

/**
 * Build the conventional config path for a directory
 */
function configPathFor(directory: string): string {
  return join(directory, CONFIG_DIR, CONFIG_FILENAME);
}

/**
 * Read a directory override from the environment
 * @returns Absolute path, or null when the variable is unset or blank
 */
function directoryFromEnv(variable: string): string | null {
  const configured = process.env[variable]?.trim();
  return configured ? resolve(configured) : null;
}

/**
 * Resolve where the upward search starts: an explicit argument wins over the
 * ambient PROJECT_DIR, which in turn wins over the working directory. GUI
 * launchers give MCP servers an unrelated working directory (Claude Desktop
 * reports /Applications, VS Code its own app bundle), so PROJECT_DIR is how
 * those clients point the server at a project.
 */
function resolveStartPath(startPath?: string): string {
  return resolve(
    startPath ?? directoryFromEnv(PROJECT_DIR_ENV) ?? process.cwd(),
  );
}

/**
 * Collect the config paths to probe, from startPath up to the filesystem root,
 * optionally followed by the user's home directory as a last resort. The home
 * fallback covers the same GUI-launch case when no project directory is known.
 */
function candidateConfigPaths(
  startPath: string,
  includeHome: boolean,
): string[] {
  const paths: string[] = [];
  let currentDir = startPath;

  while (true) {
    paths.push(configPathFor(currentDir));

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }

  if (includeHome) {
    const homeConfigPath = configPathFor(homedir());
    if (!paths.includes(homeConfigPath)) {
      paths.push(homeConfigPath);
    }
  }

  return paths;
}

/**
 * Find the configuration file, in this order: the KNOWLEDGE_SUBDIR override,
 * an upward walk from the start path, then the user's home directory
 * @param startPath - Directory to start searching from. Defaults to PROJECT_DIR
 *   when set, otherwise the current working directory.
 * @param options - Discovery options. Pass `includeHome: false` when the caller
 *   is about to write to the config, so a home config cannot become the target
 *   for a project that has none.
 * @returns Path to config file or null if not found
 */
export async function findConfigPath(
  startPath?: string,
  options: ConfigDiscoveryOptions = {},
): Promise<string | null> {
  const configuredDir = directoryFromEnv(CONFIG_SUBDIR_ENV);
  if (configuredDir) {
    // An explicit override is never silently ignored
    const configPath = join(configuredDir, CONFIG_FILENAME);
    return (await isFile(configPath)) ? configPath : null;
  }

  for (const configPath of candidateConfigPaths(
    resolveStartPath(startPath),
    options.includeHome ?? true,
  )) {
    if (await isFile(configPath)) {
      return configPath;
    }
  }

  return null;
}

/**
 * Synchronous version of findConfigPath for cases where async is not suitable
 * @param startPath - Directory to start searching from, see {@link findConfigPath}
 * @param options - Discovery options, see {@link findConfigPath}
 * @returns Path to config file or null if not found
 */
export function findConfigPathSync(
  startPath?: string,
  options: ConfigDiscoveryOptions = {},
): string | null {
  const configuredDir = directoryFromEnv(CONFIG_SUBDIR_ENV);
  if (configuredDir) {
    const configPath = join(configuredDir, CONFIG_FILENAME);
    return isFileSync(configPath) ? configPath : null;
  }

  for (const configPath of candidateConfigPaths(
    resolveStartPath(startPath),
    options.includeHome ?? true,
  )) {
    if (isFileSync(configPath)) {
      return configPath;
    }
  }

  return null;
}

async function isFile(path: string): Promise<boolean> {
  try {
    const stats = await fs.stat(path);
    return stats.isFile();
  } catch {
    return false;
  }
}

function isFileSync(path: string): boolean {
  try {
    return fsSync.statSync(path).isFile();
  } catch {
    return false;
  }
}
