# Agentic Knowledge User Guide

Complete guide to using Agentic Knowledge for managing and searching documentation.

## Table of Contents

- [Installation](#installation)
- [Docset Lifecycle](#docset-lifecycle)
- [CLI Commands](#cli-commands)
- [Configuration Guide](#configuration-guide)
- [Complete Workflows](#complete-workflows)
- [MCP Integration](#mcp-integration)
- [Troubleshooting](#troubleshooting)

## Installation

### From NPM (Recommended)

```bash
# Install in your project
npm install @codemcp/knowledge

# Or use directly with npx (no installation needed)
npx @codemcp/knowledge --help
```

### From Source

Since the packages aren't published to npm yet, you can install them locally:

1. **Build all packages:**

   ```bash
   pnpm install
   pnpm build
   ```

2. **Create local installation packages:**

   ```bash
   pnpm run pack:local
   ```

   This creates `dist-local/` directory with packages that have workspace dependencies converted to relative file paths.

3. **Install the MCP server locally:**

   ```bash
   # Option 1: Install from tarball
   cd dist-local/mcp-server && npm pack
   npm install -g codemcp-knowledge-mcp-server-0.1.0.tgz

   # Option 2: Install directly from directory
   npm install -g ./dist-local/mcp-server/
   ```

4. **Verify installation:**
   ```bash
   npx @codemcp/knowledge --help
   ```

## Docset Lifecycle

A docset goes through the following phases:

```
1. CREATE     → Configure docset (manually edit config.yaml or use CLI presets)
2. INITIALIZE → Download and prepare documentation files
3. USE        → Search and navigate via MCP server
4. REFRESH    → Update documentation as needed
```

### Phase 1: CREATE

Define a docset in `.knowledge/config.yaml` either manually or using the CLI `create` command.

### Phase 2: INITIALIZE

Download and prepare documentation files to make them searchable. For git repos, this clones and filters the content. For local folders, this creates symlinks.

### Phase 3: USE

The MCP server exposes the docsets to AI assistants via the `search_docs` and `list_docsets` tools.

### Phase 4: REFRESH

Update already-initialized docsets with the latest content from their sources.

## CLI Commands

The `npx @codemcp/knowledge` CLI provides commands to manage your documentation lifecycle. When you run `npx @codemcp/knowledge-server` without arguments, it starts the MCP server. With arguments to `npx @codemcp/knowledge`, it executes CLI commands.

### `create` - Create New Docset Configuration

Create docset configurations quickly using presets. Alternatively, you can manually edit `.knowledge/config.yaml` - this command is just a convenience tool that does it for you.

**Git Repository Preset:**

```bash
npx @codemcp/knowledge create \
  --preset git-repo \
  --id mcp-sdk \
  --name "MCP TypeScript SDK" \
  --url https://github.com/modelcontextprotocol/typescript-sdk.git \
  --branch main
```

**Local Folder Preset:**

```bash
npx @codemcp/knowledge create \
  --preset local-folder \
  --id my-docs \
  --name "My Documentation" \
  --path ./docs
```

**Options:**

- `--preset <type>`: Choose preset (`git-repo` or `local-folder`)
- `--id <id>`: Unique identifier for the docset
- `--name <name>`: Human-readable name
- `--url <url>`: Git repository URL (for git-repo preset)
- `--branch <branch>`: Git branch (optional, defaults to main)
- `--path <path>`: Local directory path (for local-folder preset)

The `create` command:

- ✅ Creates or updates `.knowledge/config.yaml`
- ✅ Validates docset ID uniqueness
- ✅ Prepares configuration for initialization

### `init` - Initialize Docset Sources

Initialize a configured docset by downloading and preparing documentation. Use this for **first-time setup**.

```bash
# Initialize a specific docset
npx @codemcp/knowledge init mcp-sdk

# Force re-initialization (clears directory and re-extracts)
npx @codemcp/knowledge init mcp-sdk --force

# Discover and update path patterns in config
npx @codemcp/knowledge init mcp-sdk --discover-paths

# Both together (clear, re-extract, and update config)
npx @codemcp/knowledge init mcp-sdk --force --discover-paths

# Use custom config path
npx @codemcp/knowledge init mcp-sdk --config /path/to/config.yaml
```

**Options:**

- **`--force`**: Clears the docset directory completely before re-initialization
  - ✅ Removes all files, directories, and symlinks
  - ✅ **Safe for local folders**: Only removes symlinks, never deletes source files
  - ✅ Starts with a clean slate based on current configuration
  - Use when: You've changed paths configuration and want a fresh start

- **`--discover-paths`**: Automatically discovers and updates path patterns in config
  - ✅ Scans extracted files and identifies directory patterns
  - ✅ Converts individual file paths to directory patterns (e.g., `docs/`)
  - ✅ Updates `.knowledge/config.yaml` with discovered patterns
  - ✅ Keeps config clean by avoiding hundreds of individual file paths
  - Use when: You want to auto-generate optimal path configuration

**When to use:**

- Setting up a docset for the first time
- With `--force`: Completely reset after changing path configuration
- With `--discover-paths`: Auto-discover optimal path patterns
- With both: Fresh start and auto-configure paths

**What happens during initialization:**

1. **For Git Repositories:**
   - Clones repository to temporary directory
   - Extracts files based on `paths` configuration:
     - If `paths` specified: Extracts only those paths
     - If no `paths`: Uses smart filtering (documentation files only)
   - Applies intelligent filtering (excludes `node_modules/`, build artifacts, tests, etc.)
   - Copies documentation to `.knowledge/docsets/{id}/`
   - Creates metadata files for change tracking
   - With `--discover-paths`: Analyzes extracted files and updates config with directory patterns

2. **For Local Folders:**
   - Creates symlinks in `.knowledge/docsets/{id}/`
   - **Safety guarantee**: Source files are NEVER deleted, only symlinks
   - No file duplication
   - Changes to source files are immediately visible
   - With `--force`: Safely removes old symlinks before creating new ones

3. **Creates Metadata:**
   - `.agentic-metadata.json` - Overall docset information
   - `.agentic-source-{index}.json` - Per-source tracking with content hashes

**Path Configuration vs Discovery:**

**Manual path configuration (recommended for control):**

```yaml
sources:
  - type: git_repo
    url: https://github.com/example/repo.git
    paths:
      - README.md
      - docs/ # Directory pattern
      - examples/ # Another directory pattern
```

**Auto-discovered paths (good for initial setup):**

```bash
# Start without paths, discover what files exist
npx @codemcp/knowledge init my-docset --discover-paths
```

This analyzes the extracted files and updates your config with optimal directory patterns instead of listing hundreds of individual files.

**Directory structure after init:**

```
.knowledge/
├── config.yaml
├── .gitignore (auto-created)
└── docsets/
    └── mcp-sdk/
        ├── .agentic-metadata.json
        ├── .agentic-source-0.json
        └── [documentation files...]
```

**Safety Notes:**

When using `--force` with local folder sources:

- Only symlinks in `.knowledge/docsets/{id}/` are removed
- Your original source files are **never deleted**
- You'll see a confirmation message: "Symlinks will be removed, but source files are preserved"

### `status` - Check Docset Status

View the status of all docsets and their sources:

```bash
# Basic status
npx @codemcp/knowledge status

# Detailed status with source information
npx @codemcp/knowledge status --verbose

# Use custom config
npx @codemcp/knowledge status --config /path/to/config.yaml
```

**Example output:**

```
📊 Docset Status

mcp-sdk (MCP TypeScript SDK)
   Initialized | 45 files | 2 source(s) loaded
   Initialized: 2024-11-20

react-docs (React Documentation)
   Initialized | 120 files | 1 source(s) loaded
   Initialized: 2024-11-15

api-docs (API Documentation)
   Not initialized | 1 source(s) configured

   💡 Run: npx @codemcp/knowledge init api-docs
```

### `refresh` - Update Documentation

Update already-initialized docsets with latest content. This is a **smart, incremental update**.

```bash
# Refresh all docsets
npx @codemcp/knowledge refresh

# Refresh specific docset
npx @codemcp/knowledge refresh mcp-sdk

# Force refresh (ignore throttle)
npx @codemcp/knowledge refresh mcp-sdk --force

# Use custom config
npx @codemcp/knowledge refresh --config /path/to/config.yaml
```

**Smart refresh logic:**

- Checks Git commit hash to detect changes
- Skips refresh if no changes detected
- Skips refresh if updated within 1 hour (unless `--force`)
- Updates in place (preserves metadata)

**When to use:**

- Getting latest updates from git repositories
- Routine maintenance/updates
- Checking for new content

**Key differences between commands:**

| Command                         | When to Use                  | Behavior                            | Config Changes |
| ------------------------------- | ---------------------------- | ----------------------------------- | -------------- |
| `init`                          | First-time setup             | Downloads/creates fresh             | No             |
| `init --force`                  | Reset after config changes   | Clears directory, re-extracts       | No             |
| `init --discover-paths`         | Auto-configure paths         | Normal init + updates config        | Yes            |
| `init --force --discover-paths` | Complete reset + auto-config | Clears, re-extracts, updates config | Yes            |
| `refresh`                       | Routine updates              | Smart incremental update            | No             |
| `refresh --force`               | Force update check           | Ignores time throttle               | No             |

**Choosing the right command:**

- Changed `paths` in config? → `init --force`
- Want to auto-discover optimal paths? → `init --discover-paths`
- Regular update from git repo? → `refresh`
- Something seems broken? → `init --force` to start fresh

## Configuration Guide

### Configuration File Location

Place your configuration file at `.knowledge/config.yaml` in your project root.

The configuration is resolved in this order:

1. `KNOWLEDGE_SUBDIR`, if set: the directory holding `config.yaml` — usually the
   `.knowledge` directory itself (`/path/to/project/.knowledge`), not a
   subdirectory inside it and not the project root. When that directory has no
   `config.yaml`, no configuration is loaded — the override is never silently
   ignored.
2. `config.yaml` in a `.knowledge` directory, searched upwards from
   `PROJECT_DIR` if set, otherwise from the working directory.
3. `~/.knowledge/config.yaml` in your home directory, as a shared fallback for
   docsets you want available everywhere.

Steps 1 and 3 exist because GUI launchers give the server a working directory
that has nothing to do with your project: Claude Desktop reports
`/Applications`, VS Code its own app bundle. Walking up from there reaches
neither your project nor your home directory, so set `PROJECT_DIR` (or
`KNOWLEDGE_SUBDIR`) in the server environment, or keep the docsets in
`~/.knowledge/config.yaml`.

The home fallback in step 3 is deliberate per command, never a blanket default:

- The MCP server, `status`, `init` and `refresh` use it. They read or update a
  docset that is already declared, so a machine-wide config is a valid answer —
  otherwise docsets in `~/.knowledge/config.yaml` could only be managed from
  your home directory.
- `create` does not. Without a project configuration it creates
  `.knowledge/config.yaml` in the current directory instead of appending the new
  docset to your home configuration.

`init` and `refresh` write to the configuration that declared the docset (and to
the `.knowledge` directory beside it), so initialising a docset that only exists
in `~/.knowledge/config.yaml` updates that file — the config you declared it in.

### Local Folder Sources

For documentation stored locally in your project:

```yaml
docsets:
  - id: my-project
    name: My Project Docs
    sources:
      - type: local_folder
        paths:
          - "./docs" # Single directory
          - "./guides" # Multiple directories
          - "./api/README.md" # Specific files
```

**Benefits:**

- ✅ **No file duplication** - creates symlinks to original locations
- ✅ **Real-time updates** - changes immediately visible
- ✅ **Relative paths** - returns clean relative paths for LLM navigation

### Git Repository Sources

For documentation from remote repositories:

```yaml
docsets:
  - id: external-docs
    name: External Documentation
    sources:
      - type: git_repo
        url: "https://github.com/owner/repo.git"
        branch: "main" # Optional, defaults to main
        paths: ["docs/", "README.md"] # Optional, extracts specific paths
```

**Path configuration strategies:**

1. **Explicit paths (recommended)**: Specify exactly what to extract

   ```yaml
   paths:
     - README.md
     - docs/
     - examples/
   ```

2. **Auto-discovery**: Use `--discover-paths` flag during init to automatically detect optimal paths

   ```bash
   npx @codemcp/knowledge init my-docset --discover-paths
   ```

   This analyzes extracted files and updates config with directory patterns instead of individual files.

3. **Smart filtering (no paths specified)**: Automatically extracts documentation files
   - Includes: `*.md`, `*.mdx`, `*.rst`, README files, `docs/`, `examples/`
   - Excludes: `node_modules/`, `build/`, `dist/`, tests, `.git/`

**Benefits:**

- ✅ **Automatic downloads** - fetches latest documentation
- ✅ **Selective extraction** - only downloads specified paths
- ✅ **Branch selection** - target specific branches or tags
- ✅ **Path discovery** - automatically find optimal directory patterns

### Mixed Configuration

Combine local and remote sources in one configuration:

```yaml
version: "1.0"
docsets:
  - id: local-guides
    name: Local User Guides
    sources:
      - type: local_folder
        paths: ["./docs/guides"]

  - id: api-reference
    name: API Reference
    sources:
      - type: git_repo
        url: "https://github.com/company/api-docs.git"
        paths: ["reference/"]

  - id: mixed-sources
    name: Combined Documentation
    sources:
      - type: local_folder
        paths: ["./internal-docs"]
      - type: git_repo
        url: "https://github.com/external/docs.git"
```

### Advanced: Custom Search Templates

You can customize the search instructions provided to AI assistants:

```yaml
version: "1.0"
docsets:
  - id: react-docs
    name: React Documentation
    description: "React framework documentation"
    sources:
      - type: local_folder
        paths: ["./docs/react-18.2"]
    template: |
      Search for '{{keywords}}' in {{local_path}}/hooks/.
      If not found, try '{{generalized_keywords}}' in {{local_path}}/patterns/.
      Follow any cross-references you discover.
```

**Template variables:**

- `{{keywords}}` - Primary search terms
- `{{generalized_keywords}}` - Broader context terms
- `{{local_path}}` - Path to the docset

## Complete Workflows

### Workflow 1: Local Project Documentation

```bash
# 1. Create config for local docs
npx @codemcp/knowledge create \
  --preset local-folder \
  --id my-project \
  --name "My Project Docs" \
  --path ./docs

# 2. Check status
npx @codemcp/knowledge status

# 3. Configure Claude Desktop (see MCP Integration section)
# The server runs automatically when Claude launches
```

No initialization needed - local folders use symlinks!

### Workflow 2: External Git Repository

```bash
# 1. Create docset for a Git repository
npx @codemcp/knowledge create \
  --preset git-repo \
  --id react-docs \
  --name "React Documentation" \
  --url https://github.com/facebook/react.git \
  --branch main

# 2. Initialize the docset (downloads docs)
npx @codemcp/knowledge init react-docs

# 3. Check status
npx @codemcp/knowledge status

# 4. Configure Claude Desktop (see MCP Integration section)
# The server runs automatically when Claude launches

# Later: Update documentation
npx @codemcp/knowledge refresh react-docs
```

### Workflow 3: Multi-Repository Setup

```bash
# Set up multiple docsets
npx @codemcp/knowledge create --preset git-repo --id frontend-docs --name "Frontend Docs" --url https://github.com/company/frontend.git
npx @codemcp/knowledge create --preset git-repo --id backend-docs --name "Backend Docs" --url https://github.com/company/backend.git
npx @codemcp/knowledge create --preset local-folder --id internal-docs --name "Internal Docs" --path ./docs

# Initialize git repos
npx @codemcp/knowledge init frontend-docs
npx @codemcp/knowledge init backend-docs

# Check all statuses
npx @codemcp/knowledge status --verbose

# Configure Claude Desktop (see MCP Integration section)
# The server runs automatically when Claude launches
```

### Workflow 4: Auto-Discovering Optimal Paths

When you're not sure which paths to extract from a large repository:

```bash
# 1. Create docset without specifying paths
npx @codemcp/knowledge create \
  --preset git-repo \
  --id large-repo \
  --name "Large Repository Docs" \
  --url https://github.com/large/repository.git

# 2. Initialize with path discovery
# This will:
# - Use smart filtering to extract documentation
# - Analyze the extracted files
# - Update config with optimal directory patterns (e.g., "docs/", "examples/")
npx @codemcp/knowledge init large-repo --discover-paths

# 3. Check what was discovered
npx @codemcp/knowledge status large-repo --verbose

# 4. Review and adjust the auto-generated paths in .knowledge/config.yaml
# The discovered paths will look like:
# paths:
#   - README.md
#   - docs/
#   - examples/
# Instead of 100+ individual file paths!

# 5. If you want to adjust and re-init with different paths:
# Edit .knowledge/config.yaml, then:
npx @codemcp/knowledge init large-repo --force
```

### Workflow 5: Managing Path Configuration Changes

When you need to change which paths are extracted from a git repository:

```bash
# Scenario: You initially had paths: ["docs/"]
# Now you want: ["docs/", "examples/", "README.md"]

# 1. Edit .knowledge/config.yaml and update the paths:
#    sources:
#      - type: git_repo
#        paths:
#          - README.md
#          - docs/
#          - examples/

# 2. Force re-initialization to apply new configuration
# This completely clears the old content and re-extracts based on new paths
npx @codemcp/knowledge init my-docset --force

# Output you'll see:
# 🗑️  Clearing existing directory...
#     Removing: 50 files, 3 dirs, 0 symlinks
# 🔄 Loading source 1/1: https://github.com/...
#     ✅ Copied 75 files using smart filtering

# 3. Verify the changes
npx @codemcp/knowledge status my-docset --verbose
```

## MCP Integration

### MCP Server

When you run `npx @codemcp/knowledge-server` without arguments, it starts an MCP server that exposes two tools:

#### `search_docs` Tool

Get navigation guidance for specific queries:

```typescript
search_docs({
  docset_id: "react-docs",
  keywords: "useEffect cleanup",
  generalized_keywords: "hooks lifecycle memory",
});
```

**Returns:**

```json
{
  "instructions": "Search for 'useEffect cleanup' in .knowledge/docsets/react-docs/hooks/...",
  "search_terms": "useEffect cleanup",
  "generalized_search_terms": "hooks lifecycle memory",
  "path": ".knowledge/docsets/react-docs"
}
```

#### `list_docsets` Tool

Discover available documentation sets:

```typescript
list_docsets();
```

**Returns:**

```
Found 2 available docset(s):

**react-docs** (React Documentation)
  Description: Official React documentation
  Path: .knowledge/docsets/react-docs

**my-docs** (My Project Documentation)
  Description: Internal project documentation
  Path: docs
```

### Configuring MCP Clients

#### Claude Desktop

**Configuration file location:**

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

**Option 1: Using npx (recommended)**

```json
{
  "mcpServers": {
    "agentic-knowledge": {
      "command": "npx",
      "args": ["-y", "@codemcp/knowledge-server"]
    }
  }
}
```

The `-y` flag automatically confirms the installation prompt from npx.

**Option 2: Project-specific installation**

If you have agentic-knowledge installed in a specific project:

```json
{
  "mcpServers": {
    "agentic-knowledge": {
      "command": "npx",
      "args": ["-y", "@codemcp/knowledge-server"],
      "cwd": "/absolute/path/to/your/project"
    }
  }
}
```

This runs the server in your project directory, making it use your project's `.knowledge/config.yaml`.

**Option 3: Global npm installation**

If you installed globally with `npm install -g @codemcp/knowledge-server`:

```json
{
  "mcpServers": {
    "agentic-knowledge": {
      "command": "npx",
      "args": ["-y", "@codemcp/knowledge-server"]
    }
  }
}
```

**After configuration:**

1. Restart Claude Desktop
2. The server starts automatically in the background
3. Look for the 🔌 icon in Claude Desktop to verify the connection

#### Other MCP Clients

For other MCP clients, use:

- **Command**: `npx`
- **Args**: `["-y", "@codemcp/knowledge-server"]`
- **Transport**: stdio

The server will start automatically when the MCP client launches.

### Using in AI Conversations

Once configured, simply ask questions:

```
"How do I implement authentication in our API?"
"Show me examples of React hooks cleanup"
"Find the rate limiting configuration"
```

The AI assistant will:

1. Call `search_docs` with appropriate keywords
2. Receive navigation instructions
3. Use grep/ripgrep to search the documentation
4. Read relevant files with full context
5. Provide accurate answers

## Troubleshooting

### MCP Server Won't Start

**Error**: "No configuration file found"

**Solution**: Create `.knowledge/config.yaml` or the server will start with no docsets (shows setup instructions in tool descriptions).

If the configuration exists but the server does not see it, the client most
likely starts the server outside your project tree (a GUI launcher reports its
own working directory). Set `PROJECT_DIR` to your project or `KNOWLEDGE_SUBDIR`
to the `.knowledge` directory in the server's environment, or put the docsets in
`~/.knowledge/config.yaml`.

### Docset Not Initialized

**Error**: "Docset 'X' is not initialized"

**Solution**: Run `npx @codemcp/knowledge init X`

### Git Clone Failures

**Error**: "Failed to clone repository"

**Solutions:**

- Check internet connection
- Verify repository URL is correct
- Ensure you have access to private repositories
- Try with `--branch` flag if default branch isn't `main`

### Status Shows Old Data

**Solution**: Run `npx @codemcp/knowledge refresh <docset-id>` to update

### Symlinks Not Working

**Issue**: Local folder changes not reflected

**Solutions:**

- Verify the source paths exist
- Check file permissions
- Re-run `npx @codemcp/knowledge create` with the local folder preset

### Search Not Finding Results

**Tips:**

- Try broader keywords with `generalized_keywords`
- Check the docset is initialized: `npx @codemcp/knowledge status`
- Verify the documentation actually contains the terms
- Use verbose status to see which files are included

### Changed Paths But Still Seeing Old Files

**Issue**: Modified `paths` configuration but old files remain after re-init

**Solution**: Use `init --force` to completely clear and re-extract:

```bash
npx @codemcp/knowledge init my-docset --force
```

This ensures:

- Old files are removed
- Only files matching current `paths` configuration are extracted
- For local folders: Old symlinks are removed, new ones created

### Too Many Individual File Paths in Config

**Issue**: Config has hundreds of individual file paths instead of directory patterns

**Solution**: Use `init --discover-paths` to auto-optimize:

```bash
npx @codemcp/knowledge init my-docset --force --discover-paths
```

This will convert something like:

```yaml
paths:
  - docs/guide/intro.md
  - docs/guide/advanced.md
  - docs/api/reference.md
  # ... 50+ more files
```

Into clean directory patterns:

```yaml
paths:
  - README.md
  - docs/
  - examples/
```

### Worried About Deleting Source Files

**Concern**: Using `--force` with local folder sources

**Guarantee**: Source files are **NEVER deleted**

- Only symlinks in `.knowledge/docsets/{id}/` are removed
- Your original files in the source directories remain untouched
- Node.js does not follow symlinks when removing directories
- You'll see a safety message confirming this during the operation

**Example safe operation:**

```bash
# Your source files in ./docs/ will NOT be deleted
npx @codemcp/knowledge init my-local-docs --force
```

Output shows:

```
🗑️  Clearing existing directory...
    Removing: 0 files, 0 dirs, 3 symlinks
    ⚠️  Note: Symlinks will be removed, but source files are preserved
```

---

For more information, see the [README](./README.md) or check the [examples](./examples/) directory.
