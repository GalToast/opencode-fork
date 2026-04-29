---
name: "spreadsheet"
description: "Use when tasks involve creating, editing, analyzing, or formatting spreadsheets (.xlsx, .csv) using Python (openpyxl, pandas)."
---

# Spreadsheet Skill (Opencode)

## When to use
- Build new workbooks with formulas and formatting
- Read or analyze tabular data
- Modify existing workbooks
- Visualize data with charts

## Primary tooling
- openpyxl for .xlsx edits
- pandas for analysis and CSV workflows

## Best practices
- Use formulas for derived values
- Preserve formatting when editing
- Use appropriate number/date formats
- Clean layout: headers distinct, consistent spacing

## Color conventions
- Blue: user input
- Black: formulas
- Green: linked values
- Gray: constants

## Formula requirements
- Keep formulas simple
- Use cell references, not magic numbers
- Guard against #REF!, #DIV/0! errors
