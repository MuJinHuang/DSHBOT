"""把 UI 冒烟帧拼成 README 的 demo GIF。

用法：
  pnpm smoke:ui                 # 先跑出 spike/smoke-1..4.png
  python scripts/make-demo-gif.py

不引入 Pillow 以外的依赖；GIF 输出到 docs/assets/demo.gif。
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
FRAMES = [ROOT / "spike" / f"smoke-{index}-{name}.png" for index, name in [
    (1, "empty"),
    (2, "room"),
    (3, "search"),
    (4, "library"),
]]
OUT = ROOT / "docs" / "assets" / "demo.gif"

images = []
for path in FRAMES:
    if not path.exists():
        raise SystemExit(f"缺少 {path}，先跑 pnpm smoke:ui")
    image = Image.open(path).convert("RGB")
    # 去掉左侧 Dock 空白，保留房间内容；统一缩到 1100 宽，控制 GIF 体积
    image = image.crop((264, 0, image.width, image.height))
    width = 1100
    height = round(image.height * width / image.width)
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    images.append(image.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))

OUT.parent.mkdir(parents=True, exist_ok=True)
images[0].save(
    OUT,
    save_all=True,
    append_images=images[1:],
    duration=1800,
    loop=0,
    optimize=True,
    disposal=2,
)
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KiB)")
