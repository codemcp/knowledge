/**
 * Typed API for refreshing docset sources.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";
import {
  findConfigPathSync,
  loadConfigSync,
  calculateLocalPath,
  ensureKnowledgeGitignoreSync,
} from "@codemcp/knowledge-core";
import {
  ArchiveLoader,
  WebSourceType,
} from "@codemcp/knowledge-content-loader";
import type {
  RefreshParams,
  RefreshResult,
  DocsetRefreshResult,
} from "./types.js";

interface DocsetMetadata {
  docset_id: string;
  docset_name: string;
  initialized_at: string;
  last_refreshed?: string;
  total_files: number;
  sources_count: number;
}

interface SourceMetadata {
  source_url: string;
  source_type: string;
  downloaded_at: string;
  files_count: number;
  files: string[];
  docset_id: string;
  last_commit?: string;
  content_hash?: string;
}

/**
 * Refresh sources for one or all docsets.
 *
 * For each docset the function pulls the latest content from every configured
 * source and updates the metadata files on disk. Docsets that have not been
 * initialised yet are silently skipped (check `skipped` / `skipReason` on
 * the returned results).
 *
 * @throws {Error} when the config cannot be found or a named docset is unknown.
 */
export async function refreshDocsets(
  params?: RefreshParams,
): Promise<RefreshResult> {
  const { docsetId, force = false, cwd = process.cwd() } = params ?? {};

  // Like init, refresh works on already declared docsets, so a machine-wide
  // ~/.knowledge/config.yaml is a legitimate source to refresh from
  const configPath = findConfigPathSync(cwd, { includeHome: true });
  if (!configPath) {
    throw new Error(
      "No configuration file found. Ensure .knowledge/config.yaml exists in the project or your home directory.",
    );
  }

  const config = loadConfigSync(configPath);
  ensureKnowledgeGitignoreSync(configPath);

  const docsetsToRefresh = docsetId
    ? config.docsets.filter((d) => d.id === docsetId)
    : config.docsets.filter((d) => d.sources && d.sources.length > 0);

  if (docsetsToRefresh.length === 0) {
    if (docsetId) {
      const available = config.docsets
        .filter((d) => d.sources && d.sources.length > 0)
        .map((d) => d.id)
        .join(", ");
      throw new Error(
        `Docset '${docsetId}' not found or has no sources. Available: ${available || "none"}`,
      );
    }
    return { docsets: [] };
  }

  const results: DocsetRefreshResult[] = [];

  for (const docset of docsetsToRefresh) {
    const result = await refreshSingleDocset(docset, configPath, force);
    results.push(result);
  }

  return { docsets: results };
}

async function refreshSingleDocset(
  docset: { id: string; sources?: unknown[] },
  configPath: string,
  force: boolean,
): Promise<DocsetRefreshResult> {
  const localPath = calculateLocalPath(
    docset as Parameters<typeof calculateLocalPath>[0],
    configPath,
  );
  const metadataPath = path.join(localPath, ".agentic-metadata.json");

  // Must be initialised first.
  let metadata: DocsetMetadata | null = null;
  try {
    metadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
  } catch {
    return {
      docsetId: docset.id,
      success: true,
      skipped: true,
      skipReason: "Not initialized — run init first",
    };
  }

  // Skip if refreshed very recently (< 1 h) and force is not set.
  if (!force && metadata) {
    const lastRefresh = metadata.last_refreshed ?? metadata.initialized_at;
    const hoursSince =
      (Date.now() - new Date(lastRefresh).getTime()) / (1000 * 60 * 60);
    if (hoursSince < 1) {
      return {
        docsetId: docset.id,
        success: true,
        skipped: true,
        skipReason: `Recently refreshed (${Math.round(hoursSince * 60)} minutes ago)`,
      };
    }
  }

  // Back up metadata so we can restore on failure.
  const backupPath = path.join(localPath, ".agentic-metadata.backup.json");
  await fs.copyFile(metadataPath, backupPath);

  try {
    let totalFiles = 0;
    let sourcesRefreshed = 0;
    const sources = (docset as { sources?: unknown[] }).sources ?? [];

    for (const [index, source] of sources.entries()) {
      const src = source as {
        type: string;
        url?: string;
        path?: string;
        paths?: string[];
        branch?: string;
      };

      if (src.type === "git_repo") {
        const sm = await refreshGitSource(
          src,
          localPath,
          index,
          docset.id,
          force,
        );
        totalFiles += sm.files_count;
        sourcesRefreshed++;
      } else if (src.type === "archive") {
        const sm = await refreshArchiveSource(
          src,
          localPath,
          index,
          docset.id,
          force,
        );
        totalFiles += sm.files_count;
        sourcesRefreshed++;
      }
      // local_folder sources do not need refreshing (they are symlinked).
    }

    const updatedMetadata: DocsetMetadata = {
      docset_id: metadata!.docset_id,
      docset_name: metadata!.docset_name,
      initialized_at: metadata!.initialized_at,
      last_refreshed: new Date().toISOString(),
      total_files: totalFiles,
      sources_count: sources.length,
    };

    await fs.writeFile(metadataPath, JSON.stringify(updatedMetadata, null, 2));
    await fs.unlink(backupPath);

    return {
      docsetId: docset.id,
      success: true,
      skipped: false,
      totalFiles,
      sourcesRefreshed,
    };
  } catch (error) {
    // Attempt to restore from backup.
    try {
      await fs.copyFile(backupPath, metadataPath);
      await fs.unlink(backupPath);
    } catch {
      // Ignore restore errors.
    }
    return {
      docsetId: docset.id,
      success: false,
      skipped: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function refreshGitSource(
  source: { url?: string; branch?: string; paths?: string[] },
  localPath: string,
  index: number,
  docsetId: string,
  force: boolean,
): Promise<SourceMetadata> {
  const sourceMetadataPath = path.join(
    localPath,
    `.agentic-source-${index}.json`,
  );
  let existing: SourceMetadata | null = null;
  try {
    existing = JSON.parse(await fs.readFile(sourceMetadataPath, "utf8"));
  } catch {
    // No prior metadata — full refresh.
  }

  const tempDir = path.join(localPath, ".tmp", `git-refresh-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });

  try {
    const branch = source.branch ?? "main";
    execSync(
      `git clone --depth 1 --branch ${branch} ${source.url} ${tempDir}`,
      { stdio: "pipe", timeout: 60000 },
    );

    const latestCommit = execSync("git rev-parse HEAD", {
      cwd: tempDir,
      encoding: "utf8",
    }).trim();

    if (!force && existing) {
      const lastCommit = (existing as SourceMetadata & { last_commit?: string })
        .last_commit;
      if (lastCommit === latestCommit) {
        const updated: SourceMetadata = {
          ...existing,
          downloaded_at: new Date().toISOString(),
        };
        await fs.writeFile(
          sourceMetadataPath,
          JSON.stringify(updated, null, 2),
        );
        return updated;
      }
    }

    // Remove old files tracked by this source.
    if (existing) {
      for (const file of existing.files) {
        try {
          await fs.unlink(path.join(localPath, file));
        } catch {
          // Already deleted.
        }
      }
    }

    const filesToCopy: string[] = [];
    const paths = source.paths ?? [];

    if (paths.length > 0) {
      for (const relPath of paths) {
        const srcPath = path.join(tempDir, relPath);
        const dstPath = path.join(localPath, relPath);
        try {
          const stat = await fs.stat(srcPath);
          if (stat.isDirectory()) {
            filesToCopy.push(
              ...(await copyDir(srcPath, dstPath)).map((f) =>
                path.join(relPath, f),
              ),
            );
          } else {
            await fs.mkdir(path.dirname(dstPath), { recursive: true });
            await fs.copyFile(srcPath, dstPath);
            filesToCopy.push(relPath);
          }
        } catch {
          // Skip missing paths.
        }
      }
    } else {
      const mdFiles = await findMarkdownFiles(tempDir);
      for (const file of mdFiles) {
        const rel = path.relative(tempDir, file);
        const dst = path.join(localPath, rel);
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.copyFile(file, dst);
        filesToCopy.push(rel);
      }
    }

    const metadata: SourceMetadata & { last_commit: string } = {
      source_url: source.url ?? "",
      source_type: "git_repo",
      downloaded_at: new Date().toISOString(),
      files_count: filesToCopy.length,
      files: filesToCopy,
      docset_id: docsetId,
      last_commit: latestCommit,
    };

    await fs.writeFile(sourceMetadataPath, JSON.stringify(metadata, null, 2));
    return metadata;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function refreshArchiveSource(
  source: { url?: string; path?: string; paths?: string[] },
  localPath: string,
  index: number,
  docsetId: string,
  force: boolean,
): Promise<SourceMetadata> {
  const sourceMetadataPath = path.join(
    localPath,
    `.agentic-source-${index}.json`,
  );
  let existing: SourceMetadata | null = null;
  try {
    existing = JSON.parse(await fs.readFile(sourceMetadataPath, "utf8"));
  } catch {
    // No prior metadata.
  }

  const sourceUrl = source.url ?? source.path ?? "";
  const loader = new ArchiveLoader();
  const webSourceConfig = {
    url: sourceUrl,
    type: WebSourceType.ARCHIVE,
    options: { paths: source.paths ?? [] },
  };

  if (!force && existing) {
    try {
      const currentId = await loader.getContentId(webSourceConfig);
      const lastHash = (existing as SourceMetadata & { content_hash?: string })
        .content_hash;
      if (lastHash === currentId) {
        const updated: SourceMetadata = {
          ...existing,
          downloaded_at: new Date().toISOString(),
        };
        await fs.writeFile(
          sourceMetadataPath,
          JSON.stringify(updated, null, 2),
        );
        return updated;
      }
    } catch {
      // Cannot check — do full refresh.
    }
  }

  if (existing) {
    for (const file of existing.files) {
      try {
        await fs.unlink(path.join(localPath, file));
      } catch {
        // Already deleted.
      }
    }
  }

  const loadResult = await loader.load(webSourceConfig, localPath);
  if (!loadResult.success) {
    throw new Error(`Archive refresh failed: ${loadResult.error}`);
  }

  const metadata: SourceMetadata & { content_hash?: string } = {
    source_url: sourceUrl,
    source_type: "archive",
    downloaded_at: new Date().toISOString(),
    files_count: loadResult.files.length,
    files: loadResult.files,
    docset_id: docsetId,
    content_hash: loadResult.contentHash,
  };

  await fs.writeFile(sourceMetadataPath, JSON.stringify(metadata, null, 2));
  return metadata;
}

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string) {
    const entries = await fs.readdir(current);
    for (const entry of entries) {
      if (entry.startsWith(".git")) continue;
      const full = path.join(current, entry);
      const stat = await fs.stat(full);
      if (stat.isDirectory()) {
        await walk(full);
      } else if (entry.endsWith(".md") || entry.endsWith(".mdx")) {
        results.push(full);
      }
    }
  }
  await walk(dir);
  return results;
}

async function copyDir(src: string, dst: string): Promise<string[]> {
  const files: string[] = [];
  await fs.mkdir(dst, { recursive: true });
  for (const entry of await fs.readdir(src)) {
    const srcEntry = path.join(src, entry);
    const dstEntry = path.join(dst, entry);
    const stat = await fs.stat(srcEntry);
    if (stat.isDirectory()) {
      files.push(
        ...(await copyDir(srcEntry, dstEntry)).map((f) => path.join(entry, f)),
      );
    } else {
      await fs.copyFile(srcEntry, dstEntry);
      files.push(entry);
    }
  }
  return files;
}
