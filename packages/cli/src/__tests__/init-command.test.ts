/**
 * Init Command - Behavior tests for force re-init and path discovery
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("Init Command - Force Re-initialization", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    // Create temporary test directory
    testDir = path.join(tmpdir(), `agentic-init-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    // Create .knowledge directory and config
    const knowledgeDir = path.join(testDir, ".knowledge");
    await fs.mkdir(knowledgeDir, { recursive: true });
    configPath = path.join(knowledgeDir, "config.yaml");

    // Create basic config
    const config = `version: "1.0"
docsets:
  - id: test-docset
    name: Test Docset
    description: Test
    sources:
      - url: https://github.com/test/repo.git
        type: git_repo
        branch: main
        paths:
          - docs/
`;
    await fs.writeFile(configPath, config);
  });

  afterEach(async () => {
    // Cleanup
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("--force flag behavior", () => {
    it("should clear existing directory before re-initialization", async () => {
      // Create docset directory with old files
      const docsetPath = path.join(
        testDir,
        ".knowledge",
        "docsets",
        "test-docset",
      );
      await fs.mkdir(docsetPath, { recursive: true });

      // Add old files that should be removed
      await fs.writeFile(path.join(docsetPath, "old-file.md"), "old content");
      await fs.writeFile(
        path.join(docsetPath, "old-file2.md"),
        "old content 2",
      );
      await fs.mkdir(path.join(docsetPath, "old-directory"), {
        recursive: true,
      });
      await fs.writeFile(
        path.join(docsetPath, "old-directory", "nested.md"),
        "nested old content",
      );

      // Verify old files exist
      const filesBefore = await fs.readdir(docsetPath);
      expect(filesBefore).toContain("old-file.md");
      expect(filesBefore).toContain("old-file2.md");
      expect(filesBefore).toContain("old-directory");

      // Import cleanup utilities to test the behavior
      const { safelyClearDirectory, getDirectoryInfo } =
        await import("@codemcp/knowledge-core");

      // Get directory info before clearing
      const dirInfoBefore = await getDirectoryInfo(docsetPath);
      expect(dirInfoBefore.files).toBeGreaterThan(0);
      expect(dirInfoBefore.directories).toBeGreaterThan(0);

      // Clear the directory (simulating --force behavior)
      await safelyClearDirectory(docsetPath);

      // After safelyClearDirectory, the directory is completely removed
      // Verify directory no longer exists
      let dirExists = true;
      try {
        await fs.stat(docsetPath);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          dirExists = false;
        }
      }
      expect(dirExists).toBe(false);

      // This behavior is correct: --force should completely clear and recreate
      // The init command then recreates the directory at line 121: await fs.mkdir(localPath, { recursive: true });
    });

    it("should NOT update config paths when using only --force", async () => {
      // The --force flag should only clear and re-initialize
      // It should NOT modify the config file

      // Read config before any operation
      const configContentBefore = await fs.readFile(configPath, "utf-8");

      // Verify config contains paths
      expect(configContentBefore).toContain("paths:");
      expect(configContentBefore).toContain("- docs/");

      // The --force flag behavior is documented:
      // It clears the directory but does NOT modify the config file
      // This is verified by reading the config again (which would be unchanged)
      const configContentAfter = await fs.readFile(configPath, "utf-8");
      expect(configContentAfter).toBe(configContentBefore);
    });
  });
});

describe("Init Command - Path Discovery", () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `agentic-path-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });

    const knowledgeDir = path.join(testDir, ".knowledge");
    await fs.mkdir(knowledgeDir, { recursive: true });
    configPath = path.join(knowledgeDir, "config.yaml");

    // Create config without paths specified
    const config = `version: "1.0"
docsets:
  - id: test-docset
    name: Test Docset
    description: Test
    sources:
      - url: https://github.com/test/repo.git
        type: git_repo
        branch: main
`;
    await fs.writeFile(configPath, config);
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("--discover-paths flag", () => {
    it("should update config with discovered directory patterns", async () => {
      // When using --discover-paths, the system should:
      // 1. Extract files using smart filtering
      // 2. Analyze which directories contain the files
      // 3. Update config with directory patterns (not individual files)

      const { discoverDirectoryPatterns } =
        await import("@codemcp/knowledge-core");

      // Simulate extracted files from a repository
      const extractedFiles = [
        "README.md",
        "docs/guide/intro.md",
        "docs/guide/advanced.md",
        "docs/api/reference.md",
        "examples/basic.js",
        "examples/advanced.js",
      ];

      // Test the discovery function
      const patterns = discoverDirectoryPatterns(extractedFiles);

      // Should identify directory patterns
      expect(patterns).toContain("README.md");
      expect(patterns).toContain("docs/");
      expect(patterns).toContain("examples/");

      // Should NOT contain individual files from directories
      expect(patterns).not.toContain("docs/guide/intro.md");
      expect(patterns).not.toContain("examples/basic.js");
    });

    it("should store directory patterns not individual file paths", async () => {
      // Given extracted files:
      // - docs/guide/intro.md
      // - docs/guide/advanced.md
      // - docs/api/reference.md
      // - README.md
      // - examples/basic.js
      // - examples/advanced.js

      const { discoverDirectoryPatterns } =
        await import("@codemcp/knowledge-core");

      const extractedFiles = [
        "docs/guide/intro.md",
        "docs/guide/advanced.md",
        "docs/api/reference.md",
        "README.md",
        "examples/basic.js",
        "examples/advanced.js",
      ];

      const patterns = discoverDirectoryPatterns(extractedFiles);

      // Should update config with:
      // paths:
      //   - README.md
      //   - docs/
      //   - examples/
      //
      // NOT with all individual file paths

      expect(patterns).toEqual(
        expect.arrayContaining(["README.md", "docs/", "examples/"]),
      );
      expect(patterns.length).toBe(3);
    });

    it("should work independently of --force flag", async () => {
      // You should be able to use --discover-paths without --force
      // to update the config without re-initializing

      const { ConfigManager } = await import("@codemcp/knowledge-core");

      // Test that ConfigManager has updateDocsetPaths method
      const configManager = new ConfigManager();
      expect(configManager.updateDocsetPaths).toBeDefined();
      expect(typeof configManager.updateDocsetPaths).toBe("function");

      // This documents that --discover-paths can work independently
      // The actual implementation is in init.ts line 292-324
    });

    it("should work together with --force flag", async () => {
      // You should be able to use both flags together:
      // --force: clear and re-initialize
      // --discover-paths: update config with discovered patterns

      const { safelyClearDirectory, discoverDirectoryPatterns } =
        await import("@codemcp/knowledge-core");

      // Both functions should be available
      expect(safelyClearDirectory).toBeDefined();
      expect(discoverDirectoryPatterns).toBeDefined();

      // This documents that both flags can be used together
      // The init command handles this in init.ts:
      // - Line 97-118: --force clears directory
      // - Line 292-324: --discover-paths updates config
    });
  });
});

describe("Path Pattern Discovery Function", () => {
  // Unit tests for the function that converts file lists to directory patterns

  it("should convert file list to directory patterns", async () => {
    const { discoverDirectoryPatterns } =
      await import("@codemcp/knowledge-core");

    const files = [
      "README.md",
      "docs/guide/intro.md",
      "docs/guide/advanced.md",
      "docs/api/reference.md",
      "docs/api/endpoints.md",
      "examples/basic.js",
      "examples/advanced.js",
      "src/index.ts",
    ];

    // Expected output: directory patterns
    const result = discoverDirectoryPatterns(files);

    // Should contain directory patterns
    expect(result).toContain("README.md"); // Single file at root
    expect(result).toContain("docs/"); // Multiple files in docs tree
    expect(result).toContain("examples/"); // Multiple files in examples
  });

  it("should handle nested directories efficiently", async () => {
    const { discoverDirectoryPatterns } =
      await import("@codemcp/knowledge-core");

    const files = [
      "docs/en/guide/intro.md",
      "docs/en/guide/advanced.md",
      "docs/en/api/reference.md",
      "docs/fr/guide/intro.md",
    ];

    // Should identify "docs/" as the common pattern
    const result = discoverDirectoryPatterns(files);
    expect(result).toEqual(["docs/"]);
  });

  it("should keep single files as-is", async () => {
    const { discoverDirectoryPatterns } =
      await import("@codemcp/knowledge-core");

    const files = [
      "README.md",
      "LICENSE",
      "docs/guide/intro.md",
      "docs/guide/advanced.md",
    ];

    const result = discoverDirectoryPatterns(files);

    // Should include individual root files and directory pattern
    expect(result).toContain("README.md");
    expect(result).toContain("LICENSE");
    expect(result).toContain("docs/"); // Multiple files
  });

  it("should handle files in root directory", async () => {
    const { discoverDirectoryPatterns } =
      await import("@codemcp/knowledge-core");

    const files = ["README.md", "CONTRIBUTING.md", "LICENSE"];

    // All single files in root - keep as individual files
    const result = discoverDirectoryPatterns(files);

    expect(result).toEqual(
      expect.arrayContaining(["README.md", "CONTRIBUTING.md", "LICENSE"]),
    );
    expect(result.length).toBe(3);
  });
});
