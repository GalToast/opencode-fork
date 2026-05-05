# Compact Mode Design Spec

## Overview
A narrow-view (~50-60 columns) optimized interface for side-by-side terminal workflows. Preserves the "cute" aesthetic and Knight Rider spinner while minimizing visual overhead.

---

## Core Philosophy

**Minimum Viable Info at All Times:**
- Current session/project identity
- Active model/agent
- Input prompt (always visible)
- Critical status indicators (loading, errors)

**Design Principles:**
1. **Progressive Disclosure** - Secondary info accessible via keyboard/commands, not visible by default
2. **Spatial Consistency** - Elements stay in predictable locations even when compact
3. **Delight Without Clutter** - Knight Rider spinner stays, but as a subtle accent
4. **Keyboard-First Navigation** - When sidebar is hidden, keyboard shortcuts become primary

---

## Detection Strategy

### Option A: Auto-Detect (Recommended)
```typescript
// Trigger when viewport < 768px OR when terminal width < 80 columns
const isCompactMode = createMemo(() => {
  const viewport = window.innerWidth
  const terminalCols = terminal?.cols ?? 80
  return viewport < 768 || terminalCols < 80
})
```

### Option B: Manual Toggle
- Add `command.view.compactMode` to command palette
- Persist preference: `settings.appearance.compactMode`
- Override auto-detect when manually set

**Decision:** Implement both - auto-detect with manual override capability.

---

## Layout Transformations

### Header (Session Header)

**Current:** Full height, multiple rows, avatar + title + actions

**Compact Mode:**
```
┌─────────────────────────────────────────────────────┐
│ ◀  📁 project-name  🤖 model  ✨ ...  ≡  │
├─────────────────────────────────────────────────────┤
│                    [content]                        │
└─────────────────────────────────────────────────────┘
```

- Single row, 40px height (vs 56px)
- Back button (◀) always visible
- Project icon + name (truncated)
- Active model badge (icon only, tooltip on hover)
- Spinner (subtle, right side)
- Actions overflow into `≡` menu

**Implementation:**
```typescript
// packages/app/src/components/session/session-header.tsx
const isCompact = useCompactMode()

// Height reduction
class={isCompact() ? "h-10" : "h-14"}

// Single row layout with flex truncation
<div class="flex items-center gap-2 min-w-0">
  <BackButton />
  <ProjectIcon />
  <span class="truncate text-14-medium">{projectName()}</span>
  <div class="flex-1" />
  <ModelBadge compact />
  <Spinner compact />
  <ActionsMenu compact />
</div>
```

### Sidebar Transformation

**When Hidden (Compact Mode):**
- Collapse to 0px width
- Project switcher becomes keyboard-only: `Cmd/Ctrl+Shift+P` → project list
- Session navigation: `Alt+↑/↓` (already exists)

**Quick Access Alternatives:**
| Sidebar Feature | Compact Alternative |
|----------------|---------------------|
| Project list | Command palette (`Cmd/Ctrl+Shift+P`) |
| Session list | Keyboard nav (`Alt+↑/↓`) + toast showing session name |
| Workspace switcher | Command palette filtered to workspaces |
| Settings | Always accessible via `Cmd/Ctrl+,` |
| New project | Command palette + floating action button (optional) |

**Floating Project Indicator (Optional Enhancement):**
When sidebar is hidden, show subtle floating indicator on hover near left edge:
```
┌──
│▐  ← 4px colored bar showing current project color
└──
```

### Terminal Panel

**Compact Mode Optimizations:**
- Reduce tab height: 32px (vs 40px)
- Tab labels: icon + number only (tooltip on hover)
- Collapse terminal: `Esc` or click ╳
- Remember collapsed state per session

```
┌─────────────────────────────────────────────────────┐
│ ▶ bash 1  ▶ bash 2  ▶ bash 3  │  +  │  ╳ │
├─────────────────────────────────────────────────────┤
│ $ command here                                      │
└─────────────────────────────────────────────────────┘
```

### File Tree / Review Panel

**When Hidden:**
- Access via keyboard: `Cmd/Ctrl+Shift+F` (files), `Cmd/Ctrl+Shift+R` (review)
- Show badge count on command palette icon
- Quick file open: `Cmd/Ctrl+P` (already exists)

---

## Knight Rider Spinner

**Compact Mode Adaptation:**
- Reduce height: 2px (vs 4px)
- Narrower: 40px max width (vs full width)
- Position: Top-right of header, inline with model badge
- Animation speed: 20% faster (feels more "snappy")

```css
/* Compact mode spinner */
.compact-spinner {
  height: 2px;
  width: 40px;
  background: linear-gradient(
    90deg,
    transparent 0%,
    var(--color-accent) 20%,
    var(--color-accent-bright) 50%,
    var(--color-accent) 80%,
    transparent 100%
  );
  animation: knight-rider 1.2s ease-in-out infinite; /* faster */
}
```

---

## Input Area (Composer)

**Critical: Always Visible and Accessible**

**Compact Optimizations:**
- Reduce padding: 12px (vs 16px)
- Smaller context chips: 20px height (vs 24px)
- Collapsed context: show count badge, expand on click
- Single-line placeholder when empty

```
┌─────────────────────────────────────────────────────┐
│ [📎 3]  Type your message...          [➤] │
└─────────────────────────────────────────────────────┘
```

---

## Keyboard Shortcuts Reference

**Essential Navigation (Display in compact mode footer/tooltip):**

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+B` | Toggle sidebar |
| `Cmd/Ctrl+Shift+P` | Switch project |
| `Alt+↑/↓` | Previous/next session |
| `Cmd/Ctrl+Shift+↑/↓` | Previous/next unread |
| `Cmd/Ctrl+J` | Toggle terminal |
| `Cmd/Ctrl+Shift+F` | Toggle file tree |
| `Cmd/Ctrl+Shift+R` | Toggle review |
| `Cmd/Ctrl+P` | Quick file open |
| `Cmd/Ctrl+Shift+M` | Toggle compact mode |

---

## Status Indicators

**Compact Mode Status Bar (Optional):**
```
┌─────────────────────────────────────────────────────┐
│ ◀ project │ 🤖 claude │ ⚡ 3 files │ 12:34 PM │
└─────────────────────────────────────────────────────┘
```

Alternative: **Ephemeral Toasts**
- Show contextual info briefly (2s) on navigation
- Example: "Switched to session: Fix auth bug"
- Keeps screen clean but provides feedback

---

## Settings Integration

**New Settings:**
```typescript
interface Settings {
  appearance: {
    compactMode: 'auto' | 'always' | 'never'  // default: 'auto'
    compactModeThreshold: number              // default: 80 (columns)
  }
}
```

**Location:** `Settings > Appearance > Compact Mode`

---

## Implementation Phases

### Phase 1: Detection + Header (1-2 days)
- [ ] Add `useCompactMode()` hook
- [ ] Implement auto-detection logic
- [ ] Compact header component
- [ ] Add manual toggle command

### Phase 2: Sidebar Alternatives (2-3 days)
- [ ] Project switcher in command palette
- [ ] Enhanced keyboard navigation feedback
- [ ] Session navigation toasts

### Phase 3: Terminal + Input (2 days)
- [ ] Compact terminal tabs
- [ ] Collapsible terminal state
- [ ] Optimized composer

### Phase 4: Polish (1-2 days)
- [ ] Compact spinner animation
- [ ] Settings integration
- [ ] Keyboard shortcuts reference

---

## Technical Notes

### Media Query Approach
```typescript
// packages/app/src/hooks/use-compact-mode.ts
import { createMediaQuery } from "@solid-primitives/media"
import { useSettings } from "@/context/settings"

export function useCompactMode() {
  const settings = useSettings()
  const autoCompact = createMediaQuery(`(max-width: ${settings.appearance.compactModeThreshold * 8}px)`)
  
  return createMemo(() => {
    const mode = settings.appearance.compactMode
    if (mode === 'always') return true
    if (mode === 'never') return false
    return autoCompact()
  })
}
```

### CSS Variables
```css
:root {
  /* Compact mode overrides */
  --compact-header-height: 40px;
  --compact-tab-height: 32px;
  --compact-padding: 12px;
  --compact-spinner-height: 2px;
}

[data-compact-mode="true"] {
  --header-height: var(--compact-header-height);
  --tab-height: var(--compact-tab-height);
  --panel-padding: var(--compact-padding);
}
```

---

## Open Questions

1. **Should we show a compact mode indicator?** (e.g., subtle border color change)
2. **Mobile overlap:** Does compact mode apply to mobile, or is mobile already "compact enough"?
3. **Terminal column detection:** Can we reliably detect terminal width across platforms?
4. **Floating project indicator:** Worth the complexity, or rely on keyboard?

---

## Success Metrics

- **Usability:** Can user navigate sessions without sidebar visible?
- **Efficiency:** Keyboard shortcuts feel natural and responsive
- **Aesthetics:** Interface feels "slick and unobtrusive" in narrow view
- **Delight:** Knight Rider spinner still brings joy even at 2px tall
