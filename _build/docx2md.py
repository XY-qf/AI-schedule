# -*- coding: utf-8 -*-
"""把已生成的 PRD DOCX 转成结构清晰的 Markdown。"""

import sys
from docx import Document
from docx.text.paragraph import Paragraph
from docx.oxml.ns import qn

SRC = r"C:\Users\王一钧\Desktop\AI日程APP制作\AI日程_产品需求文档_v1.0.docx"
DST = r"C:\Users\王一钧\Desktop\AI日程APP制作\AI日程_产品需求文档_v1.0.md"

doc = Document(SRC)
out = []
pending_pre = []


def flush_pre():
    global pending_pre
    if pending_pre:
        while pending_pre and not pending_pre[-1].strip():
            pending_pre.pop()
        out.append("```text")
        out.extend(pending_pre)
        out.append("```")
        out.append("")
        pending_pre = []


def esc(s):
    return s.replace("|", "\\|").strip()


def ensure_blank():
    if out and out[-1].strip():
        out.append("")


def emit_table(tbl):
    rows = []
    for tr in tbl.rows:
        rows.append([esc(c.text.replace("\n", " ")) for c in tr.cells])
    if not rows:
        return
    ncol = len(rows[0])
    for r in rows:
        while len(r) < ncol:
            r.append("")
    ensure_blank()
    out.append("| " + " | ".join(rows[0]) + " |")
    out.append("|" + "|".join([" --- "] * ncol) + "|")
    for r in rows[1:]:
        out.append("| " + " | ".join(r) + " |")
    out.append("")


def classify(p):
    """返回 ('h',1,'text') / ('note',text) / ('caption',text) / ('pre',text) / ('li',text) / ('p',text)"""
    text = p.text
    style = p.style.name or ""
    if style.startswith("Heading"):
        lvl = int(style.split()[-1]) if style.split()[-1].isdigit() else 1
        return ("h", lvl, text.strip())
    if style.startswith("List Bullet"):
        return ("li", "", text.strip())
    if style.startswith("List Number"):
        return ("li", "", text.strip())
    runs = p.runs
    if not runs:
        return ("empty", "", text)
    r0 = runs[0]
    name = (r0.font.name or "")
    size = r0.font.size.pt if r0.font.size is not None else None
    pf = p.paragraph_format
    ind = pf.left_indent.cm if pf.left_indent is not None else 0

    ppr = p._p.pPr
    fill = None
    if ppr is not None and ppr.find(qn("w:shd")) is not None:
        fill = ppr.find(qn("w:shd")).get(qn("w:fill"))

    if name == "SimSun" or (size == 8):
        return ("pre", "", text)
    if fill == "F2F5FA":
        return ("note", "", text.strip())
    if size == 9 and ind == 0 and len(runs) == 1:
        return ("caption", "", text.strip())
    if size == 30:
        return ("title", 1, text.strip())
    if size == 18:
        return ("subtitle", 2, text.strip())
    if size == 11 and ind > 0:
        return ("li", "", text.strip())
    return ("p", "", text.strip())


body = doc.element.body
for child in body.iterchildren():
    tag = child.tag.split("}")[-1]
    if tag == "tbl":
        flush_pre()
        from docx.table import Table
        emit_table(Table(child, doc))
        continue
    if tag != "p":
        continue
    p = Paragraph(child, doc)
    kind = classify(p)
    if kind[0] == "empty":
        continue
    if kind[0] != "pre":
        flush_pre()

    if kind[0] == "h":
        lvl, text = kind[1], kind[2]
        if not text:
            continue
        ensure_blank()
        out.append("#" * min(lvl + 1, 6) + " " + text)
        out.append("")
    elif kind[0] == "title":
        ensure_blank()
        out.append("# " + kind[2])
        out.append("")
    elif kind[0] == "subtitle":
        ensure_blank()
        out.append("## " + kind[2])
        out.append("")
    elif kind[0] == "note":
        if kind[2]:
            out.append("> " + kind[2])
            out.append("")
    elif kind[0] == "caption":
        if kind[2]:
            out.append("*" + kind[2] + "*")
            out.append("")
    elif kind[0] == "li":
        if kind[2]:
            out.append("- " + kind[2])
    elif kind[0] == "pre":
        pending_pre.append(kind[2])
    else:
        if kind[2]:
            out.append(kind[2])
            out.append("")
flush_pre()

text = "\n".join(out)
# 压缩连续空行
lines = text.split("\n")
clean = []
blank = 0
for ln in lines:
    if not ln.strip():
        blank += 1
        if blank > 1:
            continue
    else:
        blank = 0
    clean.append(ln.rstrip())
text = "\n".join(clean).strip() + "\n"

with open(DST, "w", encoding="utf-8", newline="\n") as f:
    f.write(text)

print("MD OK  lines=%d  chars=%d" % (text.count("\n"), len(text)))
