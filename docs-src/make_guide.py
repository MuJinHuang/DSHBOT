# -*- coding: utf-8 -*-
"""生成《DSHBot 新手指南》Word 文档。"""

from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

FONT_CN = "微软雅黑"
FONT_MONO = "Consolas"
ACCENT = RGBColor(0x1F, 0x4E, 0x79)
MUTED = RGBColor(0x59, 0x59, 0x59)


# ---------- 基础排版工具 ----------

def set_cn_font(target, name=FONT_CN):
    """给样式或 run 同时设置中英文字体。"""
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


def body(doc, text, size=10.5, color=None, space_after=6):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.45
    run = p.add_run(text)
    run.font.size = Pt(size)
    if color is not None:
        run.font.color.rgb = color
    return p


def bullets(doc, items, size=10.5):
    for item in items:
        p = doc.add_paragraph(style="List Bullet")
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.4
        run = p.add_run(item)
        run.font.size = Pt(size)


def code(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(4)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.left_indent = Cm(0.4)
    shade(p)
    run = p.add_run(text)
    run.font.name = FONT_MONO
    run.font.size = Pt(9.5)
    return p


def h1(doc, text, new_page=True):
    p = doc.add_heading(text, level=1)
    for run in p.runs:
        set_cn_font(run)
        run.font.color.rgb = ACCENT
        run.font.size = Pt(16)
    p.paragraph_format.space_before = Pt(18)
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.keep_with_next = True
    # 用“标题前分页”而不是插一个分页符段落：
    # 后者在上一页刚好排满时会自己掉到下一页，凭空多出空白页。
    if new_page:
        p.paragraph_format.page_break_before = True
    return p


def h2(doc, text):
    p = doc.add_heading(text, level=2)
    for run in p.runs:
        set_cn_font(run)
        run.font.color.rgb = ACCENT
        run.font.size = Pt(13)
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.keep_with_next = True
    return p


def h3(doc, text):
    p = doc.add_heading(text, level=3)
    for run in p.runs:
        set_cn_font(run)
        run.font.size = Pt(11.5)
    p.paragraph_format.space_before = Pt(10)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.keep_with_next = True
    return p


def _no_split(row):
    """禁止这一行跨页拆开。"""
    trpr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:cantSplit")
    trpr.append(el)


def _repeat_header(row):
    """表格跨页时重复表头。"""
    trpr = row._tr.get_or_add_trPr()
    el = OxmlElement("w:tblHeader")
    el.set(qn("w:val"), "true")
    trpr.append(el)


def spacer(doc):
    """表格之间的极矮间隔段，避免相邻表格粘连，同时不会撑出空白页。"""
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
    return p


def table(doc, headers, rows, widths=None, font_size=9):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    t.autofit = False

    # 固定布局，否则 Word/LO 会自己重算列宽，把内容挤变形
    tblpr = t._tbl.tblPr
    layout = OxmlElement("w:tblLayout")
    layout.set(qn("w:type"), "fixed")
    tblpr.append(layout)

    if widths:
        for i, w in enumerate(widths):
            t.columns[i].width = Cm(w)

    hdr = t.rows[0].cells
    for i, text in enumerate(headers):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        run = p.add_run(text)
        run.bold = True
        run.font.size = Pt(font_size)
        shade(p, "DCE6F1")
    _repeat_header(t.rows[0])
    _no_split(t.rows[0])

    for row in rows:
        cells = t.add_row().cells
        for i, text in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            run = p.add_run(str(text))
            run.font.size = Pt(font_size)
            p.paragraph_format.space_after = Pt(2)
        _no_split(t.rows[-1])

    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    spacer(doc)
    return t


def callout(doc, title, text):
    p = doc.add_paragraph()
    p.paragraph_format.left_indent = Cm(0.3)
    p.paragraph_format.space_before = Pt(6)
    p.paragraph_format.space_after = Pt(10)
    shade(p, "FFF6E5")
    run = p.add_run(title + "  ")
    run.bold = True
    run.font.size = Pt(10)
    run2 = p.add_run(text)
    run2.font.size = Pt(10)
    return p


# ---------- 文档 ----------

doc = Document()

# 页面设置：A4 + 常规页边距
section = doc.sections[0]
section.page_width = Cm(21)
section.page_height = Cm(29.7)
section.top_margin = Cm(2.4)
section.bottom_margin = Cm(2.2)
section.left_margin = Cm(2.4)
section.right_margin = Cm(2.2)

normal = doc.styles["Normal"]
set_cn_font(normal)
normal.font.size = Pt(10.5)

for style_name in ("Heading 1", "Heading 2", "Heading 3"):
    set_cn_font(doc.styles[style_name])

# ---------------- 封面 ----------------
p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(90)
run = p.add_run("DSHBot 新手指南")
run.font.size = Pt(34)
run.bold = True
run.font.color.rgb = ACCENT

p = doc.add_paragraph()
run = p.add_run("从零看懂这个项目：它是什么、怎么跑起来、用到了哪些知识")
run.font.size = Pt(14)
run.font.color.rgb = MUTED

p = doc.add_paragraph()
p.paragraph_format.space_before = Pt(40)
shade(p, "F4F6F8")
p.paragraph_format.left_indent = Cm(0.4)
run = p.add_run(
    "写给：没写过代码、也不熟悉命令行的人\n"
    "读完你会：知道这个项目在做什么、能自己把它跑起来、"
    "遇到问题知道去哪查、并且清楚每一步背后用到的是什么知识。"
)
run.font.size = Pt(10.5)
run.font.color.rgb = MUTED

doc.add_paragraph().paragraph_format.space_before = Pt(80)
table(
    doc,
    ["项", "内容"],
    [
        ["文档版本", "v1.0"],
        ["写给谁", "项目所有者本人（新手），以及任何第一次接触这个项目的人"],
        ["项目位置", r"D:\Desktop\DSBOT"],
        ["项目现状", "能在 DSH 里建房、看房间列表；让 Bot 干活还在做"],
        ["配套文档", "STATE.md（状态快照）、TASKS.md（任务清单）、需求规格 v1.1"],
    ],
    widths=[4, 12],
    font_size=9.5,
)
# ---------------- 目录 ----------------
h1(doc, "目录")
toc = [
    ("第 1 章", "这个项目到底是什么"),
    ("第 2 章", "最短路径：只想先跑起来（3 步）"),
    ("第 3 章", "名词表：所有术语一次讲清"),
    ("第 4 章", "项目文件夹里都是些什么"),
    ("第 5 章", "完整操作步骤（每一步含：做什么、命令、预期、用到的知识、出问题怎么办）"),
    ("第 6 章", "它内部是怎么工作的（一次建房的完整旅程）"),
    ("第 7 章", "你在这个过程中用到的知识（总表）"),
    ("第 8 章", "常见问题排查"),
    ("第 9 章", "命令速查表"),
    ("第 10 章", "下一步可以学什么"),
]
for num, title in toc:
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(4)
    run = p.add_run(f"{num}　{title}")
    run.font.size = Pt(10.5)
# ---------------- 第 1 章 ----------------
h1(doc, "第 1 章　这个项目到底是什么")

h2(doc, "1.1 用一句话说")
body(
    doc,
    "DSH 是一个装在电脑上的 AI 助手软件。DSHBot 是给它装的一个“扩展”，"
    "装好之后，软件左侧会多出一个「房间」按钮——你可以在里面建一个项目房间，"
    "写下目标，以后还会把几个 AI 助手（叫 Bot）拉进来，让它们分头干活。",
)

h2(doc, "1.2 打个比方")
table(
    doc,
    ["现实里的东西", "在项目里对应什么", "说明"],
    [
        ["一间办公室", "DSH 软件", "提供场地、工具、水电（也就是 AI 能力和文件读写能力）"],
        ["雇来的同事", "Bot", "有名字、有擅长的活，能自己动手做事"],
        ["项目会议室", "房间（Room）", "一个目标、一堆验收标准、几个同事，在这里协作"],
        ["同事的工位和电脑", "工位（Seat）", "每个 Bot 有自己的一块地方，互不干扰"],
        ["贴在墙上的任务卡", "任务卡（Assignment）", "谁负责、做到哪一步了"],
        ["你签字才放行", "审批（Approval）", "危险动作（删文件、花钱）要先问你"],
        ["扩展插座", "插件（Plugin）", "DSHBot 就是插在 DSH 上的一个扩展"],
    ],
    widths=[4.4, 4.2, 7.4],
)

body(
    doc,
    "所以这个项目不是“再做一个 AI”，而是“给现有的 AI 加一套办公流程”："
    "怎么开房间、怎么派活、怎么盯着干、怎么验收。",
)

h2(doc, "1.3 现在做到哪一步了")
table(
    doc,
    ["能力", "现在能用吗", "说明"],
    [
        ["在 DSH 里打开「房间」页面", "✅ 能", "左侧边栏多了一个房子图标"],
        ["建房间（写名称、目标、验收标准）", "✅ 能", "建完会保存到硬盘，重启软件不丢"],
        ["看到房间列表和详情", "✅ 能", "点左边列表切换"],
        ["让 Bot 在房间里回话、干活", "❌ 还不能", "正在做（第 5 章之后会讲卡在哪）"],
        ["审批、交付、成本统计", "❌ 还没开始", "排在后面"],
    ],
    widths=[6.5, 3.4, 6.1],
)

callout(
    doc,
    "为什么要先告诉你“还不能做什么”？",
    "因为新手最容易把“页面能打开”当成“功能做完了”。"
    "现在这个阶段，房间只是个空壳子，真正的重头戏（让 Bot 干活）还在下一段。",
)

# ---------------- 第 2 章 ----------------
h1(doc, "第 2 章　最短路径：只想先跑起来")

body(doc, "如果你现在只想亲眼看到那个房间页面，照这三步做就行（详细解释在第 5 章）：")

h3(doc, "第 1 步　打开 PowerShell")
body(
    doc,
    "按键盘上的 Windows 键，输入 powershell，回车。会出现一个黑底白字的窗口，"
    "这叫“命令行”或者“终端”——就是让电脑执行文字命令的地方。",
)

h3(doc, "第 2 步　粘进这一行，回车")
code(doc, 'cd D:\\Desktop\\DSBOT; pnpm install; pnpm build; pnpm install:profile')
body(
    doc,
    "它会自己下载依赖、编译代码、再把这个扩展装进 DSH。第一次可能要等一两分钟，"
    "中间刷很多行字是正常的。",
)

h3(doc, "第 3 步　完全关掉 DSH，再重新打开")
body(
    doc,
    "注意是“完全退出”，不是关窗口。重新打开后，看左侧边栏，会多一个 🏠 图标，"
    "点它就能看到房间页面。",
)

callout(
    doc,
    "看不到图标？",
    "先确认第 2 步最后有没有出现 “✓ 安装完成”。没有的话，把报错原文发出来；"
    "有的话，多半是没彻底重启（托盘里的图标也要退出）。",
)
# ---------------- 第 3 章 ----------------
h1(doc, "第 3 章　名词表：所有术语一次讲清")

body(
    doc,
    "下面把你会在文档、代码、报错里看到的名词分成了六类。"
    "不需要背，遇到不认识的回来查就行。",
)

h2(doc, "3.1 产品与角色")
table(
    doc,
    ["名词", "大白话解释", "在这个项目里具体指什么"],
    [
        ["DSH / DeepSeek Harness", "一个装在电脑上的 AI 助手软件，本身能读写文件、跑命令", "我们的“宿主”，DSHBot 跑在它里面"],
        ["DSHBot", "给 DSH 加的一个扩展，提供“房间”这套协作能力", "就是我们正在做的项目"],
        ["Bot", "一个 AI 同事，有名字和擅长的活", "以后房间里干活的角色，比如“前端·小柯”"],
        ["房间 / Room", "一个项目和它的成员、对话、任务卡", "页面左侧列表里的每一项"],
        ["工位 / Seat", "Bot 在房间里的一块独立工作区", "避免两个 Bot 互相改乱文件"],
        ["任务卡 / Assignment", "一张写清“谁、做什么、做到哪”的卡片", "以后房间消息流里会出现"],
        ["审批 / Approval", "危险动作执行前要你点头", "比如删文件、装软件、花钱"],
        ["产物 / Artifact", "干完活交出来的东西", "改好的文件、代码差异、报告"],
        ["例行任务 / Routine", "定时自动跑的任务", "比如每天早上抓竞品更新"],
    ],
    widths=[3.6, 6.2, 6.2],
)

h2(doc, "3.2 开发工具")
table(
    doc,
    ["名词", "大白话解释", "为什么这个项目需要它"],
    [
        ["命令行 / 终端 / PowerShell", "用打字的方式命令电脑", "装东西、编译、启动都靠它"],
        ["Node.js", "让 JavaScript 能在电脑上（而不只是网页里）运行的程序", "插件和命令行工具都跑在它上面"],
        ["npm", "Node 自带的“软件商店”客户端", "下载别人写好的代码包"],
        ["pnpm", "比 npm 更快、更省空间的同类工具", "本项目统一用它装依赖"],
        ["Git", "给文件拍快照的工具，能回退、能看每次改了什么", "每完成一步就存一次档"],
        ["Git 仓库 / repo", "被 Git 管理的那个文件夹", "D:\\Desktop\\DSBOT"],
        ["提交 / commit", "给当前状态存一次档，并写一句说明", "我们已经存了 9 次"],
        ["TypeScript（TS）", "给 JavaScript 加上“类型检查”的版本，写错会提前报错", "项目主要语言"],
        ["esbuild", "打包工具，把很多源文件压成一个能直接运行的文件", "生成插件产物"],
    ],
    widths=[4.2, 6.4, 5.4],
)

h2(doc, "3.3 DSH 自己的概念（重点，容易懵）")
table(
    doc,
    ["名词", "大白话解释", "类比"],
    [
        ["插件 / Plugin", "一段能被 DSH 加载的扩展代码", "手机上的一个 App"],
        ["profile（配置档）", "一套“装哪些插件、怎么配置”的组合", "电脑上的一个用户账户配置"],
        ["desktop / web / headless", "三种 profile：桌面版、浏览器版、纯命令行版", "同一套软件的不同用法"],
        ["cordis", "DSH 内部用来组织插件的框架", "插座的底座"],
        ["插槽 / slot", "页面上预留的位置，插件往里放东西", "墙上的画框，画由你换"],
        ["main 插槽", "整个中间大区域", "一整面墙"],
        ["sidebar.panellist 插槽", "左侧边栏的图标列表", "门牌号列表"],
        ["bundle / 打包产物", "编译后生成的可直接加载的文件", "做好的家具，不是木板"],
        ["Loader 条目", "配置里的一行，告诉 DSH“要加载哪个插件”", "点名册上的一行"],
    ],
    widths=[4.2, 6.4, 5.4],
)

h2(doc, "3.4 文件与格式")
table(
    doc,
    ["名词", "大白话解释", "会在哪见到"],
    [
        ["package.json", "一个包的“身份证 + 配料表”", "每个代码包里都有"],
        ["JSON", "一种有固定格式的文本，给程序读的", "数据文件、接口返回"],
        ["YAML", "另一种给人读的配置格式，靠缩进分层", "cordis.patch.yml"],
        ["TS / TSX", "TypeScript 源码；带 X 的表示里面写了界面", "packages/**/src"],
        ["ESM / CJS", "JavaScript 两种不同的模块写法", "构建时会碰到，报错里常见"],
        ["Markdown（.md）", "纯文本的排版格式，用 # 表示标题", "项目里所有文档"],
    ],
    widths=[3.6, 7.4, 5.0],
)

h2(doc, "3.5 网络与通信")
table(
    doc,
    ["名词", "大白话解释", "在项目里怎么用"],
    [
        ["HTTP", "浏览器和程序之间说话的方式", "房间页和插件后台靠它通信"],
        ["路由 / route", "一条“地址 → 处理函数”的对应关系", "比如 /dshbot/api/rooms"],
        ["GET / POST", "两种请求：取数据 / 交数据", "列房间用 GET，建房用 POST"],
        ["localhost / 127.0.0.1", "指“这台电脑自己”", "DSH 只在本机开端口"],
        ["端口 / port", "一台电脑上区分不同服务的编号", "开发实例用 54873"],
        ["token", "一串临时通行证", "打开 DSH 页面时地址里那串"],
        ["状态码", "服务器回的三位数字，200 正常、400 你发错了、500 它坏了", "调试时看这个"],
    ],
    widths=[3.8, 7.0, 5.2],
)

h2(doc, "3.6 工程实践")
table(
    doc,
    ["名词", "大白话解释", "为什么存在"],
    [
        ["依赖 / dependency", "你的代码要用到的别人写的代码", "不用从零造轮子"],
        ["锁文件 / lockfile", "记下“每个依赖具体用哪个版本”", "换台电脑也能装出一样的"],
        ["构建 / build", "把源码加工成能运行的东西", "浏览器不认识 TS，得先翻译"],
        ["类型检查 / typecheck", "只检查不产出，专门找低级错误", "比运行到一半才崩好"],
        ["monorepo", "一个仓库里放多个包", "core / plugin / cli 三个包同仓库"],
        ["软链接 / junction", "一个指向别处的“快捷方式”", "让 DSH 直接用我们最新的代码"],
        ["环境变量 / PATH", "系统里存的一组配置；PATH 决定“输入命令时去哪找程序”", "找不到 dsh 命令就是它的问题"],
        ["权限 / 沙箱", "限制程序能碰哪些文件", "防止 AI 乱改你的电脑"],
    ],
    widths=[4.0, 6.6, 5.4],
)
# ---------------- 第 4 章 ----------------
h1(doc, "第 4 章　项目文件夹里都是些什么")

body(doc, "打开 D:\\Desktop\\DSBOT，你会看到下面这些。先认识主干，细节可以慢慢看。")

code(
    doc,
    "D:\\Desktop\\DSBOT\n"
    "├─ packages\\          三个代码包（本项目的主体）\n"
    "│  ├─ core\\            纯逻辑：房间、Bot、消息这些“概念”的定义\n"
    "│  ├─ plugin\\          DSH 插件本体：后台接口 + 房间页面\n"
    "│  └─ cli\\             命令行工具（骨架，还没接真数据）\n"
    "├─ scripts\\\n"
    "│  └─ install.mjs      一键：编译 + 装进 DSH\n"
    "├─ spike\\             试验记录与取证工具（截图、冒烟脚本）\n"
    "├─ docs-src\\           生成文档的脚本\n"
    "├─ package.json        整个仓库的“总配置”\n"
    "├─ pnpm-workspace.yaml 告诉 pnpm：packages 下面都是我的包\n"
    "├─ STATE.md            项目状态快照（接手先看这个）\n"
    "├─ TASKS.md            任务清单\n"
    "└─ 需求规格 v1.1.md    产品需求",
)

h2(doc, "4.1 三个包分别管什么")
table(
    doc,
    ["包", "管什么", "打个比方"],
    [
        ["packages/core", "定义“房间长什么样、消息有哪几种”这类纯概念，不含界面也不含网络", "图纸和标准"],
        ["packages/plugin", "真正的插件：后台接口 + 房间页面", "盖出来的房子"],
        ["packages/cli", "命令行工具，计划用来不开界面也能建房", "遥控器"],
    ],
    widths=[4.4, 8.6, 3.0],
)

body(
    doc,
    "为什么要分成三个包？因为“概念”可以同时被界面、命令行、将来的网页版复用，"
    "改一处就都改了。这种组织方式叫 monorepo（单仓库多包）。",
)

h2(doc, "4.2 插件包里最关键的四个文件")
table(
    doc,
    ["文件", "作用", "如果它坏了会怎样"],
    [
        ["src/index.ts", "插件入口：告诉 DSH 我要哪些能力，然后把接口挂上去", "插件加载不起来，侧栏没图标"],
        ["src/host/api.ts", "后台接口：列房间、建房间", "页面能开，但列表是空的 / 建房报错"],
        ["src/client/page.tsx", "房间页面长什么样、点了按钮发生什么", "页面白屏或样式错乱"],
        ["build.mjs", "把上面这些源码加工成 DSH 能加载的两个文件", "装进去也没反应"],
    ],
    widths=[4.2, 7.4, 4.4],
)
# ---------------- 第 5 章 ----------------
h1(doc, "第 5 章　完整操作步骤")

body(
    doc,
    "这一章是“照着做”的部分。每一步都按同样的顺序写：做什么 → 命令 → 预期看到什么 → "
    "用到什么知识 → 出问题怎么办。",
)

# Step 0
h2(doc, "第 0 步　确认环境（只做一次）")
h3(doc, "要做什么")
body(doc, "确认电脑上已经装好了三样东西：Git、Node.js、pnpm。本项目开发机已经装过，换电脑才需要重来。")
h3(doc, "命令")
code(doc, "git --version\nnode --version\npnpm --version")
h3(doc, "预期看到什么")
body(doc, "三行版本号，类似 git version 2.56.0、v24.22.2、11.28.5。只要不是“无法识别”就算成功。")
h3(doc, "用到什么知识")
bullets(
    doc,
    [
        "命令行：让电脑执行文字命令，而不是点鼠标。",
        "PATH 环境变量：输入 git 时，系统会去 PATH 列出的文件夹里找叫 git 的程序。找不到就报“无法识别”。",
        "版本管理 / Git：记录每次改动，出问题能回退。",
        "运行时 / Node.js：让 JavaScript 在电脑上跑起来。",
        "包管理器 / pnpm：负责下载别人写好的代码包。",
    ],
)
h3(doc, "出问题怎么办")
body(
    doc,
    "如果提示“无法将 git 项识别为 cmdlet”，说明这个终端窗口是装软件之前打开的，"
    "它不知道新装的程序。开一个新的 PowerShell 窗口即可。",
)

# Step 1
h2(doc, "第 1 步　进入项目目录")
h3(doc, "命令")
code(doc, "cd D:\\Desktop\\DSBOT")
h3(doc, "预期看到什么")
body(doc, "命令提示符前面的路径变成 D:\\Desktop\\DSBOT。可以输入 dir 回车，看看文件列表对不对。")
h3(doc, "用到什么知识")
bullets(
    doc,
    [
        "目录 / 路径：Windows 用反斜杠分隔文件夹。",
        "cd（change directory）：切换当前所在目录。后面所有命令都是“在哪个目录下执行”的，搞错了就找不到文件。",
    ],
)

# Step 2
h2(doc, "第 2 步　安装依赖")
h3(doc, "命令")
code(doc, "pnpm install")
h3(doc, "预期看到什么")
body(
    doc,
    "出现 “Packages: +N” 和 “Done in …”，最后多出一个 node_modules 文件夹。"
    "这个文件夹很大、文件很多，是正常的——它就是“别人写好的代码”的仓库。",
)
h3(doc, "用到什么知识")
bullets(
    doc,
    [
        "依赖（dependency）：你的代码要用别人的代码。比如页面用到的 React，就是别人写好的。",
        "package.json：每个包里的“配料表”，写着需要哪些依赖。",
        "锁文件 pnpm-lock.yaml：记下每个依赖的确切版本，保证下次装出来一模一样。",
        "node_modules：依赖实际被放到的地方，不需要提交到 Git（所以被 .gitignore 忽略了）。",
    ],
)
h3(doc, "出问题怎么办")
body(
    doc,
    "如果卡在下载很久，是网络问题。本项目所在网络访问 GitHub 不稳定，"
    "但 npm 官方源是通的，通常重试一次就好。",
)

# Step 3
h2(doc, "第 3 步　构建（把源码变成能运行的东西）")
h3(doc, "命令")
code(doc, "pnpm build")
h3(doc, "预期看到什么")
body(
    doc,
    "类似 “built @dshbot/plugin: lib/index.js + lib/client.js” 的两行。"
    "此时 packages\\plugin\\lib 目录下会多出两个 .js 文件。",
)
h3(doc, "用到什么知识")
bullets(
    doc,
    [
        "编译 / 构建：电脑看不懂 TypeScript，得先翻译成 JavaScript。",
        "打包（esbuild）：把十几个源文件压成两个文件，方便加载。",
        "external（外部依赖）：React 这类库不打包进去，运行时直接借 DSH 自带的那一份——"
        "否则页面里会有两份 React，直接崩。",
        "模块格式 ESM / CJS：两种不同的“代码怎么互相引用”的写法，打包工具负责转换。",
    ],
)
h3(doc, "出问题怎么办")
body(
    doc,
    "报错里出现 TS 开头的一串（比如 TS2769），说明是类型检查没通过，代码写错了，"
    "不是环境问题。把完整报错贴出来即可。",
)

# Step 4
h2(doc, "第 4 步　类型检查（可选，但建议每次做完都跑）")
h3(doc, "命令")
code(doc, "pnpm typecheck")
h3(doc, "预期看到什么")
body(doc, "三个包各自 “Done”，没有 error 字样。")
h3(doc, "用到什么知识")
bullets(
    doc,
    [
        "静态检查：不运行程序，只检查代码有没有明显错误（比如把文字当数字用）。",
        "TypeScript 类型：给数据贴上“这是文字 / 这是数字”的标签，贴错了提前报错。",
    ],
)

# Step 5
h2(doc, "第 5 步　装进 DSH")
h3(doc, "命令")
code(doc, "pnpm install:profile")
h3(doc, "预期看到什么")
body(
    doc,
    "最后一段是“✓ 安装完成”，并列出 profile、包、补丁三个路径。"
    "它内部做了四件事：构建 → 类型检查 → 把包软链接进配置档 → 往配置文件里写一段加载说明。",
)
h3(doc, "用到什么知识")
bullets(
    doc,
    [
        "profile（配置档）：DSH 用“配置档”来区分不同用法，你的桌面版用的是 desktop。",
        "软链接（junction）：不是把文件复制过去，而是放一个“快捷方式”指向项目目录，"
        "所以以后改了代码、重新构建，DSH 用的就是最新版。",
        "配置文件（YAML）：cordis.patch.yml 里那段被注释包围的内容，是脚本自动维护的，不要手改。",
        "幂等：这个命令跑多少遍结果都一样，不会重复装、不会写乱配置。",
    ],
)
h3(doc, "出问题怎么办")
body(
    doc,
    "看到 “⚠ 补丁层里已有裸的 id” 说明配置文件里有人手写过同名条目，会冲突。"
    "按提示删掉手写那段再跑一次。",
)

# Step 6
h2(doc, "第 6 步　重启 DSH")
h3(doc, "要做什么")
body(doc, "完全退出 DSH（包括右下角托盘图标），再重新打开。仅仅关掉窗口不算。")
h3(doc, "为什么必须重启")
body(
    doc,
    "DSH 是在启动时读一遍配置、决定要加载哪些插件的。配置改了不重启，它不会重新读。"
    "这就像改了菜单但没重新打印，客人手里还是旧菜单。",
)
h3(doc, "预期看到什么")
body(doc, "左侧边栏出现 🏠 图标，点开是三栏页面：左边房间列表、中间内容、右边成员。")
h3(doc, "用到什么知识")
bullets(
    doc,
    [
        "启动时装配：很多程序在启动时读配置并固定下来，运行中改配置不生效。",
        "插件加载顺序：DSH 会先加载基础能力，再加载插件，插件才能用到那些能力。",
    ],
)

# Step 7
h2(doc, "第 7 步　建第一个房间")
h3(doc, "要做什么")
body(
    doc,
    "点「＋ 新建房间」，填三样：名称（比如“改造登录页”）、目标（一句话说清要什么）、"
    "验收标准（一行一条，至少一条）。点「创建」。",
)
h3(doc, "预期看到什么")
body(doc, "左边列表出现新房间并自动选中，中间显示目标与验收条目。关掉 DSH 再打开，它还在。")
h3(doc, "用到什么知识")
bullets(
    doc,
    [
        "表单与受控组件：输入框里的字存在内存里，点按钮时一起提交。",
        "HTTP POST：把数据“交上去”。服务器回 201 表示“创建成功”。",
        "JSON 文件存储：数据被写成一个文本文件，位置在 C:\\Users\\你的用户名\\.dsh\\dshbot\\rooms.json。",
        "原子写入：先写临时文件再改名，避免断电时写坏一半。",
        "校验：名称为空、验收标准为空都会被拒绝（返回 400），这是防止垃圾数据。",
    ],
)

callout(
    doc,
    "想亲眼看看数据长什么样？",
    "用记事本打开 C:\\Users\\你的用户名\\.dsh\\dshbot\\rooms.json，"
    "你会看到自己刚建的房间以 JSON 格式躺在里面——这就是“数据库”最朴素的样子。",
)
# ---------------- 第 6 章 ----------------
h1(doc, "第 6 章　它内部是怎么工作的")

body(doc, "这一章不要求你会写代码，但看懂之后，出问题时你就知道该往哪儿找。")

h2(doc, "6.1 三层结构")
table(
    doc,
    ["层", "负责什么", "具体在哪"],
    [
        ["界面层（前端）", "画页面、接收你的点击和输入", "浏览器里运行的 React 代码"],
        ["接口层（后端）", "接收请求、检查数据、读写文件", "DSH 进程里的插件代码"],
        ["数据层", "把数据存在硬盘上", "一个 JSON 文件"],
    ],
    widths=[4.0, 7.0, 5.0],
)

h2(doc, "6.2 一次“建房”的完整旅程")
body(doc, "你在页面上点“创建”之后，发生了这些事：")
bullets(
    doc,
    [
        "① 页面收集三个输入框的内容，拼成一段 JSON。",
        "② 浏览器向 dshbot/api/rooms 发一个 POST 请求，把 JSON 带上。",
        "③ DSH 内部把请求转给我们的插件（因为插件启动时“认领”了这个地址）。",
        "④ 插件检查：名称有没有、目标有没有、验收标准是不是空的。不合格就回 400。",
        "⑤ 合格就生成一个房间对象（带唯一编号和时间），读出现有房间列表，插到最前面。",
        "⑥ 写回 JSON 文件（先写临时文件，再改名覆盖）。",
        "⑦ 回一个 201，把新房间原样返回。",
        "⑧ 页面收到后把它加进左边的列表，并自动选中。",
    ],
)

body(
    doc,
    "这里有个新手容易忽略的细节：页面里写的地址是 dshbot/api/rooms，"
    "前面没有斜杠。这是故意的——桌面版 DSH 不是用 http:// 打开页面，"
    "而是用一个自定义地址，相对写法在两种情况下都能正确解析。",
)

h2(doc, "6.3 为什么“让 Bot 干活”这么难")
body(
    doc,
    "你可能会想：页面都有了，让 Bot 说句话不是很简单吗？实际上它卡在一个很具体的地方，"
    "我用大白话解释一下：",
)
bullets(
    doc,
    [
        "Bot 干活需要“一套身份和规则”，DSH 管这个叫 Agent preset（预置配置）。",
        "我们的插件能创建出一个 Bot，也能把话递进去，但没给它这套预置配置。",
        "结果就是 Bot 一启动就发现“我不知道我是谁、我用什么模型”，立刻报错退出。",
        "DSH 的界面本来有现成的创建方式，但那个方法在插件里拿不到——这就是现在要解决的问题。",
    ],
)
body(
    doc,
    "这段技术细节记在 spike/m0-3-notes.md 里。你不需要看懂，"
    "只需要知道：**不是做不出来，是还没接对那根线**。",
)
# ---------------- 第 7 章 ----------------
h1(doc, "第 7 章　你在这个过程中用到的知识（总表）")

body(
    doc,
    "这张表是整份文档的“知识地图”。左边是知识，中间是它在这个项目里的具体落点，"
    "右边是它大概有多难（★ 越多越难）。",
)

table(
    doc,
    ["知识", "在本项目里对应什么", "一句话解释", "难度"],
    [
        ["命令行操作", "cd、pnpm、git 这些命令", "用打字代替点鼠标来操作电脑", "★"],
        ["环境变量 PATH", "为什么装了软件还要重开窗口", "系统找程序的“搜索路径”", "★"],
        ["Git 版本控制", "9 次提交、每次改动可回退", "给文件拍快照并写说明", "★★"],
        ["Node.js 运行时", "插件和命令行工具跑在它上面", "让 JavaScript 离开浏览器也能运行", "★★"],
        ["包管理与依赖", "pnpm install、node_modules", "自动下载别人写好的代码", "★★"],
        ["模块化 / monorepo", "core / plugin / cli 三个包", "把大项目拆成小包，各管一摊", "★★★"],
        ["TypeScript 类型", "pnpm typecheck 报的那些 TS 错误", "给数据贴标签，贴错提前报警", "★★★"],
        ["构建与打包", "pnpm build 生成的 lib/*.js", "把源码加工成能直接运行的文件", "★★★"],
        ["React 组件", "房间页面的三栏、按钮、表单", "把界面拆成一个个可复用的零件", "★★★"],
        ["HTTP 与接口设计", "/dshbot/api/rooms、GET/POST、状态码", "前后台之间约定好的说话方式", "★★★"],
        ["JSON 与文件存储", "rooms.json", "一种程序友好的文本格式；最朴素的数据库", "★★"],
        ["插件架构", "为什么要有 main 插槽、sidebar 入口", "宿主预留位置，扩展往里填内容", "★★★★"],
        ["软链接", "link: 安装，改代码立刻生效", "指向别处的快捷方式", "★★★"],
        ["进程与会话", "为什么不能另起一个程序跑 Bot", "程序运行的实例；会话是它的一段上下文", "★★★★"],
        ["权限与沙箱", "AI 只能改指定文件夹", "给程序划活动范围，越界就拦住", "★★★★"],
        ["调试方法", "看日志、打接口、无头浏览器截图", "用各种手段定位问题出在哪一层", "★★★★"],
    ],
    widths=[3.6, 6.2, 5.4, 1.6],
    font_size=8.5,
)

h2(doc, "7.1 如果只学三样，学哪三样")
bullets(
    doc,
    [
        "**命令行**：这是所有操作的入口，学会 cd、看报错、复制粘贴命令，就能用起这个项目。",
        "**Git**：改坏了能回退，是新手的安全网。先学 status / add / commit / log 四个就够。",
        "**HTTP 与 JSON**：理解“页面把数据发给后台、后台存成文件”，你就懂了整个项目的骨架。",
    ],
)
# ---------------- 第 8 章 ----------------
h1(doc, "第 8 章　常见问题排查")

body(doc, "按“看到什么 → 为什么 → 怎么办”的顺序查。")

table(
    doc,
    ["你会看到", "为什么会这样", "怎么办"],
    [
        [
            "「无法将 xxx 项识别为 cmdlet」",
            "这个终端窗口是装软件之前打开的，不认识新命令",
            "关掉窗口重新开一个；或先执行刷新 PATH 的命令",
        ],
        [
            "侧栏没有 🏠 图标",
            "没彻底重启；或安装那一步失败了",
            "确认安装输出有“✓ 安装完成”，再完全退出 DSH（含托盘）重开",
        ],
        [
            "页面能开，但显示“读取房间失败”",
            "后台接口没挂上（插件没加载成功）",
            "看 DSH 日志里有没有 [dshbot] host side loaded 这一行",
        ],
        [
            "建房点创建没反应",
            "三个输入框有空的，按钮是灰的",
            "名称、目标、验收标准都要填，验收标准至少一条",
        ],
        [
            "改完代码没变化",
            "改了没构建，或构建了没重启",
            "先 pnpm build，再重启 DSH",
        ],
        [
            "端口被占用（开发实例启动失败）",
            "上一次的实例没关干净",
            "关掉占用进程，或换一个端口号",
        ],
        [
            "JSON 文件报错「Unexpected token」",
            "文件开头多了看不见的 BOM 标记",
            "用不带 BOM 的方式保存（脚本写文件时指定 UTF-8 无 BOM）",
        ],
        [
            "配置文件报「patch: entry xxx not found」",
            "手写配置时直接加了条目",
            "新增条目必须写在 - insert: 下面",
        ],
    ],
    widths=[5.4, 6.2, 5.2],
    font_size=8.5,
)

# ---------------- 第 9 章 ----------------
h1(doc, "第 9 章　命令速查表")

table(
    doc,
    ["你想做的事", "命令", "说明"],
    [
        ["进入项目目录", "cd D:\\Desktop\\DSBOT", "每次新开窗口都要先做"],
        ["装依赖", "pnpm install", "换电脑或依赖变了才需要"],
        ["编译", "pnpm build", "改完代码必做"],
        ["只检查错误", "pnpm typecheck", "不产出文件，快"],
        ["装进 DSH", "pnpm install:profile", "编译 + 检查 + 安装一条龙"],
        ["看改了哪些文件", "git status", "养成提交前看一眼的习惯"],
        ["存一次档", 'git add -A; git commit -m "说明"', "每完成一小步就存"],
        ["看存档历史", "git log --oneline", "出问题能找回旧版本"],
        ["撤销没存盘的改动", "git restore .", "⚠ 会丢掉未提交的修改"],
        ["起一个开发实例", "dsh --profile dshbot-dev --port 54873 --no-open", "不影响桌面端，调试用"],
        ["看数据文件", "notepad %USERPROFILE%\\.dsh\\dshbot\\rooms.json", "亲眼看看存了什么"],
    ],
    widths=[5.0, 7.2, 4.6],
    font_size=8.5,
)

# ---------------- 第 10 章 ----------------
h1(doc, "第 10 章　下一步可以学什么")

body(doc, "按“马上能用上”的顺序排，不用全学：")

table(
    doc,
    ["顺序", "学什么", "大概花多久", "学完能干什么"],
    [
        ["1", "命令行基础（cd、dir、复制路径、看报错）", "1 小时", "不再怕黑窗口"],
        ["2", "Git 四件套（status / add / commit / log）", "1 小时", "敢改代码了，坏了能退"],
        ["3", "JavaScript 基础语法（变量、函数、数组）", "1 周", "看得懂代码在干嘛"],
        ["4", "HTTP 与 JSON（用浏览器开发者工具看请求）", "2 小时", "知道页面和后台怎么说话"],
        ["5", "React 入门（组件、状态）", "1 周", "能改页面上的东西"],
        ["6", "TypeScript 类型", "3 天", "看得懂那些 TS 报错"],
        ["7", "Node.js 与服务端基础", "1 周", "能自己加一个接口"],
    ],
    widths=[1.4, 7.0, 3.0, 5.4],
    font_size=8.5,
)

callout(
    doc,
    "别一上来就学第 5 项。",
    "先能把项目跑起来、能用 Git 存档，比看得懂 React 更有用。"
    "你现在的角色是“项目负责人”，不是“程序员”——知道每部分干什么、出问题找谁，就足够了。",
)

# ---------------- 附录 ----------------
h1(doc, "附录　项目文档都在哪")

table(
    doc,
    ["文件", "写给谁看", "内容"],
    [
        ["STATE.md", "接手项目的人", "当前状态、卡点、恢复步骤——**最先看这个**"],
        ["TASKS.md", "排期用", "每个任务的验收标准和状态"],
        ["需求规格 v1.1.md", "产品视角", "房间模型、Bot 工位、审批、里程碑"],
        ["INSTALL.md", "要装给别人用的人", "安装步骤与排错"],
        ["ENVIRONMENT.md", "换电脑时", "这台机器装了什么、装在哪"],
        ["T2-验证报告.md", "想了解插件机制的人", "插件页面注册的取证"],
        ["spike/x1-findings.md", "同上", "为什么不能另起进程跑 Bot"],
        ["spike/m0-3-notes.md", "同上", "Bot 执行卡在哪"],
    ],
    widths=[5.0, 4.6, 7.4],
    font_size=8.5,
)

doc.save(r"D:\Desktop\DSBOT\DSHBot新手指南.docx")

# 自检：重新打开确认内容在
check = Document(r"D:\Desktop\DSBOT\DSHBot新手指南.docx")
print("段落数:", len(check.paragraphs))
print("表格数:", len(check.tables))
print("标题:", [p.text for p in check.paragraphs if p.style.name.startswith("Heading 1")][:12])
