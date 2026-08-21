/**
 * Tests for configuration discovery functionality
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findConfigPath, findConfigPathSync } from "../config/discovery.js";
import {
  CONFIG_DIR,
  CONFIG_FILENAME,
  CONFIG_SUBDIR_ENV,
  PROJECT_DIR_ENV,
} from "../types.js";

const CONFIG_CONTENT = 'version: "1.0"\ndocsets: []';

describe("Configuration Discovery", () => {
  let tempDir: string;
  let testDir: string;
  let homeDir: string;
  let originalEnv: Record<string, string | undefined>;

  /**
   * Write a config file for a directory and return its path
   */
  async function writeConfig(directory: string): Promise<string> {
    const knowledgeDir = join(directory, CONFIG_DIR);
    await fs.mkdir(knowledgeDir, { recursive: true });
    const configPath = join(knowledgeDir, CONFIG_FILENAME);
    await fs.writeFile(configPath, CONFIG_CONTENT);
    return configPath;
  }

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(join(tmpdir(), "agentic-knowledge-test-"));
    testDir = join(tempDir, "project");
    await fs.mkdir(testDir, { recursive: true });

    // Point the home fallback at an empty directory so a real ~/.knowledge
    // config on the developer machine cannot influence the results
    homeDir = join(tempDir, "home");
    await fs.mkdir(homeDir, { recursive: true });
    originalEnv = {
      HOME: process.env.HOME,
      USERPROFILE: process.env.USERPROFILE,
      [CONFIG_SUBDIR_ENV]: process.env[CONFIG_SUBDIR_ENV],
      [PROJECT_DIR_ENV]: process.env[PROJECT_DIR_ENV],
    };
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
    delete process.env[CONFIG_SUBDIR_ENV];
    delete process.env[PROJECT_DIR_ENV];
  });

  afterEach(async () => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe("findConfigPath", () => {
    test("should find config in current directory", async () => {
      // Create .knowledge/config.yaml in test directory
      const knowledgeDir = join(testDir, CONFIG_DIR);
      await fs.mkdir(knowledgeDir, { recursive: true });
      const configPath = join(knowledgeDir, CONFIG_FILENAME);
      await fs.writeFile(configPath, 'version: "1.0"\ndocsets: []');

      const result = await findConfigPath(testDir);
      expect(result).toBe(configPath);
    });

    test("should find config in parent directory", async () => {
      // Create nested directory structure
      const nestedDir = join(testDir, "nested", "deep", "directory");
      await fs.mkdir(nestedDir, { recursive: true });

      // Create config in parent directory
      const knowledgeDir = join(testDir, CONFIG_DIR);
      await fs.mkdir(knowledgeDir, { recursive: true });
      const configPath = join(knowledgeDir, CONFIG_FILENAME);
      await fs.writeFile(configPath, 'version: "1.0"\ndocsets: []');

      const result = await findConfigPath(nestedDir);
      expect(result).toBe(configPath);
    });

    test("should return null when no config found", async () => {
      const result = await findConfigPath(testDir);
      expect(result).toBeNull();
    });

    test("should use current working directory when no path provided", async () => {
      // This test is harder to control since it uses process.cwd()
      // We'll just verify it doesn't throw an error and returns null or string
      const result = await findConfigPath();
      expect(result === null || typeof result === "string").toBe(true);
    });

    test("should stop at filesystem root", async () => {
      // Test with a path that definitely won't have a config
      const result = await findConfigPath("/");
      expect(result).toBeNull();
    });
  });

  describe("findConfigPathSync", () => {
    test("should find config in current directory (sync)", async () => {
      // Create .knowledge/config.yaml in test directory
      const knowledgeDir = join(testDir, CONFIG_DIR);
      await fs.mkdir(knowledgeDir, { recursive: true });
      const configPath = join(knowledgeDir, CONFIG_FILENAME);
      await fs.writeFile(configPath, 'version: "1.0"\ndocsets: []');

      const result = findConfigPathSync(testDir);
      expect(result).toBe(configPath);
    });

    test("should find config in parent directory (sync)", async () => {
      // Create nested directory structure
      const nestedDir = join(testDir, "nested", "deep", "directory");
      await fs.mkdir(nestedDir, { recursive: true });

      // Create config in parent directory
      const knowledgeDir = join(testDir, CONFIG_DIR);
      await fs.mkdir(knowledgeDir, { recursive: true });
      const configPath = join(knowledgeDir, CONFIG_FILENAME);
      await fs.writeFile(configPath, 'version: "1.0"\ndocsets: []');

      const result = findConfigPathSync(nestedDir);
      expect(result).toBe(configPath);
    });

    test("should return null when no config found (sync)", async () => {
      const result = findConfigPathSync(testDir);
      expect(result).toBeNull();
    });
  });

  describe("home directory fallback", () => {
    test("should find config in home directory when the tree has none", async () => {
      const configPath = await writeConfig(homeDir);

      const result = await findConfigPath(testDir, { includeHome: true });
      expect(result).toBe(configPath);
    });

    test("should find config in home directory (sync)", async () => {
      const configPath = await writeConfig(homeDir);

      const result = findConfigPathSync(testDir, { includeHome: true });
      expect(result).toBe(configPath);
    });

    test("should prefer a config in the tree over the home directory", async () => {
      const projectConfigPath = await writeConfig(testDir);
      await writeConfig(homeDir);

      const result = await findConfigPath(testDir, { includeHome: true });
      expect(result).toBe(projectConfigPath);
    });

    test("should not use the home config unless asked to", async () => {
      await writeConfig(homeDir);

      expect(await findConfigPath(testDir)).toBeNull();
      expect(findConfigPathSync(testDir)).toBeNull();
      expect(await findConfigPath(testDir, { includeHome: false })).toBeNull();
    });

    test("should not consider the home config when the override points elsewhere", async () => {
      await writeConfig(homeDir);
      process.env[CONFIG_SUBDIR_ENV] = join(tempDir, "missing");

      const result = await findConfigPath(testDir, { includeHome: true });
      expect(result).toBeNull();
    });
  });

  describe(`${CONFIG_SUBDIR_ENV} override`, () => {
    test("should use the configured directory", async () => {
      const customDir = join(tempDir, "custom");
      await fs.mkdir(customDir, { recursive: true });
      const configPath = join(customDir, CONFIG_FILENAME);
      await fs.writeFile(configPath, CONFIG_CONTENT);
      await writeConfig(testDir);
      process.env[CONFIG_SUBDIR_ENV] = customDir;

      const result = await findConfigPath(testDir);
      expect(result).toBe(configPath);
    });

    test("should use the configured directory (sync)", async () => {
      const customDir = join(tempDir, "custom");
      await fs.mkdir(customDir, { recursive: true });
      const configPath = join(customDir, CONFIG_FILENAME);
      await fs.writeFile(configPath, CONFIG_CONTENT);
      process.env[CONFIG_SUBDIR_ENV] = customDir;

      const result = findConfigPathSync(testDir);
      expect(result).toBe(configPath);
    });

    test("should return null when the configured directory holds no config", async () => {
      await writeConfig(testDir);
      process.env[CONFIG_SUBDIR_ENV] = join(tempDir, "missing");

      const result = await findConfigPath(testDir);
      expect(result).toBeNull();
    });

    test("should ignore an empty value", async () => {
      const configPath = await writeConfig(testDir);
      process.env[CONFIG_SUBDIR_ENV] = "  ";

      const result = await findConfigPath(testDir);
      expect(result).toBe(configPath);
    });
  });

  describe(`${PROJECT_DIR_ENV} override`, () => {
    test("should search upward from the configured project directory", async () => {
      const configPath = await writeConfig(testDir);
      const nestedDir = join(testDir, "nested", "deep");
      await fs.mkdir(nestedDir, { recursive: true });
      process.env[PROJECT_DIR_ENV] = nestedDir;

      const result = await findConfigPath();
      expect(result).toBe(configPath);
    });

    test("should search upward from the configured project directory (sync)", async () => {
      const configPath = await writeConfig(testDir);
      process.env[PROJECT_DIR_ENV] = testDir;

      const result = findConfigPathSync();
      expect(result).toBe(configPath);
    });

    test("should let an explicit start path win", async () => {
      const otherDir = join(tempDir, "other");
      await fs.mkdir(otherDir, { recursive: true });
      const explicitConfigPath = await writeConfig(otherDir);
      await writeConfig(testDir);
      process.env[PROJECT_DIR_ENV] = testDir;

      const result = await findConfigPath(otherDir);
      expect(result).toBe(explicitConfigPath);
    });

    test("should ignore an empty value", async () => {
      process.env[PROJECT_DIR_ENV] = "  ";

      const result = await findConfigPath(testDir);
      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    test("should handle directory with .knowledge but no config.yaml", async () => {
      // Create .knowledge directory but no config file
      const knowledgeDir = join(testDir, CONFIG_DIR);
      await fs.mkdir(knowledgeDir, { recursive: true });

      const result = await findConfigPath(testDir);
      expect(result).toBeNull();
    });

    test("should handle .knowledge/config.yaml as directory instead of file", async () => {
      // Create .knowledge/config.yaml as a directory (invalid)
      const knowledgeDir = join(testDir, CONFIG_DIR);
      await fs.mkdir(knowledgeDir, { recursive: true });
      const configDir = join(knowledgeDir, CONFIG_FILENAME);
      await fs.mkdir(configDir, { recursive: true });

      const result = await findConfigPath(testDir);
      expect(result).toBeNull();
    });

    test("should handle permission errors gracefully", async () => {
      // This test is platform-specific and hard to simulate reliably
      // We'll just ensure the function doesn't throw for non-existent paths
      const result = await findConfigPath("/non/existent/path");
      expect(result).toBeNull();
    });
  });
});
