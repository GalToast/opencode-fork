---
name: docx
description: "Create, read, edit Word documents (.docx). Use for reports, letters, templates, or professional documents with formatting."
---

# DOCX Skill (Opencode)

## Quick Reference
- Read content: pandoc
- Create new: docx-js library
- Edit existing: unpack -> edit XML -> repack

## Creating Documents
Use docx-js library with JavaScript:
```javascript
const { Document, Packer, Paragraph, TextRun } = require('docx');
const doc = new Document({ sections: [{ children: [] }] });
Packer.toBuffer(doc).then(buffer => fs.writeFileSync("doc.docx", buffer));
```

## Critical Rules
- Set page size explicitly (docx-js defaults to A4)
- Never use \n - use separate Paragraph elements
- Never use unicode bullets - use LevelFormat.BULLET
- Tables need dual widths: columnWidths AND cell width (DXA)
- Always use WidthType.DXA, never PERCENTAGE

## Editing
1. Unpack: python scripts/office/unpack.py doc.docx unpacked/
2. Edit XML in unpacked/word/
3. Repack: python scripts/office/pack.py unpacked/ output.docx
