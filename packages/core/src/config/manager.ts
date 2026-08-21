/**
 * Configuration management with read and write capabilities
 */

import { promises as fs } from "node:fs";
import { load, dump } from "js-yaml";
import type { ConfigDiscoveryOptions, KnowledgeConfig } from "../types.js";
import {
  KnowledgeError,
  ErrorType,
  CONFIG_FILENAME,
  CONFIG_SUBDIR_ENV,
} from "../types.js";
import { validateConfig } from "./loader.js";
import { findConfigPath } from "./discovery.js";

/**
 * Central configuration manager for all config file operations
 */
export class ConfigManager {
  private configCache: {
    key: string;
    config: KnowledgeConfig;
    configPath: string;
    loadTime: number;
  } | null = null;
  private readonly CONFIG_CACHE_TTL = 60000; // 1 minute cache

  /**
   * Load configuration with caching
   * @param startDir - Directory to start searching from (defaults to cwd)
   * @param options - Discovery options, see {@link findConfigPath}
   * @returns Configuration and path
   */
  async loadConfig(
    startDir?: string,
    options?: ConfigDiscoveryOptions,
  ): Promise<{ config: KnowledgeConfig; configPath: string }> {
    const now = Date.now();
    // The cache key covers the lookup, not just the instance: two lookups with
    // different start directories or options must not share a resolved config
    const cacheKey = `${startDir ?? ""}\u0000${options?.includeHome ?? false}`;

    // Return cached config if still valid
    if (
      this.configCache &&
      this.configCache.key === cacheKey &&
      now - this.configCache.loadTime < this.CONFIG_CACHE_TTL
    ) {
      return {
        config: this.configCache.config,
        configPath: this.configCache.configPath,
      };
    }

    // Find and load fresh config
    const configPath = await findConfigPath(startDir, options);
    if (!configPath) {
      throw new KnowledgeError(
        ErrorType.CONFIG_NOT_FOUND,
        `No configuration file found. Please ensure .knowledge/${CONFIG_FILENAME} exists in your project${options?.includeHome ? " or home directory" : ""}, or set ${CONFIG_SUBDIR_ENV} to the directory holding it.`,
        { searchPath: startDir || process.cwd() },
      );
    }

    const config = await this.loadConfigFromPath(configPath);

    // Cache the result
    this.configCache = {
      key: cacheKey,
      config,
      configPath,
      loadTime: now,
    };

    return { config, configPath };
  }

  /**
   * Load configuration from specific file path
   * @param configPath - Path to configuration file
   * @returns Parsed configuration
   */
  async loadConfigFromPath(configPath: string): Promise<KnowledgeConfig> {
    try {
      const content = await fs.readFile(configPath, "utf-8");
      const parsed = load(content) as unknown;

      if (!validateConfig(parsed)) {
        throw new KnowledgeError(
          ErrorType.CONFIG_INVALID,
          "Configuration file contains invalid structure",
          { configPath, parsed },
        );
      }

      return parsed;
    } catch (error) {
      if (error instanceof KnowledgeError) {
        throw error;
      }

      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new KnowledgeError(
          ErrorType.CONFIG_NOT_FOUND,
          `Configuration file not found: ${configPath}`,
          { configPath },
        );
      }

      throw new KnowledgeError(
        ErrorType.CONFIG_INVALID,
        `Failed to parse configuration file: ${error instanceof Error ? error.message : String(error)}`,
        { configPath, originalError: error },
      );
    }
  }

  /**
   * Save configuration to file
   * @param config - Configuration to save
   * @param configPath - Path to save to (optional, uses cached path if available)
   */
  async saveConfig(
    config: KnowledgeConfig,
    configPath?: string,
  ): Promise<void> {
    const targetPath = configPath || this.configCache?.configPath;
    if (!targetPath) {
      throw new KnowledgeError(
        ErrorType.CONFIG_INVALID,
        "No configuration path available. Load config first or provide explicit path.",
        { configPath },
      );
    }

    // Validate config before saving
    if (!validateConfig(config)) {
      throw new KnowledgeError(
        ErrorType.CONFIG_INVALID,
        "Cannot save invalid configuration",
        { config },
      );
    }

    try {
      const yamlContent = dump(config, {
        indent: 2,
        lineWidth: 120,
        noRefs: true,
      });

      await fs.writeFile(targetPath, yamlContent, "utf-8");

      // Invalidate cache since config changed
      this.configCache = null;
    } catch (error) {
      throw new KnowledgeError(
        ErrorType.CONFIG_INVALID,
        `Failed to save configuration: ${error instanceof Error ? error.message : String(error)}`,
        { configPath: targetPath, originalError: error },
      );
    }
  }

  /**
   * Update paths for a specific docset with discovered files
   * @param docsetId - ID of docset to update
   * @param discoveredPaths - Array of file paths that were discovered
   * @param configPath - Config file to update. Pass the path the caller already
   *   resolved: re-running discovery here could pick a different file than the
   *   one the docset was read from.
   * @returns Updated configuration
   */
  async updateDocsetPaths(
    docsetId: string,
    discoveredPaths: string[],
    configPath?: string,
  ): Promise<KnowledgeConfig> {
    const config = configPath
      ? await this.loadConfigFromPath(configPath)
      : (await this.loadConfig()).config;

    // Find the docset to update
    const docset = config.docsets.find((d) => d.id === docsetId);
    if (!docset) {
      throw new KnowledgeError(
        ErrorType.CONFIG_INVALID,
        `Docset '${docsetId}' not found in configuration`,
        { docsetId, availableDocsets: config.docsets.map((d) => d.id) },
      );
    }

    // Update sources with discovered paths
    if (docset.sources) {
      for (const source of docset.sources) {
        if (source.type === "git_repo") {
          // Add or update the paths in options
          if (!source.paths) {
            source.paths = [];
          }
          source.paths = discoveredPaths;
        }
      }
    }

    // Save updated configuration
    await this.saveConfig(config, configPath);

    return config;
  }

  /**
   * Find configuration file path
   * @param startDir - Directory to start searching from
   * @param options - Discovery options, see {@link findConfigPath}
   * @returns Path to config file or null if not found
   */
  async findConfigPath(
    startDir?: string,
    options?: ConfigDiscoveryOptions,
  ): Promise<string | null> {
    return await findConfigPath(startDir, options);
  }

  /**
   * Clear configuration cache (useful for testing)
   */
  clearCache(): void {
    this.configCache = null;
  }

  /**
   * Check if configuration exists
   * @param startDir - Directory to start searching from
   * @param options - Discovery options, see {@link findConfigPath}
   * @returns True if config file exists
   */
  async configExists(
    startDir?: string,
    options?: ConfigDiscoveryOptions,
  ): Promise<boolean> {
    const path = await this.findConfigPath(startDir, options);
    return path !== null;
  }
}
