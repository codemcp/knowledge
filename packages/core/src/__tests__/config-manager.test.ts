/**
 * Tests for ConfigManager discovery and write-target behaviour
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ConfigManager } from "../config/manager.js";
import {
  CONFIG_DIR,
  CONFIG_FILENAME,
  CONFIG_SUBDIR_ENV,
  PROJECT_DIR_ENV,
} from "../types.js";

describe("ConfigManager", () => {
  let tempDir: string;
  let homeDir: string;
  let originalEnv: Record<string, string | undefined>;

  async function writeConfig(
    directory: string,
    docsetId: string,
  ): Promise<string> {
    const knowledgeDir = join(directory, CONFIG_DIR);
    await fs.mkdir(knowledgeDir, { recursive: true });
    const configPath = join(knowledgeDir, CONFIG_FILENAME);
    await fs.writeFile(
      configPath,
      [
        'version: "1.0"',
        "docsets:",
        `  - id: ${docsetId}`,
        `    name: ${docsetId}`,
        "    sources:",
        "      - type: git_repo",
        "        url: https://example.com/repo.git",
        "        branch: main",
      ].join("\n"),
    );
    return configPath;
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(join(tmpdir(), "agentic-knowledge-manager-"));
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
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("caches per lookup, not per instance", async () => {
    const projectA = join(tempDir, "a");
    const projectB = join(tempDir, "b");
    await fs.mkdir(projectA, { recursive: true });
    await fs.mkdir(projectB, { recursive: true });
    const configA = await writeConfig(projectA, "a");
    const configB = await writeConfig(projectB, "b");

    const manager = new ConfigManager();
    expect((await manager.loadConfig(projectA)).configPath).toBe(configA);
    expect((await manager.loadConfig(projectB)).configPath).toBe(configB);
  });

  test("does not share a result between includeHome variants", async () => {
    const project = join(tempDir, "project");
    await fs.mkdir(project, { recursive: true });
    const homeConfig = await writeConfig(homeDir, "global");

    expect(
      (await new ConfigManager().loadConfig(project, { includeHome: true }))
        .configPath,
    ).toBe(homeConfig);

    const manager = new ConfigManager();
    await manager.loadConfig(project, { includeHome: true });
    await expect(manager.loadConfig(project)).rejects.toThrow(
      /No configuration file found/,
    );
  });

  test("updateDocsetPaths writes to the config it was given", async () => {
    const project = join(tempDir, "project");
    await fs.mkdir(project, { recursive: true });
    const projectConfig = await writeConfig(project, "docs");
    await writeConfig(homeDir, "docs");

    const manager = new ConfigManager();
    await manager.updateDocsetPaths("docs", ["docs/"], projectConfig);

    const written = await fs.readFile(projectConfig, "utf-8");
    expect(written).toContain("docs/");
    const homeContent = await fs.readFile(
      join(homeDir, CONFIG_DIR, CONFIG_FILENAME),
      "utf-8",
    );
    expect(homeContent).not.toContain("docs/");
  });
});
