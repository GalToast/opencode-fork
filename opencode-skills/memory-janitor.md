---
name: memory-janitor
description: "Autonomous memory compactor. Use this skill periodically or when the context window feels bloated. It reads the Rolling Logs and older memory entries, compresses them into dense Canonical Truths, and aggressively prunes transient historical data to keep the agent fast."
---

# Memory Janitor (Context Management)

## Purpose
As sessions grow, memory files accumulate "Rolling Logs" and transient context that slow down reasoning and waste tokens. The Memory Janitor is a specialized background skill designed to compress history into dense, durable facts.

## Process
1. **Target Identification**: Locate `memory.md` in the current repository and the global memory file.
2. **Review Rolling Logs**: Read the last 20+ entries in the Rolling Log. 
3. **Fact Extraction**: 
   - Identify which events in the Rolling Log represent *completed milestones*, *durable architectural decisions*, or *permanent state changes*.
   - Extract these into concise, single-sentence bullet points.
4. **Canonical Integration**:
   - Merge the extracted facts into the "Canonical Truths" section.
   - Cross-reference with existing truths to remove duplicates or obsolete facts.
5. **Aggressive Pruning**:
   - Delete all extracted or obsolete entries from the Rolling Log.
   - Keep only the last 3-5 *active* or *recent* events in the Rolling Log.
   - Remove any temporary "Blockers" or "Current Tasks" that are no longer relevant.
6. **Telemetry Update**: Update the `Last Cleanup` timestamp in the memory file.

## Rules of Compression
- **Density**: "User requested a change to the lead outreach script to include a Good Neighbor protocol and we tested it" -> "Lead outreach script uses Good Neighbor protocol."
- **Timelessness**: Remove dates from facts unless the date itself is the critical fact (e.g., a specific API cutoff).
- **Safety**: Never prune user preference data or alignment rules (usually found in `fred-profile.md` or similar).

## When to Invoke
- Automatically after the completion of an Epic in the task tracker.
- When `memory.md` exceeds 150 lines.
- When explicitly asked to "clean up memory" or "compress context".