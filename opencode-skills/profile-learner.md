---
name: profile-learner
description: "HITL (Human-in-the-loop) Optimization skill. Runs after milestones to analyze recent chat history for user preferences, communication styles, and values, then automatically updates the user's profile (fred-profile.md)."
---

# Profile Learner (HITL Optimization)

## Purpose
The Profile Learner bridges the gap between manual profile updates and continuous agent alignment. It acts as an autonomous observer, mining the chat history for explicit instructions ("I prefer it this way") and implicit signals (how the user edits agent copy, tone corrections, workflow preferences) to keep `fred-profile.md` up-to-date.

## Process
1. **Context Window Review**: Scan the recent conversation history (the last major Epic or session).
2. **Signal Extraction**: Look for:
   - **Direct Corrections**: "Don't use that word," "Make it shorter," "I like this format."
   - **Stylistic Edits**: Reviewing diffs where the user manually changed agent-generated copy (e.g., removing em dashes, softening sales language).
   - **Value Statements**: Moments where the user explains *why* they chose a certain approach (e.g., "We do it this way to protect the client").
   - **Workflow Preferences**: How the user likes to review work (e.g., "Give me the final diff before committing").
3. **Profile Cross-Reference**: Read `notes/fred-profile.md`. 
4. **Surgical Update**:
   - If the signal reinforces an existing point, refine the wording to be more precise.
   - If the signal is new, add it to the appropriate section (e.g., "Confirmed preferences", "Working notes", "Values and ethics").
   - Move items from "Working notes (needs confirmation)" to "Confirmed preferences" if the recent history provides solid evidence.
5. **Update Timestamp**: Change the `Last updated` date at the top of the profile.

## Rules of Engagement
- **No Hallucinations**: Only add traits or preferences that are explicitly grounded in the chat history.
- **Categorization**: Use the existing structural buckets in the profile.
- **Tone Matching**: Write the profile updates in a clear, objective tone. Do not use conversational filler.
- **Confirmation**: If a signal is profound but ambiguous (e.g., a major shift in business strategy), add it under "Open threads" or "Working notes" and explicitly ask the user for confirmation in your next message.

## When to Invoke
- Automatically at the completion of a major Epic or project phase.
- When the user says "Remember how I like this" or "Update my profile."
- When you notice you've made the same stylistic mistake twice and the user corrected it both times.