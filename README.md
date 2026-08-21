# 🧠 Agentic Knowledge

**Search any documentation as if you had written it yourself**

An MCP server that guides AI assistants to navigate documentation using their built-in tools (grep, file reading) instead of traditional RAG. Leverages ever growing capabilities of large language models, better tool-calling and interpretation and agentic search patterns for precise, intelligent documentation discovery.

---

## 🎯 What Is This For?

Give your AI assistant access to any documentation—yours or third-party—so it can find answers as naturally as you would. No embeddings, no vector databases, no complex infrastructure.

**Perfect for:**

- 📚 **Project documentation** - Your team's internal docs, APIs, guides
- 🔧 **Framework references** - React, TypeScript, MCP SDK, any library
- 🏢 **Enterprise knowledge** - Company wikis, architecture docs, runbooks
- 🌐 **Open source projects** - Clone any repo's docs for instant access

## 🚀 Quick Start

### 1. Configure an MCP Client

Add to your coding agent config something along the lines of

```json
{
  "mcpServers": {
    "agentic-knowledge": {
      "command": "npx",
      "args": ["-y", "@codemcp/knowledge@latest"]
    }
  }
}
```

### 2. Set Up Your First Docset

**Option A: Use the CLI (Recommended)**

```bash
# For a Git repository
npx @codemcp/knowledge create \
  --preset git-repo \
  --id react-docs \
  --name "React Documentation" \
  --url https://github.com/facebook/react.git

# Initialize (downloads the docs)
npx @codemcp/knowledge init react-docs

# The MCP server starts automatically when Claude Desktop launches
```

**Option B: Manual Configuration**

Create `.knowledge/config.yaml` (in your project, or in your home directory for
docsets that should be available everywhere; `PROJECT_DIR` and
`KNOWLEDGE_SUBDIR` override where the server looks):

```yaml
version: "1.0"
docsets:
  - id: my-docs
    name: My Project Documentation
    sources:
      - type: local_folder
        paths: ["./docs"]
```

### 3. Use It

Your AI assistant now has access to `search_docs` and `list_docsets` tools. Ask questions naturally:

```
"How do I implement a cleanup function in React useEffect?"
"Show me the authentication setup in our docs"
"Find examples of rate limiting in the API docs"
```

The assistant will receive intelligent navigation instructions and use grep/file reading to find the exact information.

## 📖 Documentation

- **[User Guide](./USER_GUIDE.md)** - Detailed CLI commands, lifecycle, configuration
- **[Examples](./examples/)** - Configuration examples and integration guides
- **[Testing Guide](./TESTING.md)** - Comprehensive testing documentation

## 💡 How and Why It Works

### The Paradigm Shift

Traditional RAG (Retrieval-Augmented Generation) was built for the **context-poor era** when models had 8K token limits. It:

- Chunks documents (losing relationships)
- Computes embeddings (missing precise terminology)
- Retrieves fragments (losing context)
- Requires massive infrastructure (vector DBs, rerankers)

**Agentic Knowledge** leverages modern AI capabilities:

- ✅ **200K+ token context windows** - Can read entire documentation sets
- ✅ **Powerful filesystem tools** - grep, ripgrep, file reading built-in
- ✅ **Intelligent navigation** - Provides search strategies, not fragments
- ✅ **Zero infrastructure** - Just a config file and your docs

### From Retrieval to Navigation

**Traditional RAG says:**
_"Here are 50 fragments that mention your keywords"_

**Agentic Knowledge says:**
_"Search for 'useState' in `./docs/react-18.2/hooks/`. If that doesn't help, try 'state management' in `./docs/patterns/`. Follow any 'See also' references you find."_

**The difference?** Guidance over fragments. Investigation over retrieval.

### How It Actually Works

1. **Configure docsets** - Point to local folders or Git repositories
2. **Initialize** - Downloads/symlinks documentation to `.knowledge/docsets/`
3. **MCP server** - Exposes `search_docs` and `list_docsets` tools
4. **AI searches** - Gets navigation instructions, uses grep/file tools
5. **Finds answers** - Reads complete documents with full context

**Performance:**

- **Setup**: Seconds (vs hours for RAG indexing)
- **Response**: <10ms (vs 300-2000ms for RAG)
- **Infrastructure**: None (vs Elasticsearch + Vector DB)
- **Accuracy**: Complete context (vs fragment-based)

### Inspired By

This approach is inspired by [The RAG Obituary](https://www.nicolasbustamante.com/p/the-rag-obituary-killed-by-agents) by Nicolas Bustamante and how Claude Code revolutionized code analysis by ditching RAG for direct filesystem exploration.

## 🚀 Local Development

```bash
# Install dependencies
pnpm install

# Start development mode
pnpm dev

# Run tests
pnpm test

# Build all packages
pnpm build
```

See [User Guide](./USER_GUIDE.md) for installation from source.

## 🤝 Contributing

This project follows a structured development workflow. See our development documentation for contribution guidelines.

## 📄 License

Distributed under the MIT License. See [`LICENSE`](./LICENSE) file for details.

---

<div align="center">
  <p><strong>🎯 Moving beyond RAG into the agentic era of knowledge systems</strong></p>
  <p><em>Inspired by <a href="https://www.nicolasbustamante.com/p/the-rag-obituary-killed-by-agents">The RAG Obituary</a> by Nicolas Bustamante</em></p>
</div>
