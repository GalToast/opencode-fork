---
name: pdf
description: "Use when the task involves reading, creating, or editing PDF files: extract text/tables, merge/split PDFs, create PDFs, or OCR scanned PDFs."
---

# PDF Processing (Opencode)

## Quick Start

### Read a PDF
```python
from pypdf import PdfReader

reader = PdfReader("document.pdf")
print(f"Pages: {len(reader.pages)}")
text = reader.pages[0].extract_text()
```

### Merge PDFs
```python
from pypdf import PdfWriter

writer = PdfWriter()
for pdf_file in ["doc1.pdf", "doc2.pdf"]:
    reader = PdfReader(pdf_file)
    for page in reader.pages:
        writer.add_page(page)

writer.write("merged.pdf")
```

### Extract Tables
```python
import pdfplumber

with pdfplumber.open("document.pdf") as pdf:
    for page in pdf.pages:
        tables = page.extract_tables()
```

### Create PDF
```python
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

c = canvas.Canvas("hello.pdf", pagesize=letter)
c.drawString(100, 700, "Hello World!")
c.save()
```

## Common Tasks
- Extract text: pdfplumber
- Merge/split: pypdf
- Create new: reportlab
- OCR scanned: pytesseract + pdf2image
- Watermark: pypdf merge_page

## Important
- Never use Unicode subscript/superscript characters in ReportLab PDFs (they render as black boxes)
- Use `<sub>` and `<super>` XML tags instead
