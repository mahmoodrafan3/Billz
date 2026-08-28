#!/usr/bin/env python3
"""
Bill splitter: Detect and separate pharmacy bill sections from a PDF.
Removes repeated header and footer from each bill.

Usage:
    python split_bills.py <input_pdf> <output_dir>

Output: JSON to stdout with bill information.
Each bill is saved as a separate PDF and preview PNG in output_dir.
"""

import sys
import os
import json
import re
import warnings
warnings.filterwarnings("ignore")
import pymupdf as fitz


# ── Patterns to detect header/footer blocks ──

HEADER_TEXTS = [
    "ALIF HEALTH CARE",
    "KMC 18",
    "PENDING BILLS",
    "KASARAGOD",
    "NEW BUS STAND",
    "SQUARE NINE",
    "SMART BAZAR",
    "671 121",
    "AmountNarration",  # column header with no spaces
    "Amount",
]

FOOTER_TEXTS = [
    "User :",
    "Page #",
]


def block_contains_any(block, keywords):
    """Check if any text in a block matches any keyword."""
    if block["type"] != 0:
        return False
    all_text = ""
    for line in block["lines"]:
        for span in line["spans"]:
            all_text += span["text"]
    for kw in keywords:
        if kw in all_text:
            return True
    return False


def get_block_text(block):
    """Get all text from a block."""
    all_text = ""
    for line in block["lines"]:
        for span in line["spans"]:
            all_text += span["text"]
    return all_text.strip()


def get_content_start_y(page) -> float:
    """Find y-coordinate where actual bill content starts (after header)."""
    blocks = page.get_text("dict")["blocks"]
    last_header_bottom = 0
    for block in blocks:
        if block_contains_any(block, HEADER_TEXTS):
            last_header_bottom = max(last_header_bottom, block["bbox"][3])
    return last_header_bottom + 5 if last_header_bottom > 0 else 0


def get_content_end_y(page) -> float:
    """Find y-coordinate where actual bill content ends (before footer)."""
    blocks = page.get_text("dict")["blocks"]
    first_footer_top = page.rect.height
    for block in blocks:
        if block_contains_any(block, FOOTER_TEXTS):
            first_footer_top = min(first_footer_top, block["bbox"][1])
    return first_footer_top - 5 if first_footer_top < page.rect.height else page.rect.height


# ── Bill detection ──

def is_pharmacy_header(first_line_text: str) -> bool:
    """Check if a block's first line is a pharmacy name header."""
    text = first_line_text.strip()
    if not text:
        return False
    if "[" in text and "]" in text:
        skip_patterns = [
            "ALIF HEALTH CARE", "KMC 18", "PENDING BILLS",
            "KASARAGOD", "NEW BUS STAND", "TOTAL AMOUNT",
            "Amount", "Narration", "User :", "Page #",
        ]
        for pat in skip_patterns:
            if text.startswith(pat):
                return False
        return True
    return False


def detect_bill_sections(doc):
    """Identify bill sections by finding pharmacy headers and TOTAL AMOUNT markers."""
    sections = []
    current_header = None

    for page_num in range(len(doc)):
        page = doc[page_num]
        text_dict = page.get_text("dict")
        blocks_sorted = sorted(text_dict["blocks"], key=lambda b: b["bbox"][1])

        for block in blocks_sorted:
            if block["type"] != 0:
                continue

            # Skip header/footer blocks entirely
            if block_contains_any(block, HEADER_TEXTS + FOOTER_TEXTS):
                continue

            line_texts = []
            for line in block["lines"]:
                line_text = ""
                for span in line["spans"]:
                    line_text += span["text"]
                line_texts.append(line_text.strip())

            block_top = block["bbox"][1]
            block_bottom = block["bbox"][3]
            first_line = line_texts[0] if line_texts else ""
            has_total = any(t == "TOTAL AMOUNT" for t in line_texts)

            if has_total and current_header is not None:
                h_page, h_y, h_name = current_header
                sections.append({
                    "start_page": h_page,
                    "start_y": h_y,
                    "end_page": page_num,
                    "end_y": block_bottom + 5,
                    "pharmacy_name": h_name,
                })
                current_header = None

            if is_pharmacy_header(first_line):
                current_header = (page_num, max(0, block_top - 5), first_line)

    if current_header is not None:
        h_page, h_y, h_name = current_header
        last_page = doc[len(doc) - 1]
        sections.append({
            "start_page": h_page,
            "start_y": h_y,
            "end_page": len(doc) - 1,
            "end_y": last_page.rect.height,
            "pharmacy_name": h_name,
        })

    return sections


# ── PDF creation ──

def create_individual_pdfs(doc, sections, output_dir):
    """Create individual PDF files and preview PNGs for each bill section."""
    bills = []

    for i, section in enumerate(sections):
        pharmacy_name = section.get("pharmacy_name", f"Bill {i + 1}")
        clean_name = pharmacy_name.strip()

        safe_name = re.sub(r'[^\w\s\-]', '', clean_name)
        safe_name = re.sub(r'\s+', '_', safe_name)[:60]
        filename = f"{i + 1:03d}_{safe_name}.pdf"
        preview_filename = f"{i + 1:03d}_{safe_name}.png"
        output_path = os.path.join(output_dir, filename)
        preview_path = os.path.join(output_dir, preview_filename)

        # Calculate content boundaries (skip header and footer)
        content_start_y = get_content_start_y(doc[section["start_page"]])
        actual_start_y = max(section["start_y"], content_start_y)

        if section["start_page"] == section["end_page"]:
            page = doc[section["start_page"]]
            page_rect = page.rect
            content_end_y = get_content_end_y(page)
            actual_end_y = min(section["end_y"], content_end_y)

            clip = fitz.Rect(0, actual_start_y, page_rect.width, actual_end_y)
            if clip.height <= 0:
                continue

            new_doc = fitz.open()
            new_page = new_doc.new_page(width=page_rect.width, height=clip.height)
            new_page.show_pdf_page(
                fitz.Rect(0, 0, clip.width, clip.height),
                doc, section["start_page"], clip=clip,
            )
            new_doc.save(output_path)

            preview_page = new_doc[0]
            mat = fitz.Matrix(2.0, 2.0)
            pix = preview_page.get_pixmap(matrix=mat)
            pix.save(preview_path)
            new_doc.close()
        else:
            page_width = doc[section["start_page"]].rect.width
            total_height = 0
            page_clips = []

            for p in range(section["start_page"], section["end_page"] + 1):
                page = doc[p]
                page_rect = page.rect

                clip_top = actual_start_y if p == section["start_page"] else get_content_start_y(page)
                clip_bottom = min(section["end_y"], get_content_end_y(page)) if p == section["end_page"] else get_content_end_y(page)

                if clip_bottom <= clip_top:
                    continue

                clip = fitz.Rect(0, clip_top, page_rect.width, clip_bottom)
                page_clips.append((p, clip))
                total_height += clip.height

            if not page_clips or total_height <= 0:
                continue

            new_doc = fitz.open()
            new_page = new_doc.new_page(width=page_width, height=total_height)

            y_offset = 0
            for page_num, clip in page_clips:
                new_page.show_pdf_page(
                    fitz.Rect(0, y_offset, clip.width, y_offset + clip.height),
                    doc, page_num, clip=clip,
                )
                y_offset += clip.height

            new_doc.save(output_path)

            preview_page = new_doc[0]
            mat = fitz.Matrix(2.0, 2.0)
            pix = preview_page.get_pixmap(matrix=mat)
            pix.save(preview_path)
            new_doc.close()

        bills.append({
            "index": i + 1,
            "name": clean_name,
            "filename": filename,
            "previewFilename": preview_filename,
            "pages": 1 if section["start_page"] == section["end_page"] else (
                section["end_page"] - section["start_page"] + 1
            ),
        })

    return bills


def main():
    if len(sys.argv) != 3:
        print(json.dumps({"error": "Usage: split_bills.py <input_pdf> <output_dir>"}))
        sys.exit(1)

    input_pdf = sys.argv[1]
    output_dir = sys.argv[2]

    if not os.path.exists(input_pdf):
        print(json.dumps({"error": f"Input file not found: {input_pdf}"}))
        sys.exit(1)

    os.makedirs(output_dir, exist_ok=True)

    doc = fitz.open(input_pdf)
    total_pages = len(doc)

    sections = detect_bill_sections(doc)

    if not sections:
        doc.close()
        print(json.dumps({
            "error": "No bill sections detected in the PDF",
            "totalPages": total_pages,
        }))
        sys.exit(1)

    bills = create_individual_pdfs(doc, sections, output_dir)
    doc.close()

    result = {
        "totalPages": total_pages,
        "totalBills": len(bills),
        "bills": bills,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
