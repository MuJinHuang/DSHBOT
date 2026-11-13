"""把发布包里的 Markdown 文档转成排版好的 DOCX。

用法：
  python scripts/make-release-docx.py

输入：DSHBOT(V1.0)/DSHBOT-介绍文档.md、DSHBOT-说明文档.md
输出：同目录同名 .docx
"""
from __future__ import annotations

import re
from pathlib import Path

from docx import Document
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Inches, Pt, RGBColor
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "DSHBOT(V1.0)"
DOCS = ["DSHBOT-介绍文档", "DSHBOT-说明文档"]
ASSETS = TARGET / "assets"
BUILD = TARGET / ".build"


def set_cell_shading(cell, fill: str) -> None:
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), fill)
    tc_pr.append(shd)


def set_paragraph_bottom_border(paragraph) -> None:
    p_pr = paragraph._p.get_or_add_pPr()
    p_bdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "BFC7D5")
    p_bdr.append(bottom)
    p_pr.append(p_bdr)


def add_page_number(paragraph) -> None:
    run = paragraph.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = " PAGE "
    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_begin)
    run._r.append(instr)
    run._r.append(fld_end)


def style_document(doc: Document) -> None:
    section = doc.sections[0]
    section.page_width = Cm(21)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2.2)
    section.bottom_margin = Cm(2.0)
    section.left_margin = Cm(2.2)
    section.right_margin = Cm(2.2)

    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
    normal.paragraph_format.space_after = Pt(5)
    normal.paragraph_format.line_spacing = 1.25

    for name, size, color in [
        ("Heading 1", 20, "1F3A5F"),
        ("Heading 2", 15, "2F6FED"),
        ("Heading 3", 12, "2F6FED"),
    ]:
        style = doc.styles[name]
        style.font.name = "Calibri"
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor.from_string(color)
        style.element.rPr.rFonts.set(qn("w:eastAsia"), "Microsoft YaHei")
        style.paragraph_format.space_before = Pt(14 if name == "Heading 2" else 10)
        style.paragraph_format.space_after = Pt(5)

    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    footer.add_run("DSHBot V1.0  ·  MIT  ·  ").font.size = Pt(8.5)
    add_page_number(footer)


def inline_runs(paragraph, text: str) -> None:
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    for part in re.split(r"(\*\*.+?\*\*|`.+?`)", text):
        if part == "":
            continue
        if part.startswith("**") and part.endswith("**"):
            run = paragraph.add_run(part[2:-2])
            run.bold = True
        elif part.startswith("`") and part.endswith("`"):
            run = paragraph.add_run(part[1:-1])
            run.font.name = "Consolas"
            run.font.size = Pt(9.5)
        else:
            paragraph.add_run(part)


def add_picture(doc: Document, path: Path, alt: str) -> None:
    if path.name == "demo.gif":
        # DOCX/PDF 不能动；用四步静态拼图替代 GIF 首帧
        path = ASSETS / "demo-steps.png"
        alt = alt + "（四步拼图）"
    if not path.exists():
        return
    actual = path
    if path.suffix.lower() == ".gif":
        BUILD.mkdir(exist_ok=True)
        actual = BUILD / (path.stem + ".png")
        Image.open(path).convert("RGB").save(actual)
    doc.add_picture(str(actual), width=Inches(6.1))
    doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    caption = doc.add_paragraph()
    caption.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = caption.add_run(alt)
    run.italic = True
    run.font.size = Pt(8.5)
    run.font.color.rgb = RGBColor(0x6B, 0x72, 0x80)
    caption.paragraph_format.space_after = Pt(10)


def add_table(doc: Document, rows: list[list[str]]) -> None:
    cols = max(len(row) for row in rows)
    table = doc.add_table(rows=len(rows), cols=cols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True
    for row_index, row in enumerate(rows):
        for col_index in range(cols):
            cell = table.cell(row_index, col_index)
            cell.text = ""
            paragraph = cell.paragraphs[0]
            inline_runs(paragraph, row[col_index] if col_index < len(row) else "")
            for run in paragraph.runs:
                run.font.size = Pt(9.5)
            if row_index == 0:
                set_cell_shading(cell, "E8EEF9")
                for run in paragraph.runs:
                    run.bold = True
    doc.add_paragraph().paragraph_format.space_after = Pt(0)


def parse_table(lines: list[str], start: int) -> tuple[list[list[str]], int] | None:
    if start + 1 >= len(lines):
        return None
    header = lines[start].strip()
    separator = lines[start + 1].strip()
    if not (header.startswith("|") and re.match(r"^\|?[\s:|-]+\|?$", separator)):
        return None
    rows = [[cell.strip() for cell in header.strip().strip("|").split("|")]]
    index = start + 2
    while index < len(lines) and lines[index].strip().startswith("|"):
        raw = lines[index].strip().strip("|")
        rows.append([cell.strip() for cell in raw.split("|")])
        index += 1
    return rows, index


def convert(markdown: Path, docx_path: Path, title: str) -> None:
    text = markdown.read_text(encoding="utf-8")
    lines = text.splitlines()

    doc = Document()
    style_document(doc)
    doc.core_properties.title = title
    doc.core_properties.author = "DSHBot contributors"
    doc.core_properties.subject = "DSHBot V1.0"
    doc.core_properties.comments = "MIT · DSHBot V1.0"

    # 封面
    heading = doc.add_paragraph()
    heading.alignment = WD_ALIGN_PARAGRAPH.CENTER
    heading.paragraph_format.space_before = Pt(54)
    run = heading.add_run("DSHBot V1.0")
    run.bold = True
    run.font.size = Pt(30)
    run.font.color.rgb = RGBColor.from_string("1F3A5F")
    sub = doc.add_paragraph()
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub.add_run("房间式多 Bot 协作 · DSH 插件").font.size = Pt(13)
    sub.paragraph_format.space_after = Pt(18)
    cover_image = ASSETS / "rooms.png"
    if cover_image.exists():
        doc.add_picture(str(cover_image), width=Inches(6.0))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER
    meta = doc.add_paragraph()
    meta.alignment = WD_ALIGN_PARAGRAPH.CENTER
    meta.add_run("版本 1.0.0  ·  2026-11-14  ·  MIT").font.size = Pt(9.5)
    meta.paragraph_format.space_before = Pt(16)
    doc.add_page_break()

    in_code = False
    code_lines: list[str] = []
    index = 0

    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_code:
                paragraph = doc.add_paragraph()
                paragraph.paragraph_format.left_indent = Cm(0.4)
                paragraph.paragraph_format.space_after = Pt(6)
                run = paragraph.add_run("\n".join(code_lines))
                run.font.name = "Consolas"
                run.font.size = Pt(8.5)
                run.font.color.rgb = RGBColor(0x33, 0x3A, 0x48)
                set_paragraph_bottom_border(paragraph)
                code_lines = []
                in_code = False
            else:
                in_code = True
            index += 1
            continue

        if in_code:
            code_lines.append(line)
            index += 1
            continue

        if stripped == "":
            index += 1
            continue

        if stripped == "---":
            paragraph = doc.add_paragraph()
            set_paragraph_bottom_border(paragraph)
            paragraph.paragraph_format.space_after = Pt(10)
            index += 1
            continue

        image = re.match(r"!\[([^\]]*)\]\(([^)]+)\)", stripped)
        if image:
            add_picture(doc, TARGET / image.group(2), image.group(1))
            index += 1
            continue

        table = parse_table(lines, index)
        if table is not None:
            rows, index = table
            add_table(doc, rows)
            continue

        heading_match = re.match(r"^(#{1,3})\s+(.+)$", stripped)
        if heading_match:
            level = len(heading_match.group(1))
            text_value = heading_match.group(2).strip()
            if level == 1:
                # 第一处 h1 已用于封面，避免重复
                if index == 0:
                    index += 1
                    continue
                doc.add_page_break()
                paragraph = doc.add_paragraph(style="Heading 1")
                paragraph.add_run(text_value)
            else:
                paragraph = doc.add_paragraph(style=f"Heading {level}")
                inline_runs(paragraph, text_value)
            index += 1
            continue

        if stripped.startswith(">"):
            paragraph = doc.add_paragraph()
            paragraph.paragraph_format.left_indent = Cm(0.5)
            paragraph.paragraph_format.right_indent = Cm(0.5)
            inline_runs(paragraph, stripped.lstrip("> ").strip())
            for run in paragraph.runs:
                run.italic = True
                run.font.color.rgb = RGBColor(0x5B, 0x63, 0x72)
            index += 1
            continue

        bullet = re.match(r"^[-*]\s+(.+)$", stripped)
        if bullet:
            paragraph = doc.add_paragraph(style="List Bullet")
            inline_runs(paragraph, bullet.group(1))
            index += 1
            continue

        numbered = re.match(r"^(\d+)\.\s+(.+)$", stripped)
        if numbered:
            paragraph = doc.add_paragraph()
            paragraph.paragraph_format.left_indent = Cm(0.7)
            paragraph.paragraph_format.first_line_indent = Cm(-0.45)
            paragraph.paragraph_format.space_after = Pt(3)
            inline_runs(paragraph, f"{numbered.group(1)}. {numbered.group(2)}")
            index += 1
            continue

        paragraph = doc.add_paragraph()
        inline_runs(paragraph, stripped)
        index += 1

    if in_code and code_lines:
        paragraph = doc.add_paragraph()
        run = paragraph.add_run("\n".join(code_lines))
        run.font.name = "Consolas"
        run.font.size = Pt(8.5)
    doc.save(docx_path)


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    for name in DOCS:
        source = TARGET / f"{name}.md"
        if not source.exists():
            raise SystemExit(f"缺少 {source}")
        output = TARGET / f"{name}.docx"
        convert(source, output, name)
        print(f"wrote {output}")
    for temp in BUILD.glob("*.png"):
        temp.unlink()


if __name__ == "__main__":
    main()
