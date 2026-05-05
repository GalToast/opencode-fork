# Compact Mode - Executive Summary

## Problem
User runs terminal side-by-side (~50-60 columns). The 42-column sidebar is invisible/cluttered in this view. They need a "slick and unobtrusive" narrow-view experience that still delivers key info.

## Solution
**Auto-detecting compact mode** that collapses the sidebar and optimizes UI density while preserving the Knight Rider spinner and "cute" aesthetic.

## Key Decisions

### 1. Detection
- **Auto-detect:** Trigger when viewport < 768px OR terminal < 80 columns
- **Manual override:** Command palette toggle + settings preference
- **Default:** Auto mode

### 2. Sidebar (When Hidden)
| Feature | Alternative |
|---------|-------------|
| Project switcher | `Cmd/Ctrl+Shift+P` in command palette |
| Session list | `Alt+↑/↓` keyboard nav |
| Workspaces | Filtered command palette |
| New project | Command palette + optional FAB |

### 3. Layout Changes
- **Header:** Single row, 40px height (vs 56px)
- **Terminal tabs:** Icon + number only, 32px height
- **Spinner:** 2px height, 40px width, top-right inline
- **Input:** Reduced padding, collapsed context chips

### 4. Keyboard Shortcuts (New)
- `Cmd/Ctrl+Shift+M` - Toggle compact mode
- `Cmd/Ctrl+Shift+F` - Toggle file tree
- `Cmd/Ctrl+Shift+R` - Toggle review panel
- `Cmd/Ctrl+Shift+P` - Project switcher

### 5. Always Visible
- Back button
- Project name (truncated)
- Model indicator (icon)
- Input prompt
- Status toasts (ephemeral, 2s)

## Visual Reference

### Compact Header
```
┌─────────────────────────────────────────────────────┐
│ ◀  📁 project-name  🤖 model  ✨ ...  ≡  │
├─────────────────────────────────────────────────────┤
│                    [content]                        │
└─────────────────────────────────────────────────────┘
```

### Compact Terminal
```
┌─────────────────────────────────────────────────────┐
│ ▶ bash 1  ▶ bash 2  ▶ bash 3  │  +  │  ╳ │
├─────────────────────────────────────────────────────┤
│ $ command here                                      │
└─────────────────────────────────────────────────────┘
```

### Compact Input
```
┌─────────────────────────────────────────────────────┐
│ [📎 3]  Type your message...          [➤] │
└─────────────────────────────────────────────────────┘
```

## Implementation Phases

1. **Detection + Header** (1-2 days)
   - useCompactMode() hook
   - Auto-detection logic
   - Compact header component

2. **Sidebar Alternatives** (2-3 days)
   - Command palette project switcher
   - Keyboard nav feedback
   - Session navigation toasts

3. **Terminal + Input** (2 days)
   - Compact terminal tabs
   - Collapsible terminal state
   - Optimized composer

4. **Polish** (1-2 days)
   - Compact spinner animation
   - Settings integration
   - Shortcuts reference

## Files to Modify

### New Files
- `packages/app/src/hooks/use-compact-mode.ts`
- `packages/app/src/components/compact-header.tsx`
- `packages/app/src/components/compact-spinner.tsx`

### Modified Files
- `packages/app/src/context/settings.tsx` - Add compact mode settings
- `packages/app/src/context/layout.tsx` - Compact mode detection
- `packages/app/src/pages/session.tsx` - Compact layout switches
- `packages/app/src/pages/session/terminal-panel.tsx` - Compact tabs
- `packages/app/src/pages/session/composer/session-composer-region.tsx` - Compact input
- `packages/app/src/i18n/en.ts` - New translation keys

## Settings Schema

```typescript
interface Settings {
  appearance: {
    compactMode: 'auto' | 'always' | 'never'
    compactModeThreshold: number  // columns, default: 80
  }
}
```

## Key Constraints Met

✅ **Knight Rider spinner preserved** - Just smaller and faster
✅ **Cute aesthetic maintained** - Friendly, not clinical
✅ **No clutter added** - Everything optional or keyboard-accessible
✅ **Sidebar alternatives** - Command palette + keyboard shortcuts
✅ **Natural navigation** - Alt+arrows, familiar patterns

## Next Steps

1. Review design spec (`specs/compact-mode-design.md`)
2. Confirm approach aligns with user expectations
3. Begin Phase 1 implementation
4. User testing in narrow terminal
