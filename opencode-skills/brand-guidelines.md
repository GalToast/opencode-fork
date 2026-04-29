---
name: brand-guidelines
description: "Apply project-specific brand colors, typography, spacing, and visual conventions to documents, slides, web pages, and UI deliverables. Use when users ask to match a brand, create consistent styling, or polish visual identity."
---

# Brand Guidelines (Opencode)

## Overview
Use this skill to apply consistent brand styling across outputs.
If the user provides a brand system, follow it exactly. If not, create a lightweight system and confirm before broad application.

## When To Use
- User asks to "make this on brand"
- User requests style consistency across assets
- User provides brand colors/fonts/logo rules
- User asks for design polish that should align to existing identity

## Workflow
1. Gather brand inputs:
   - Colors (primary, secondary, neutral)
   - Typography (headline/body fonts and fallback stack)
   - Tone (formal, playful, premium, technical)
   - Allowed or banned motifs/effects
2. Build a compact token set:
   - color tokens, text hierarchy, spacing rhythm, border radius, shadow behavior
3. Apply tokens consistently:
   - docs, slide decks, UI components, and HTML/CSS outputs
4. QA:
   - readability, contrast, consistency, and alignment with user intent

## Defaults (When No Brand Spec Exists)
Use a neutral, professional fallback:
- Typeface pair: one expressive heading face + one readable body face
- Color model: dominant neutral base + one primary accent + one supporting accent
- Structure: consistent spacing scale and heading hierarchy

## Guardrails
- Never invent logos or trademarked visuals.
- Do not over-style body copy; prioritize readability first.
- Keep accent colors structural (highlights, dividers, CTAs), not dominant body text color.
- Preserve accessibility and contrast standards.
