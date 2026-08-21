/**
 * Typed API for querying docset status.
 */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import {
  findConfigPathSync,
  loadConfigSync,
  calculateLocalPath,
} from "@codemcp/knowledge-core";
import type {
  StatusParams,
  StatusResult,
  DocsetStatusInfo,
  DocsetSourceStatus,
} from "./types.js";

interface RawDocsetMetadata {
  docset_id: string;
  docset_name: string;
  initialized_at: string;
  last_refreshed?: string;
  total_files: number;
  sources_count: number;
}

interface RawSourceMetadata {
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
 * Return the initialisation status for every docset in the configuration.
 *
 * @throws {Error} when no configuration file can be found.
 */
export async function getStatus(params?: StatusParams): Promise<StatusResult> {
  const cwd = params?.cwd ?? process.cwd();
  // Read-only: report on whichever config the other commands would use,
  // including a machine-wide ~/.knowledge/config.yaml
  const configPath = findConfigPathSync(cwd, { includeHome: true });
  if (!configPath) {
    throw new Error(
      "No configuration file found. Ensure .knowledge/config.yaml exists in the project or your home directory.",
    );
  }

  const config = loadConfigSync(configPath);
  const docsets: DocsetStatusInfo[] = [];

  for (const docset of config.docsets) {
    docsets.push(await getDocsetStatus(docset, configPath));
  }

  return { configPath, docsets };
}

async function getDocsetStatus(
  docset: {
    id: string;
    name: string;
    description?: string;
    sources?: unknown[];
  },
  configPath: string,
): Promise<DocsetStatusInfo> {
  try {
    const localPath = calculateLocalPath(
      docset as Parameters<typeof calculateLocalPath>[0],
      configPath,
    );
    const metadataPath = path.join(localPath, ".agentic-metadata.json");

    let rawMetadata: RawDocsetMetadata | null = null;
    try {
      rawMetadata = JSON.parse(await fs.readFile(metadataPath, "utf8"));
    } catch {
      const notInit: DocsetStatusInfo = {
        id: docset.id,
        name: docset.name,
        initialized: false,
        sources: [],
      };
      if (docset.description !== undefined)
        notInit.description = docset.description;
      return notInit;
    }

    const sources: DocsetSourceStatus[] = [];
    for (let i = 0; i < (docset.sources?.length ?? 0); i++) {
      try {
        const srcPath = path.join(localPath, `.agentic-source-${i}.json`);
        const raw: RawSourceMetadata = JSON.parse(
          await fs.readFile(srcPath, "utf8"),
        );
        const entry: DocsetSourceStatus = {
          sourceUrl: raw.source_url,
          sourceType: raw.source_type,
          downloadedAt: raw.downloaded_at,
          filesCount: raw.files_count,
        };
        if (raw.last_commit !== undefined) entry.lastCommit = raw.last_commit;
        if (raw.content_hash !== undefined)
          entry.contentHash = raw.content_hash;
        sources.push(entry);
      } catch {
        // Source metadata missing — skip.
      }
    }

    const initialized: DocsetStatusInfo = {
      id: docset.id,
      name: docset.name,
      initialized: true,
      sources,
    };
    if (docset.description !== undefined)
      initialized.description = docset.description;
    if (rawMetadata) {
      const meta: DocsetStatusInfo["metadata"] = {
        initializedAt: rawMetadata.initialized_at,
        totalFiles: rawMetadata.total_files,
        sourcesCount: rawMetadata.sources_count,
      };
      if (rawMetadata.last_refreshed !== undefined) {
        meta.lastRefreshed = rawMetadata.last_refreshed;
      }
      initialized.metadata = meta;
    }
    return initialized;
  } catch (error) {
    const errInfo: DocsetStatusInfo = {
      id: docset.id,
      name: docset.name,
      initialized: false,
      sources: [],
      error: error instanceof Error ? error.message : String(error),
    };
    if (docset.description !== undefined)
      errInfo.description = docset.description;
    return errInfo;
  }
}
