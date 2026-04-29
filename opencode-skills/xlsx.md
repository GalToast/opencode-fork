---
name: xlsx
description: "Create, read, edit Excel spreadsheets (.xlsx, .xlsm, .csv). Use for financial models, data analysis, or tabular data."
---

# XLSX Skill (Opencode)

## Tools
- pandas: data analysis
- openpyxl: formulas and formatting

## Requirements
- Zero formula errors (#REF!, #DIV/0!, etc.)
- Use formulas, not hardcoded Python calculations
- Recalculate with scripts/recalc.py after creating

## Color Standards
- Blue: user inputs
- Black: formulas
- Green: links to other sheets
- Red: external links

## Formatting
- Currency: $#,##0 with units in headers
- Zeros: display as "-"
- Negative: parentheses (123)
- Years: text strings
