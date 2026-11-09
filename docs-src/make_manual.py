# -*- coding: utf-8 -*-
"""生成《DSHBot 知识手册》Word 文档。"""
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

FONT_CN = "微软雅黑"
FONT_MONO = "Consolas"
ACCENT = RGBColor(0x1F, 0x4E, 0x79)
MUTED = RGBColor(0x59, 0x59, 0x59)


def set_cn_font(target, name=FONT_CN):
    target.font.name = name
    rpr = target.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), name)


def shade(paragraph, fill="F4F6F8"):
    ppr = paragraph._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), fill)
    ppr.append(shd)


import re

TOKEN = re.compile(r"(\*\*.+?\*\*|`[^`]+`)")


def add_rich(p, text, size=10):
    """把 **加粗** 与 `代码` 解析成真实格式，其余原样。"""
    for part in TOKEN.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            r = p.add_run(part[2:-2])
            r.bold = True
            r.font.size = Pt(size)
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            r = p.add_run(part[1:-1])
            r.font.name = FONT_MONO
            r.font.size = Pt(size - 0.5)
        else:
            r = p.add_run(part)
            r.font.size = Pt(size)


def body(doc, text, size=10, color=None, space_after=5):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.42
    add_rich(p, text, size)
    if color is not None:
        for r in p.runs:
            r.font.color.rgb = color
    return p


def bullets(doc, items, size=10):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.line_spacing = 1.38
        add_rich(p, item, size)


def numbered(doc, items, size=10):
    for item in items:
        p = doc.add_paragraph(style="List Number")
        p.paragraph_format.space_after = Pt(1)
        p.paragraph_format.line_spacing = 1.38
        add_rich(p, item, size)


def code(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(3)
    p.paragraph_format.space_after = Pt(7)
    p.paragraph_format.left_indent = Cm(0.35)
    p.paragraph_format.line_spacing = 1.15
    shade(p)
    r = p.add_run(text)
    r.font.name = FONT_MONO
    r.font.size = Pt(8.5)


def h1(doc, text, new_page=True):
    p = doc.add_heading(text, level=1)
    for r in p.runs:
        set_cn_font(r)
        r.font.color.rgb = ACCENT
        r.font.size = Pt(17)
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.keep_with_next = True
    if new_page:
        p.paragraph_format.page_break_before = True
    return p


def h2(doc, text):
    p = doc.add_heading(text, level=2)
    for r in p.runs:
        set_cn_font(r)
        r.font.color.rgb = ACCENT
        r.font.size = Pt(12.5)
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(5)
    p.paragraph_format.keep_with_next = True
    return p


def h3(doc, text):
    p = doc.add_heading(text, level=3)
    for r in p.runs:
        set_cn_font(r)
        r.font.size = Pt(10.8)
    p.paragraph_format.space_before = Pt(8)
    p.paragraph_format.space_after = Pt(3)
    p.paragraph_format.keep_with_next = True
    return p


def _no_split(row):
    trpr = row._tr.get_or_add_trPr()
    trpr.append(OxmlElement("w:cantSplit"))


def _repeat_header(row):
    trpr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    trpr.append(el)


def spacer(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(2)
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.line_spacing = 1
    ppr = p._p.get_or_add_pPr()
    rpr = OxmlElement("w:rPr")
    sz = OxmlElement("w:sz")
    sz.set(qn("w:val"), "2")
    rpr.append(sz)
    ppr.append(rpr)


def table(doc, headers, rows, widths=None, font_size=8.5):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    t._tbl.tblPr.append(layout)
    if widths:
        for i, w in enumerate(widths):
            t.columns[i].width = Cm(w)

    hdr = t.rows[0].cells
    for i, text in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        r = p.add_run(text)
        r.bold = True
        r.font.size = Pt(font_size)
        shade(p, "DCE6F1")
    _repeat_header(t.rows[0])
    _no_split(t.rows[0])

    for row in rows:
        cells = t.add_row().cells
        for i, text in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            r = p.add_run(str(text))
            r.font.size = Pt(font_size)
            p.paragraph_format.space_after = Pt(1)
        _no_split(t.rows[-1])

    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    spacer(doc)


def note(doc, title, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.3)
    p.paragraph_format.space_before = Pt(5)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.line_spacing = 1.35
    shade(p, "FFF6E5")
    r = p.add_run(title + "  ")
    r.bold = True
    r.font.size = Pt(9.5)
    add_rich(p, text, 9.5)


# ============================ 文档 ============================
doc = Document()
sec = doc.sections[0]
sec.page_width, sec.page_height = Cm(21), Cm(29.7)
sec.top_margin = Cm(2.2)
sec.bottom_margin = Cm(2.0)
sec.left_margin = Cm(2.3)
sec.right_margin = Cm(2.1)

normal = doc.styles["Normal"]
set_cn_font(normal)
normal.font.size = Pt(10)
for name in ("Heading 1", "Heading 2", "Heading 3"):
    set_cn_font(doc.styles[name])

# ---------------- 封面 ----------------
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(100)
r = p.add_run("DSHBot 知识手册")
r.font.size = Pt(34)
r.bold = True
r.font.color.rgb = ACCENT

p = doc.add_paragraph()
r = p.add_run("概念 · 数据 · 原理 · 代码 · 接口 · 操作")
r.font.size = Pt(14)
r.font.color.rgb = MUTED

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(36)
p.paragraph_format.left_indent = Cm(0.4)
shade(p, "F4F6F8")
r = p.add_run(
    "这本手册回答三个问题：\n"
    "① 它是什么、能做什么、不能做什么；\n"
    "② 它内部怎么运转、代码在哪、改一处会牵动哪里；\n"
    "③ 它依赖的 DSH 官方接口在哪读、怎么找、怎么验证。"
)
r.font.size = Pt(10.5)
r.font.color.rgb = MUTED

doc.add_paragraph().paragraph_format.space_before = Pt(60)
table(
    doc,
    ["项", "内容"],
    [
        ["文档版本", "v1.0（对应 DSHBot v0.1.0）"],
        ["编写日期", "2026-11-10"],
        ["适用宿主", "DeepSeek Harness 0.2.1-rc.5"],
        ["读者", "使用者 / 维护者 / 决策者"],
        ["配套文档", "需求规格 v1.1、M1 技术方案、实验案例、不足与改进"],
    ],
    widths=[3.6, 12.4],
    font_size=9.5,
)

# ---------------- 第 0 部分 ----------------
h1(doc, "第 0 部分　导读")

h2(doc, "0.1 三条阅读路径")
table(
    doc,
    ["你的目的", "读哪几章", "预计耗时"],
    [
        ["只想把它用起来", "第 7 章 → 附录 10.2", "20 分钟"],
        ["要改代码 / 加功能", "第 2、3、4、8 章", "2 小时"],
        ["要理解它为什么这么设计", "第 1、3、6 章", "3 小时"],
        ["要评估它靠不靠谱", "第 1 章 1.2、第 9 章", "30 分钟"],
    ],
    widths=[5.4, 6.6, 3.0],
)

h2(doc, "0.2 一页纸速览")
body(
    doc,
    "DSHBot 是 DSH（DeepSeek Harness）的一个插件。装上之后，DSH 左侧多一个「房间」入口；"
    "你在房间里写目标与验收标准，拉几个 Bot 进来，说一句话，它们按角色分头干活，"
    "最后你点「交付验收」，拿到逐条判定与变更文件清单。",
)
table(
    doc,
    ["关键词", "一句话"],
    [
        ["房间 Room", "一次任务的容器，也是消息流与成员表的宿主"],
        ["成员 Member", "一只 Bot 在房间里的身份，含独立会话与花费"],
        ["任务卡 Assignment", "总管派给某只 Bot 的一件活，带状态与结论摘要"],
        ["会话 Session", "DSH 的对话单元，一只 Bot 一个，互不污染"],
        ["上下文块", "每次调用前现拼的「房间近况 + 你的任务」"],
        ["事件流", "DSH 推给插件的日志快照，含工具调用与用量"],
        ["交付 Delivery", "逐条验收判定 + 变更文件 + 花费"],
    ],
    widths=[4.2, 11.4],
)

note(
    doc,
    "这本手册的取舍",
    "只写结论性知识。需求怎么演变看《需求规格 v1.1》，每天做了什么看《TASKS.md》，"
    "哪里不足看《不足与改进.md》——手册里不再重复。",
)

# ---------------- 第 1 部分 ----------------
h1(doc, "第 1 部分　项目全景")

h2(doc, "1.1 它解决什么问题")
body(
    doc,
    "DSH 本身擅长「一个 agent 把一件事做好」。但真实任务是分工的："
    "要有人查现状、有人写东西、有人核对，还要有人在中间拍板。"
    "没有 DSHBot 时，你只能开几个会话、手动复制上下文、手动合并结果——"
    "既不知道谁在干什么，也不知道一共花了多少。",
)
body(
    doc,
    "DSHBot 把「多 Bot 协作」收进一个房间：一句话发布，总管拆活，执行者各干各的，"
    "你看得见每一步，最后有一份能拿去交差的验收结论。",
)

h2(doc, "1.2 能力边界")
table(
    doc,
    ["能", "不能 / 半成品"],
    [
        ["建房间、写目标与验收标准", "建完不能改目标（只能重建）"],
        ["拉任意多个 Bot，各有独立会话与花费", "拉人时不能指定角色（要调接口）"],
        ["@ 名字指定谁接话，多 Bot 时不 @ 没人抢话", "不能私聊某只 Bot"],
        ["总管按 @ 派活，生成任务卡（进行中→完成/失败）", "派几路由模型决定，不可预设"],
        ["工具动作用折叠行展示，点开看参数与输出", "没有实时推送，要等整轮结束"],
        ["逐条验收判定（pass/fail/存疑）+ 变更文件", "判定是模型做的，不是真实断言"],
        ["暂停 / 归档 / 仅@响应 / @所有人 停", "不能删除房间，只能归档"],
        ["接管：暂停后人工改，交还写摘要喂回房间", "审批卡没有，仍靠 DSH 自带审批"],
        ["软写锁：文件冲突会提醒", "不能真的拦住写入"],
    ],
    widths=[8.0, 7.6],
)

h2(doc, "1.3 与 Grok Bot 的差异")
table(
    doc,
    ["维度", "Grok Bot", "DSHBot"],
    [
        ["运行位置", "云端实例", "本机 DSH 进程内"],
        ["数据", "上云", "全在本地 ~/.dsh"],
        ["Bot 能力", "官方固定", "可改提示词、可挂 MCP、可换模型"],
        ["形态", "独立 App", "DSH 的一个页面"],
        ["成熟度", "商业产品", "研究原型（v0.1.0）"],
    ],
    widths=[3.6, 5.6, 6.4],
)

h2(doc, "1.4 三次形态演进")
table(
    doc,
    ["阶段", "核心单元", "交互", "为什么改"],
    [
        ["v0.1 工单系统", "任务", "发布 → 看板 → 验收", "起点：把多 agent 当流水线"],
        ["v1.1 房间", "房间", "群聊 + 旁观看板", "发现人真正要看的是「谁在干什么」，不是进度条"],
        ["实现（现状）", "房间 + 成员", "群聊 + 状态灯 + 任务卡 + 交付", "多 Bot 必须各有会话，否则互相污染"],
    ],
    widths=[3.4, 3.0, 4.8, 5.4],
)

h2(doc, "1.5 架构总览")
code(
    doc,
    "浏览器（DSH Web GUI）\n"
    "   │  fetch('dshbot/api/rooms/…')   ← 文档相对路径，Electron 下走 dsh://app/\n"
    "   ▼\n"
    "DSH web 服务器  ──register({kind:'prefix', path:'/dshbot/api'})──▶  插件路由\n"
    "   │\n"
    "   ▼\n"
    "编排层 turn.ts：路由 → 拼上下文 → 派活 → 并发 → 落库\n"
    "   │\n"
    "   ▼\n"
    "宿主 Agent 服务：sessionController.agents.createSession / resolveAgent\n"
    "   │\n"
    "   ▼\n"
    "DeepSeek 模型（复用桌面端登录态）\n"
    "\n"
    "持久化：~/.dsh/dshbot/rooms.json（房间 + 消息，单文件）",
)

# ---------------- 第 2 部分 ----------------
h1(doc, "第 2 部分　概念模型")

h2(doc, "2.1 七个核心概念")
table(
    doc,
    ["概念", "一句话定义", "关键字段"],
    [
        ["Room 房间", "一次任务的容器，也是消息流与成员表的宿主", "goal / acceptance / status / tokensUsed / delivery"],
        ["Member 成员", "一只 Bot 在本房间的身份", "botId / name / role / sessionId / sessionSeq / status / files"],
        ["Message 消息", "房间里的一条记录，七种类型", "kind / from / botId / text / payload"],
        ["Assignment 任务卡", "总管派给某只 Bot 的一件活", "payload.from / to / status / result / files"],
        ["Delivery 交付", "一次验收的结论", "checks / changedFiles / tokensUsed / summary"],
        ["Run", "一次 Bot 执行（不落盘，隐含在消息里）", "—"],
        ["Handoff", "执行者结论的摘要，挂在任务卡上", "payload.result"],
    ],
    widths=[3.2, 7.0, 5.4],
)

h2(doc, "2.2 状态机")
table(
    doc,
    ["对象", "状态", "流转"],
    [
        ["房间", "created / working / paused / archived", "created ⇄ working；paused / archived 可互相恢复"],
        ["成员", "idle / queued / thinking / waiting_human / error", "queued → thinking → idle；失败置 error"],
        ["任务卡", "running / done / failed", "一开一关两条消息"],
        ["交付", "无状态", "每次验收覆盖上一次"],
    ],
    widths=[3.0, 6.4, 6.2],
)

h2(doc, "2.3 数据模型（Room）")
table(
    doc,
    ["字段", "类型", "含义", "谁写"],
    [
        ["id", "string", "room_ + 12 位十六进制", "建房"],
        ["name / goal", "string", "名称与目标", "建房"],
        ["acceptance", "string[]", "验收标准，至少一条", "建房"],
        ["status", "RoomStatus", "房间状态", "多处"],
        ["budget", "Budget", "perRun / perBot / perRoom（token）", "建房（固定值）"],
        ["shared", "string", "共享工作目录；目前恒为空", "—"],
        ["members", "Member[]", "成员表", "拉人 / 每轮"],
        ["sessionId / sessionSeq", "string / number", "旧字段，兼容用", "每轮"],
        ["tokensUsed", "number", "房间累计 token", "每轮累加"],
        ["delivery", "Delivery", "最近一次验收", "验收"],
    ],
    widths=[4.0, 2.6, 6.4, 3.0],
)

h2(doc, "2.4 数据模型（Member）")
table(
    doc,
    ["字段", "含义"],
    [
        ["botId", "稳定身份；默认成员是 bot_default"],
        ["name", "显示名，也是 @ 的目标"],
        ["role", "host（总管）或 worker（执行）"],
        ["sessionId / sessionSeq", "该 Bot 在本房间的会话与事件水位"],
        ["status", "状态灯"],
        ["activity", "一句话说明当前在干什么"],
        ["tokensUsed", "本 Bot 在本房间的花费"],
        ["files", "软写锁：它声明负责的文件"],
    ],
    widths=[4.4, 11.2],
)

h2(doc, "2.5 磁盘上的真实样子")
body(doc, "数据在 `~/.dsh/dshbot/rooms.json`，一个文件装全部房间与消息。结构如下（内容已简化）：")
code(
    doc,
    '{\n'
    '  "version": 1,\n'
    '  "rooms": [\n'
    '    {\n'
    '      "id": "room_a542d9dea0a3",\n'
    '      "name": "项目现状摘要",\n'
    '      "goal": "读 README 与 TASKS，写一份 300 字以内的项目现状摘要",\n'
    '      "acceptance": ["提到 M0 与 M1 的完成情况", "列出至少 3 条未完成项"],\n'
    '      "status": "created",\n'
    '      "budget": { "perRun": 200000, "perBot": 800000, "perRoom": 1500000 },\n'
    '      "members": [\n'
    '        { "botId": "bot_default", "name": "小柯", "role": "worker",\n'
    '          "sessionId": "session-…", "sessionSeq": 35, "status": "idle",\n'
    '          "tokensUsed": 82914 }\n'
    '      ],\n'
    '      "tokensUsed": 82914,\n'
    '      "delivery": {\n'
    '        "checks": [{ "point": "…", "verdict": "pass", "reason": "…" }],\n'
    '        "changedFiles": ["README.md"], "summary": "验收点 2/3 通过…"\n'
    '      }\n'
    '    }\n'
    '  ],\n'
    '  "messages": [\n'
    '    { "id": "msg_…", "roomId": "room_…", "kind": "human", "from": "human",\n'
    '      "text": "…", "createdAt": "2026-11-10T00:30:00.000Z" }\n'
    '  ]\n'
    '}\n'
)

note(
    doc,
    "写入策略",
    "每次保存都是「写临时文件 → 改名覆盖」。好处是断电不会留半截文件；"
    "代价是每发一条消息都会重写整个 JSON——房间多了会变慢，这是已知问题。",
)

# ---------------- 第 3 部分 ----------------
h1(doc, "第 3 部分　运行原理")

h2(doc, "3.1 一次对话的完整旅程")
table(
    doc,
    ["#", "发生什么", "在哪"],
    [
        ["1", "点发送，前端 POST `rooms/:id/messages`", "page.tsx"],
        ["2", "路由校验房间存在、是否暂停/归档", "api.ts"],
        ["3", "落盘用户消息，目标成员置 queued", "turn.ts"],
        ["4", "解析 @，决定谁接（见 3.6）", "turn.ts resolveTargets"],
        ["5", "拼上下文块（见 3.2）", "turn.ts buildContext"],
        ["6", "`createSession` 新开或 `resolveAgent` 续上会话", "agent.ts acquireAgent"],
        ["7", "投递用户消息，等 agent 状态 running→idle", "agent.ts runOnce"],
        ["8", "接收事件流，按 seq 去重（见 3.4）", "agent.ts"],
        ["9", "抽助手文本、工具调用、token 用量", "agent.ts"],
        ["10", "落盘工具消息与回复，更新成员会话/水位/花费", "turn.ts runMember"],
        ["11", "若接话的是总管，解析回复里的 @ 派活（见 3.6）", "turn.ts"],
        ["12", "返回本轮产生的消息，前端刷新列表与状态灯", "page.tsx"],
    ],
    widths=[0.9, 10.4, 4.3],
)

h2(doc, "3.2 上下文块：为什么不灌历史")
body(
    doc,
    "每个 Bot 有独立会话，但**它不知道别人干了什么**。解决办法不是把别人的会话灌进去，"
    "而是每次调用前现拼一段「房间近况」——这样上下文长度恒定，且不会互相污染。",
)
code(
    doc,
    "【房间】项目现状摘要\n"
    "目标：读 README 与 TASKS，写一份 300 字以内的摘要\n"
    "验收：1. 提到 M0 与 M1 的完成情况  2. 列出至少 3 条未完成项  3. 全文不超过 400 字\n"
    "成员：小柯（执行）、老周（执行）、阿岚（总管）\n"
    "你是执行 Bot「小柯」：只做分给你的那一件事，最多用 5 次工具，够用就下结论。\n"
    "不要调用 subagent 工具。\n"
    "你负责的文件：README.md。不要动别人的文件。\n"
    "\n"
    "【最近动态】\n"
    "我：谁来写这份摘要？派一个人读 README 和 TASKS…\n"
    "阿岚：我先确认一下目录…\n"
    "\n"
    "【你的任务】\n"
    "阿岚 → 小柯：@小柯 请写这份《项目现状摘要》，只做这一件事。",
)
table(
    doc,
    ["段", "来源", "上限"],
    [
        ["房间头", "room.goal + acceptance + 成员表", "固定"],
        ["角色指令", "host / worker 不同", "固定"],
        ["文件声明", "member.files（软写锁）", "最多 5 条"],
        ["最近动态", "最近 12 条消息，每条压到 90 字", "约 1000 字"],
        ["任务", "本次触发文本", "原文"],
        ["全块", "—", "≤ 2400 字，超出直接截断"],
    ],
    widths=[3.0, 8.6, 4.0],
)

h2(doc, "3.3 会话归属与续聊")
body(
    doc,
    "一只 Bot 一个 `sessionId`。下一轮再找它时，先 `resolveAgent(sessionId)`：进程内活着就直接用，"
    "不在就冷恢复；实在没有才新开。",
)
note(
    doc,
    "不要自己传 sessionId 给 createSession",
    "传了会进 claim/reuse 分支，实测一个请求跑出 15 个重复回合。让宿主自己 mint（session-uuid）。",
)

h2(doc, "3.4 事件流：整包快照 + 水位")
body(
    doc,
    "插件从 `agent.ctx.on('session/event')` 收到的事件帧，**每一帧都是当前全部日志的快照**，"
    "形如 `{ log: [ …全部事件… ] }`。不是增量。",
)
table(
    doc,
    ["坑", "现象", "正确做法"],
    [
        ["把所有帧摊平", "同一事件出现十几遍，数出 15 个 turn/start", "按 `seq` 去重"],
        ["续聊时读全量", "上一轮的回复又被拼进这一轮", "只处理 `seq > 成员水位` 的事件"],
        ["只认 role==='assistant'", "模型只给 reasoning 时返回空串", "空串时降级提示，不要假装成功"],
    ],
    widths=[4.2, 6.4, 5.0],
)
code(
    doc,
    "// 事件形状\n"
    '{ "type": "turn/start",  "seq": 4,  "time": 1794236648873, "data": { "turn": 1 } }\n'
    '{ "type": "tool/call",   "seq": 16, "data": { "callId": "call_x", "name": "pwsh",\n'
    '                                              "arguments": "{\\"command\\":\\"…\\"}" } }\n'
    '{ "type": "tool/result", "seq": 19, "data": { "message": { "role": "tool",\n'
    '                                              "toolCallId": "call_x",\n'
    '                                              "content": [{ "type": "text", "text": "…" }] } } }\n'
    '{ "type": "assistant/message", "seq": 15, "data": { "message": { "role": "assistant", … },\n'
    '                                              "usage": { "inputTokens": 656, "outputTokens": 2,\n'
    '                                                         "totalTokens": 9106 } } }\n'
    '{ "type": "turn/end",    "seq": 17, "data": { "reason": { "kind": "completed" } } }'
)

h2(doc, "3.5 并发与队列")
table(
    doc,
    ["层", "限制", "来源"],
    [
        ["房间内", "一次只跑一轮（串行队列）", "turn.ts 的 enqueue（内存 Map）"],
        ["派活", "最多 3 路，同时跑 2 路", "MAX_DISPATCH / DISPATCH_CONCURRENCY"],
        ["宿主", "8 个并发 activation", "DSH 的 maxActiveSubagents 默认值"],
        ["现实容量", "约 3 个房间 × 2 并发", "上述约束的组合结果"],
    ],
    widths=[2.6, 6.8, 6.2],
)
note(
    doc,
    "队列在内存里",
    "重启后排队中的请求既没执行也没记录。这是已知问题，见第 9 章。",
)

h2(doc, "3.6 派活：从一句话到任务卡")
numbered(
    doc,
    [
        "总管跑完，拿到它的回复全文。",
        "用 `@([^\\s@，,。.:：]+)` 抽出所有 @ 名字。",
        "在成员表里找同名成员，排除总管自己，最多取 3 个。",
        "对每个接收者，从回复里摘出含 `@名字` 的那一行，作为它的任务。",
        "从任务文本里抽文件路径（`extractFiles`），做软写锁声明，有冲突就发系统提醒。",
        "先落一张「进行中」的任务卡，再并行跑执行者。",
        "每个执行者跑完，落一张「完成/失败」的卡，附 240 字结论摘要（Handoff）。",
    ],
    size=9.5,
)

h2(doc, "3.7 验收判定：三次翻车的设计")
table(
    doc,
    ["版本", "做法", "结果", "教训"],
    [
        ["v1", "复用总管会话判", "它又去翻文件，跑到步数上限，返回空文本", "判定者不该有工具"],
        ["v2", "禁工具 + 全新会话", "能判了，但全是「存疑」——它只看到 90 字摘要", "要给产出正文"],
        ["v3", "再喂最近 3 条 Bot 完整回复", "2/3 通过，fail 的理由准确指出超字数", "证据决定结论"],
    ],
    widths=[1.4, 5.4, 6.4, 3.6],
)
body(
    doc,
    "现在的判定流程：`git status` 取变更文件 → 拼「房间头 + 最近动态 + 产出正文 + 变更文件」→ "
    "新会话判定 → 三级容错解析（JSON 数组 → 逐行匹配 → 存疑）→ 全存疑则重试一次。",
)

h2(doc, "3.8 软写锁：说清楚它是什么")
body(
    doc,
    "DSH 没有给第三方插件暴露「文件写入前拦截」的钩子，agent 的工具调用在它自己的沙箱里完成。"
    "所以硬锁**做不到**。M1 采取的是约定：",
)
bullets(
    doc,
    [
        "派活时从任务文本抽文件路径，写进成员的 `files`；",
        "上下文块里告诉它「你负责这些文件，不要动别人的」；",
        "同一文件已被别人声明时，发一条系统消息提醒；",
        "交付时用 `git status` 列变更，人工看有没有踩到同一个文件。",
    ],
)

# ---------------- 第 4 部分 ----------------
h1(doc, "第 4 部分　代码地图")

h2(doc, "4.1 仓库结构")
code(
    doc,
    "packages/\n"
    "  core/                零 DSH 依赖：类型与 id\n"
    "    src/types.ts          Room / Member / Message / Assignment / Delivery（174 行）\n"
    "    src/ids.ts            newId / nowIso（12 行）\n"
    "    src/index.ts          再导出（5 行）\n"
    "  plugin/              DSH 插件\n"
    "    src/index.ts          插件入口：inject + 挂路由（26 行）\n"
    "    src/host/api.ts       HTTP 路由与校验（313 行）\n"
    "    src/host/turn.ts      编排核心（591 行）\n"
    "    src/host/agent.ts     与宿主 Agent 打交道（362 行）\n"
    "    src/host/store.ts     JSON 存储与惰性迁移\n"
    "    src/host/types.ts     宿主服务的最小类型声明\n"
    "    src/client/index.ts   注册 main 面板 + 侧栏入口（24 行）\n"
    "    src/client/page.tsx   整个房间界面（1111 行）\n"
    "    src/client/api.ts     浏览器侧 fetch 封装\n"
    "    build.mjs             esbuild 构建（含 __ModuleLoader__ 包装）\n"
    "  cli/                 命令行骨架\n"
    "scripts/install.mjs    构建 → 类型检查 → link 进 profile → 补丁层\n"
    "spike/                 验证记录、截图与取证脚本\n"
)

h2(doc, "4.2 关键函数索引")
table(
    doc,
    ["函数", "位置", "作用", "被谁调用"],
    [
        ["createHandler(ctx)", "api.ts", "返回 HTTP 处理器", "index.ts"],
        ["buildRoom(input)", "api.ts", "校验并构造房间", "POST /rooms"],
        ["pauseRoom(id, msg)", "api.ts", "置暂停并留系统消息", "停手 / 接管"],
        ["handleRoomMessage()", "turn.ts", "一条消息的完整处理（含队列）", "POST messages"],
        ["enqueue(key, job)", "turn.ts", "每房间串行队列", "handleRoomMessage"],
        ["parseMentions(text)", "turn.ts", "抽 @ 名字", "路由 / 派活"],
        ["resolveTargets(room, mentions)", "turn.ts", "决定谁接话", "handleRoomMessage"],
        ["buildContext(room, member, task)", "turn.ts", "拼上下文块", "runMember"],
        ["runMember(ctx, roomId, member, task)", "turn.ts", "跑一个成员并落盘", "主流程 / 派活"],
        ["dispatchTargets(room, reply, self)", "turn.ts", "从总管回复找派活对象", "派活"],
        ["taskFor(reply, name)", "turn.ts", "摘出某人的任务句", "派活"],
        ["extractFiles(text)", "turn.ts", "抽文件路径（软写锁）", "派活"],
        ["runWithLimit(items, n, fn)", "turn.ts", "限量并发", "派活"],
        ["deliverRoom(ctx, roomId)", "turn.ts", "验收并落交付", "POST deliver"],
        ["parseChecks(raw, points)", "turn.ts", "三级容错解析判定", "deliverRoom"],
        ["changedFiles(dir)", "turn.ts", "git status 取变更", "deliverRoom"],
        ["runOnce(ctx, prompt, cwd, …)", "agent.ts", "跑一轮 agent", "turn.ts / 验收"],
        ["acquireAgent(ctx, id, cwd)", "agent.ts", "续聊或新开", "runOnce"],
        ["extractText / extractTools / extractUsage", "agent.ts", "从事件抽三样东西", "runOnce"],
        ["loadDb / saveDb", "store.ts", "读写 JSON（原子写）", "全局"],
        ["migrateRoom(room)", "store.ts", "老数据补 members", "loadDb"],
    ],
    widths=[5.2, 2.4, 5.6, 3.2],
)

h2(doc, "4.3 影响面：改一处会牵动哪里")
table(
    doc,
    ["你想改", "必须同时改", "容易漏的地方"],
    [
        ["房间字段", "core/types.ts + store 迁移 + 前端渲染", "老数据的默认值"],
        ["新增消息类型", "core 的 MessageKind + MessageRow 渲染 + 上下文块过滤", "上下文块会把新类型也喂进去"],
        ["改路由规则", "resolveTargets + 前端提示文案 + 实验案例文档", "多 Bot 无 @ 的提示语"],
        ["改上下文结构", "buildContext + 验收用的 recentLines", "两处都依赖消息序列"],
        ["加接口", "api.ts 路由分支 + client/api.ts + 文档第 5 章", "错误码与 404 分支"],
        ["改构建产物格式", "build.mjs 的 banner/footer + plugin/package.json 的 dsh.client", "两处必须一致"],
    ],
    widths=[4.4, 7.0, 4.2],
)

h2(doc, "4.4 前端 1111 行的内部区块")
table(
    doc,
    ["区块", "大致位置", "职责", "拆分建议"],
    [
        ["常量与工具", "顶部 60 行", "颜色、状态文案、formatTokens", "抽到 theme.ts"],
        ["SectionTitle / Badge", "60-100", "小展示件", "抽到 ui.tsx"],
        ["MessageRow / ToolRow / AssignmentRow", "100-390", "消息渲染", "抽到 messages/"],
        ["DeliveryPanel", "391-450", "交付面板", "抽到 delivery.tsx"],
        ["RoomDetail", "450-740", "房间主视图", "抽到 room/"],
        ["MemberPanel / MemberCard", "740-900", "成员面板", "抽到 members.tsx"],
        ["RoomsPage", "900-1111", "整体状态与布局", "保留为容器"],
    ],
    widths=[5.2, 3.0, 5.2, 3.6],
)

# ---------------- 第 5 部分 ----------------
h1(doc, "第 5 部分　本项目 API 参考")

h2(doc, "5.1 路由总表")
table(
    doc,
    ["方法", "路径", "用途", "幂等"],
    [
        ["GET", "/dshbot/api/health", "存活探测", "是"],
        ["GET", "/dshbot/api/rooms", "列房间（含成员与交付）", "是"],
        ["POST", "/dshbot/api/rooms", "建房间", "否"],
        ["POST", "/dshbot/api/rooms/:id/members", "拉一只 Bot 进来", "否（重名 409）"],
        ["POST", "/dshbot/api/rooms/:id/state", "暂停/恢复/归档/仅@", "是"],
        ["GET", "/dshbot/api/rooms/:id/messages", "读消息", "是"],
        ["POST", "/dshbot/api/rooms/:id/messages", "说话（触发 Bot）", "否"],
        ["POST", "/dshbot/api/rooms/:id/deliver", "验收", "否（覆盖上次结论）"],
        ["POST", "/dshbot/api/rooms/:id/takeover", "接管 / 交还", "是"],
    ],
    widths=[1.6, 7.6, 5.0, 2.4],
)

h2(doc, "5.2 关键端点")
h3(doc, "POST /rooms")
code(
    doc,
    '请求: { "name": "项目现状摘要", "goal": "…", "acceptance": ["…", "…"] }\n'
    '201 : { "room": { …完整 Room… } }\n'
    '400 : { "error": "name 不能为空" | "goal 不能为空" | "至少需要一条验收标准" }'
)
h3(doc, "POST /rooms/:id/messages")
code(
    doc,
    '请求: { "text": "谁来写这份摘要？派一个人…" }\n'
    '200 : { "messages": [ 用户消息, 工具消息…, 回复…, 任务卡… ], "skipped": false }\n'
    '200 : { "messages": [ 用户消息, 提示 ], "skipped": true }   ← 没人接话\n'
    '409 : { "error": "房间已暂停，先恢复再说话" }\n'
    '400 : { "error": "text 不能为空" }'
)
h3(doc, "POST /rooms/:id/deliver")
code(
    doc,
    '请求: {}\n'
    '200 : { "delivery": { "checks": [{ "point", "verdict", "reason" }],\n'
    '                       "changedFiles": ["…"], "tokensUsed": 12345,\n'
    '                       "summary": "验收点 2/3 通过；变更文件 4 个" } }\n'
    '409 : { "error": "房间已暂停或归档，先恢复再验收" }'
)
h3(doc, "POST /rooms/:id/takeover")
code(
    doc,
    '接管: { "action": "take" }\n'
    '交还: { "action": "return", "note": "我改了 TASKS.md 的 M3 状态" }\n'
    '200 : { "room": {…}, "messages": [ 系统消息 ] }'
)

h2(doc, "5.3 统一约定")
table(
    doc,
    ["约定", "说明"],
    [
        ["文档相对路径", "前端 fetch 用 `dshbot/api/...`（无前导斜杠），web 与 Electron 都能解析"],
        ["无鉴权", "只监听回环地址；本机任何进程可访问，开源给他人前要加 token"],
        ["不缓存", "所有响应带 `cache-control: no-store`"],
        ["错误体", "统一 `{ error: string }`，中文可读"],
        ["状态码", "400 参数错 / 404 不存在 / 405 方法错 / 409 状态冲突 / 500 内部错 / 207 部分失败"],
    ],
    widths=[4.0, 11.6],
)

# ---------------- 第 6 部分 ----------------
h1(doc, "第 6 部分　DSH 官方接口怎么读")

body(
    doc,
    "这一章是全篇最该反复看的部分。DSH 的插件接口**没有公开的在线文档**，"
    "但有四类可靠的一手资料。学会读它们，你就能自己查清任何没写进手册的接口。",
)

h2(doc, "6.1 先理解包结构")
body(
    doc,
    "DSH 的全部实现都在一个目录下，包名统一是 `@deepseek-ai/dsh-*`，按职责分组：",
)
table(
    doc,
    ["前缀", "职责", "例子"],
    [
        ["dsh-agent / dsh-session", "Agent 与会话本体", "dsh-agent、dsh-session、dsh-agent-loop"],
        ["dsh-tool-*", "给模型用的工具", "dsh-tool-fs、dsh-tool-pwsh、dsh-tool-subagent"],
        ["dsh-client-ui-*", "浏览器端界面插件", "dsh-client-ui-sidebar、dsh-client-ui-layout"],
        ["dsh-api-*", "暴露给浏览器的 RPC 服务", "dsh-api-session-controller"],
        ["dsh-host-*", "宿主侧基础设施", "dsh-host-webserver"],
        ["dsh-llm-*", "模型适配", "dsh-llm-deepseek-account"],
        ["dsh-experimental-*", "实验特性", "dsh-experimental-agent-team"],
    ],
    widths=[4.6, 5.8, 5.2],
)

h2(doc, "6.2 一手资料的三个入口")
h3(doc, "① 包自带的 README.zh.md")
body(
    doc,
    "每个包目录下都有一份中文包文档，通常包含：概述 / 使用本包 / 理解实现 / 已知限制。"
    "**「使用本包」一节就是 API 说明书**，其余可以按需读。",
)
code(
    doc,
    "# 文档在（asar 是打包归档，普通解压工具打不开，用 Electron 当 Node 读）\n"
    "D:\\...\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\<包名>\\README.zh.md\n"
    "\n"
    "# 用宿主自带的 Electron 读（它支持 asar）\n"
    "$env:ELECTRON_RUN_AS_NODE = '1'\n"
    "& \"D:\\...\\DeepSeek Harness.exe\" -e \"console.log(require('fs').readFileSync(\\\n"
    "  'D:/.../app.asar/dsh/node_modules/@deepseek-ai/dsh-host-webserver/README.zh.md','utf8').slice(0,3000))\""
)

h3(doc, "② .d.ts 类型声明")
body(
    doc,
    "`lib/types/**/*.d.ts` 是编译产物里的类型，签名最准。查一个类有哪些方法、参数是什么形状，"
    "直接看这里比读编译后的 `.js` 快得多。",
)
h3(doc, "③ 两份配置转储")
table(
    doc,
    ["命令", "得到什么", "什么时候用"],
    [
        ["dsh --profile web --dump-config", "当前 profile 组合出的完整插件树", "确认某插件在不在、配置是什么"],
        ["dsh --profile web --dump-config-schema", "插件配置的 JSON Schema", "查 patch 语法、字段含义"],
    ],
    widths=[7.4, 5.4, 2.8],
)
note(
    doc,
    "desktop profile 是例外",
    "`--profile desktop` 会报「managed exclusively by the Electron application」，"
    "拿不到 dump。做组合校验请用 `dshbot-dev` 这类自建 profile。",
)

h2(doc, "6.3 找服务键的四步法")
numbered(
    doc,
    [
        "**搜注册处**：在包的 `lib/index.js` 里搜 `super(ctx, \"`，看到的就是服务键。"
        "例：`super(ctx, \"sessionController\", { namespace: \"session\" })`。",
        "**看 inject**：插件的 `export const inject = [...]` 列出它依赖的服务键，反过来也能确认键名。",
        "**读 README**：多数包的「使用本包」会直接写出 `ctx.xxx` 的调用方式。",
        "**写探针验证**：临时加一个接口，把 `Object.keys(ctx.xxx)` 打出来——文档可能过时，运行时不会。",
    ],
    size=9.5,
)
code(
    doc,
    "// 实测片段：dsh-api-session-controller 里 sessionController 的注册\n"
    "var SessionController = class extends TypertRemoteService {\n"
    "  constructor(ctx, config, internals = {}) {\n"
    "    super(ctx, \"sessionController\", { namespace: \"session\" });   // ← 服务键\n"
    "    this.agents = new ApiSessionAgentController(ctx);              // ← createSession 在这\n"
    "  }\n"
    "}"
)
body(
    doc,
    "这就是为什么插件里能写 `ctx.sessionController.agents.createSession({ cwd })`——"
    "它和界面点「新会话」走的是同一段代码。",
)

h2(doc, "6.4 九个关键服务的契约")
table(
    doc,
    ["服务键", "从哪读", "关键方法", "本项目用在哪"],
    [
        ["webServer", "dsh-host-webserver", "register({kind:'prefix', path, handler})", "挂 /dshbot/api"],
        ["agents", "dsh-agent", "create / get / createSession?", "取 agent 句柄"],
        ["sessionController", "dsh-api-session-controller", "agents.createSession / resolveAgent", "起会话、续聊"],
        ["sessions", "dsh-session", "prepare / get", "读事件"],
        ["subagent", "dsh-subagent", "startActivation（需活着的父 agent）", "未用（需要父 agent）"],
        ["user-approval", "dsh-user-approval", "内置审批流", "未接（见第 9 章）"],
        ["schedule", "dsh-tool-schedule", "cron 定时", "未用（M4）"],
        ["skill", "dsh-tool-skill", "SKILL.md", "未用（M4）"],
        ["attachment", "dsh-attachment", "admitPromptContent", "未用"],
    ],
    widths=[3.2, 4.4, 5.4, 4.2],
)

h2(doc, "6.5 客户端插件的三个约定")
table(
    doc,
    ["约定", "内容"],
    [
        ["bundle 形状", "`window.__ModuleLoader__.load({ id, factory: (require) => {…} })`"],
        ["导出", "`exports.apply(ctx)` + `exports.inject = ['slots','layout']`"],
        ["插槽", "`ctx.slots.register({ name:'main', key:'rooms' }, Page)`；侧栏用 `sidebar.panellist` 且 id 必须同名"],
        ["共享模块", "react / react-dom / cordis / zod / dsh-client-ui-primitives 等 11 项，必须 external"],
        ["构建要求", "宿主只认已构建的 `lib/client.js`，不认 TS 源码"],
    ],
    widths=[3.4, 12.2],
)

h2(doc, "6.6 怎么验证一个接口能不能用")
table(
    doc,
    ["手段", "做法", "适合验证"],
    [
        ["探针接口", "临时加一个路由，把结果 JSON 打出来", "服务是否存在、方法返回什么"],
        ["日志断言", "在插件里 console.log 关键字段", "加载顺序、inject 是否满足"],
        ["CDP 截图", "无头 Edge 连 DevTools，点按钮后截图", "界面是否真的渲染"],
        ["dump-config", "看插件树", "配置是否生效"],
    ],
    widths=[2.8, 7.0, 5.8],
)

h2(doc, "6.7 升级 DSH 后要重核的六件事")
table(
    doc,
    ["#", "核对点", "怎么核"],
    [
        ["1", "插件接口是否还在", "dump-config 里还找得到 dshbot 条目"],
        ["2", "sessionController 是否还有 agents.createSession", "探针调用一次"],
        ["3", "事件帧是否仍是整包快照", "看一帧的 log 长度是否随对话增长"],
        ["4", "共享模块表是否变了", "看 index-*.js 里的模块表"],
        ["5", "client bundle 格式是否变了", "对比一个官方 client.js 的头部"],
        ["6", "slot 名称是否改了", "搜 ui-layout 的 README"],
    ],
    widths=[0.9, 7.0, 7.7],
)

h2(doc, "6.8 已知的接口边界（三件做不到的事）")
table(
    doc,
    ["想做的事", "为什么做不到", "替代方案"],
    [
        ["拦截 Bot 的工具调用（真审批）", "插件拿不到工具层钩子", "依赖 DSH 自带审批；或让 Bot 只写暂存区"],
        ["进程级隔离每个 Run", "账号凭证绑 inferenceOrigin，子进程拿不到 token", "进程内会话隔离 + 工作区隔离"],
        ["脱离 GUI 后台跑", "插件活在宿主进程里", "没有；除非 DSH 提供 headless 的账号凭证方案"],
    ],
    widths=[4.6, 6.6, 4.4],
)

# ---------------- 第 7 部分 ----------------
h1(doc, "第 7 部分　操作手册")

h2(doc, "7.1 安装 / 升级 / 卸载")
code(
    doc,
    "# 安装或升级（构建 + 类型检查 + 链接进 profile + 补丁层）\n"
    "cd D:\\Desktop\\DSBOT\n"
    "pnpm install\n"
    "pnpm install:profile\n"
    "\n"
    "# 然后完全退出 DSH（含托盘），重新打开"
)
table(
    doc,
    ["要做", "命令"],
    [
        ["卸载插件", "dsh plugin --profile desktop remove @dshbot/plugin，再删补丁层里的托管段"],
        ["只回滚配置", "把 cordis.patch.yml.bak-* 拷回 cordis.patch.yml"],
        ["清空数据", "退出 DSH 后删 %USERPROFILE%\\.dsh\\dshbot\\rooms.json"],
    ],
    widths=[4.0, 11.6],
)

h2(doc, "7.2 第一次使用")
numbered(
    doc,
    [
        "左侧点 🏠 **房间**。空白列表是正常的。",
        "点「＋ 新建房间」，填名称、目标、验收标准（**一行一条，至少一条**）。",
        "右侧点「＋ 拉一个 Bot」，输入名字（如 `老周`）。",
        "想有总管，就再拉一只并在接口里指定 `role: \"host\"`（界面暂不支持选角色）。",
        "底部输入框说一句话，比如「派一个人读 README，写三条要点」。",
        "看中间出现任务卡、右边状态灯变化、下面成本条上涨。",
        "点右上角「交付验收」，等 10–60 秒，看结论。",
    ],
    size=9.5,
)

h2(doc, "7.3 房间控制")
table(
    doc,
    ["按钮", "作用", "注意"],
    [
        ["交付验收", "跑一次判定，生成交付结论", "会产生额外 token 消耗"],
        ["接管", "暂停房间，成员置「等人」", "此时发消息会被 409 拒绝"],
        ["交还", "填写改动后恢复，摘要进房间", "摘要会成为 Bot 下一轮的上下文"],
        ["归档", "房间移到已归档状态", "不能删除，数据仍在"],
        ["仅 @ 响应", "没 @ 到人时只记录不回", "多 Bot 房间建议打开"],
        ["@所有人 停", "发这条消息即可全体暂停", "任何成员都能触发"],
    ],
    widths=[3.2, 6.6, 5.8],
)

h2(doc, "7.4 排错表")
table(
    doc,
    ["现象", "原因", "处理"],
    [
        ["侧栏没有 🏠", "没彻底重启 / 安装失败", "看安装输出有没有「✓ 安装完成」"],
        ["页面「读取房间失败」", "插件没加载", "日志里找 `[dshbot] host side loaded`"],
        ["说完话没反应", "多 Bot 又没 @ 谁，且无总管", "改成 `@名字 …`，或加总管"],
        ["提示「房间里没有「XX」」", "@ 的名字与成员名不一致", "对着右侧成员卡逐字核对"],
        ["任务卡一直「进行中」", "执行者还在跑，或已卡死", "等 2 分钟；不行就「接管」"],
        ["交付全是「存疑」", "判定拿不到产出正文", "先让 Bot 说完整结论再验收"],
        ["点验收 409", "房间被暂停/归档", "先点恢复"],
        ["回复是「（模型没有返回文字）」", "模型只调工具没给结论", "换说法，或减少工具步数"],
        ["成本条不涨", "前端没刷新", "切一下房间再回来"],
        ["命令找不到 dsh", "当前窗口没重载 PATH", "开新窗口"],
        ["端口被占用", "上次实例没关", "杀掉占用进程"],
        ["JSON 报 `Unexpected token`", "文件带 BOM", "用无 BOM UTF-8 重写"],
    ],
    widths=[4.8, 5.4, 5.4],
)

h2(doc, "7.5 数据维护")
code(
    doc,
    "# 备份\n"
    "Copy-Item \"$env:USERPROFILE\\.dsh\\dshbot\\rooms.json\" \"$env:USERPROFILE\\Desktop\\rooms-backup.json\"\n"
    "\n"
    "# 清空（先退出 DSH）\n"
    "Remove-Item \"$env:USERPROFILE\\.dsh\\dshbot\\rooms.json\" -Force"
)

# ---------------- 第 8 部分 ----------------
h1(doc, "第 8 部分　开发手册")

h2(doc, "8.1 构建与调试")
table(
    doc,
    ["命令", "作用", "耗时"],
    [
        ["pnpm build", "构建 plugin 与 cli", "约 1 秒"],
        ["pnpm typecheck", "只检查不产出", "约 3 秒"],
        ["pnpm install:profile", "构建 + 检查 + 装进 desktop", "约 5 秒"],
        ["dsh --profile dshbot-dev --port 54873 --no-open", "起独立实例调试", "约 3 秒"],
    ],
    widths=[8.0, 5.4, 2.2],
)
note(
    doc,
    "改完代码必须重启 DSH",
    "Loader 条目只在启动时组合；客户端 bundle 也有 rev 缓存。热更新只能靠 `pnpm run dev:web`（本项目未配置）。",
)

h2(doc, "8.2 加一个接口（六步）")
numbered(
    doc,
    [
        "在 `api.ts` 的 `handle` 里加一个 `parts` 分支，仿照 `/rooms/:id/deliver`。",
        "在 `client/api.ts` 里加对应的 `request()` 封装。",
        "在 `page.tsx` 里接事件处理与状态更新。",
        "`pnpm typecheck` 确认没有类型错。",
        "`pnpm build` + 重启 dev 实例，用 curl 打一次。",
        "成功后同步第 5 章的路由总表与端点说明。",
    ],
    size=9.5,
)

h2(doc, "8.3 加一个 UI 区块（五步）")
numbered(
    doc,
    [
        "在 `page.tsx` 里新建一个 `function XxxPanel(props)`，用 `h()`（createElement 别名）而非 JSX。",
        "颜色用现有常量 `MUTED` / `LINE`；新增样式尽量内联，避免引入 CSS 文件。",
        "在 `RoomDetail` 或 `RoomsPage` 的返回数组里插入它。",
        "需要交互就把 handler 挂在 `RoomsPage` 上，通过 props 下传（现有模式）。",
        "重启后截图确认，再更新第 4.4 节的区块表。",
    ],
    size=9.5,
)

h2(doc, "8.4 提交与版本")
table(
    doc,
    ["约定", "说明"],
    [
        ["提交粒度", "一次改动一个 commit，用 `feat:` / `fix:` / `docs:` / `chore:` 前缀"],
        ["版本号", "packages/plugin/package.json 的 version，当前 0.1.0"],
        ["发布前", "build + typecheck + 一次端到端案例"],
        ["不要提交", "node_modules、lib 产物、.dsh-office-* 临时目录"],
    ],
    widths=[3.6, 12.0],
)

# ---------------- 第 9 部分 ----------------
h1(doc, "第 9 部分　已知问题与路线")

h2(doc, "9.1 三个 P0")
table(
    doc,
    ["问题", "后果", "修法"],
    [
        ["零测试", "每次改动靠人眼回归", "先给 turn.ts 五个纯函数补 node:test"],
        ["工作目录取 process.cwd()", "Bot 可能改到安装目录或用户主目录", "房间必须有 workspaceDir，默认 ~/.dsh/dshbot/rooms/<id>/work"],
        ["中断后状态卡死", "房间永远显示「进行中」", "插件启动时重置 working/thinking/queued"],
    ],
    widths=[4.6, 6.2, 4.8],
)

h2(doc, "9.2 功能缺口")
table(
    doc,
    ["缺口", "影响"],
    [
        ["目标/验收建完不能改", "改一个字要重建房间"],
        ["不能删除房间", "数据只增不减"],
        ["成员角色无 UI", "总管要调接口才能设"],
        ["审批卡缺失", "危险动作仍靠 DSH 自带审批"],
        ["产物无版本链、无应用/回滚", "Bot 直接改文件，改坏无法回退"],
        ["无实时推送", "跑的时候只能等"],
        ["交付不可导出", "结论只能看，拿不走"],
    ],
    widths=[6.4, 9.2],
)

h2(doc, "9.3 三批改进")
table(
    doc,
    ["批次", "内容", "目标"],
    [
        ["第一批", "测试、固定工作区、启动自愈、取消按钮、Markdown 渲染", "从能演示到敢用"],
        ["第二批", "SSE 推送、可编辑房间、角色 UI、导出、注入防护", "从敢用到好用"],
        ["第三批", "结构化验收、产物版本与应用回滚、真写锁、前端拆分", "结构升级"],
    ],
    widths=[2.6, 9.6, 3.4],
)

note(
    doc,
    "如果只做三件事",
    "补测试、固定工作区、把验收项变成可执行谓词。前两件保安全，第三件保「可验收」这个卖点成立。",
)

# ---------------- 第 10 部分 ----------------
h1(doc, "第 10 部分　附录")

h2(doc, "10.1 术语表")
table(
    doc,
    ["术语", "含义"],
    [
        ["DSH / DeepSeek Harness", "宿主应用，提供 AI 能力、工具、沙箱与插件机制"],
        ["cordis", "DSH 使用的插件框架，服务通过 `ctx.xxx` 暴露"],
        ["profile", "一套插件组合与配置，如 desktop / web / headless"],
        ["插件 / plugin", "能被 DSH 加载的扩展包"],
        ["slot / 插槽", "宿主预留的界面位置，如 main、sidebar.panellist"],
        ["bundle", "构建后可直接加载的产物（lib/client.js）"],
        ["external", "不打包进产物、运行时由宿主提供的模块"],
        ["session", "DSH 的对话单元，事件可持久化"],
        ["activation", "一次子 agent 的启动"],
        ["Agent preset", "一套预设的模型与工具配置"],
        ["token", "模型计费单位"],
        ["水位 / seq", "事件序号，用来只处理新增部分"],
        ["Handoff", "Bot 之间的结构化交接"],
        ["SSE", "服务器推送事件，本项目尚未使用"],
        ["软写锁", "靠声明与提醒避免冲突，不做强制拦截"],
        ["交付 / delivery", "一次验收的结论集合"],
        ["room / 房间", "任务容器"],
        ["member / 成员", "Bot 在房间里的身份"],
        ["assignment / 任务卡", "一次派活的记录"],
        ["process.cwd()", "宿主进程的当前目录，本项目的工作区默认值"],
    ],
    widths=[5.0, 10.6],
)

h2(doc, "10.2 命令速查")
table(
    doc,
    ["场景", "命令"],
    [
        ["装 / 升级", "pnpm install:profile"],
        ["只检查", "pnpm typecheck"],
        ["编译", "pnpm build"],
        ["起调试实例", "dsh --profile dshbot-dev --port 54873 --no-open"],
        ["看配置树", "dsh --profile dshbot-dev --dump-config"],
        ["看数据", "notepad %USERPROFILE%\\.dsh\\dshbot\\rooms.json"],
        ["看提交", "git log --oneline"],
    ],
    widths=[4.0, 11.6],
)

h2(doc, "10.3 项目内文档索引")
table(
    doc,
    ["文件", "内容"],
    [
        ["DSHBot-需求规格-v1.1.md", "需求基线：房间模型、工位、审批、里程碑"],
        ["M1-技术方案.md", "多 Bot 的架构决策（每人一会话、软写锁、并发）"],
        ["TASKS.md", "任务清单与状态"],
        ["STATE.md", "当前状态快照与恢复步骤"],
        ["实验案例.md", "照着做的一个完整实验"],
        ["不足与改进.md", "不足分析（本文第 9 章的完整版）"],
        ["T2-验证报告.md", "插件页面注册的取证"],
        ["INSTALL.md / ENVIRONMENT.md", "安装与环境"],
        ["DSHBot新手指南.docx", "零基础入门（概念 + 步骤）"],
        ["spike/", "验证记录、截图、取证脚本"],
    ],
    widths=[6.4, 9.2],
)

h2(doc, "10.4 版本兼容")
table(
    doc,
    ["组件", "版本", "说明"],
    [
        ["DSH", "0.2.1-rc.5", "接口随版本变，升级后按 6.7 重核"],
        ["Node", "24.x", "DSH 内置 24.21，本项目开发用 24.22"],
        ["cordis", "4.0.5", "peer 依赖，与宿主一致"],
        ["React", "18.3.1", "与宿主共享表一致，不能打包两份"],
        ["TypeScript", "5.9.3", "构建期使用"],
        ["esbuild", "0.28.2", "打包"],
    ],
    widths=[3.4, 3.6, 8.6],
)

doc.save(r"D:\Desktop\DSBOT\DSHBot知识手册.docx")

check = Document(r"D:\Desktop\DSBOT\DSHBot知识手册.docx")
print("段落数:", len(check.paragraphs))
print("表格数:", len(check.tables))
print("一级标题:", [p.text for p in check.paragraphs if p.style.name == "Heading 1"])
