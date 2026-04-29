---
name: semantic-rag
description: "Perform semantic searches across the workspace (leads, notes, audits). Use this when looking for conceptual matches, related business problems, or past decisions where keyword searches (grep) are insufficient."
---

# Semantic RAG (Knowledge Retrieval)

## Purpose
While `grep` is excellent for exact matches and code, it fails at conceptual queries (e.g., "Find all leads with severe security issues" or "Which notes talk about the Good Neighbor approach?"). This skill leverages a local vector database (LanceDB) to perform semantic searches over the workspace.

## Setup (First Time Only)
Ensure the environment is ready:
1. Install requirements: `pip install lancedb sentence-transformers pandas`
2. Run the indexer: `python scripts/maintenance/update_vector_index.py`

## Process
1. **Define Query**: Formulate a clear, natural language query representing what you are looking for.
2. **Execute Search**:
   ```bash
   python scripts/maintenance/semantic_search.py "your query here" --limit 5
   ```
3. **Analyze Results**: The script will return the top matching file paths and the specific text chunks that matched.
4. **Follow-up**: Use `read_file` on the returned paths to get full context if the chunk isn't enough.

## When to Invoke
- When `grep_search` returns 0 results for a concept you know exists.
- When trying to find patterns across hundreds of `lead/profiles/`.
- When cross-referencing past audits for similar findings.