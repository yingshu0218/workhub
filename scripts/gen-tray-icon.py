#!/usr/bin/env python3
"""生成 macOS 菜单栏用的**单色模板**托盘图标。

## 为什么要单独生成一张图标
菜单栏（NSStatusBar）上的图标必须是 **template image**：macOS 只读取它的 alpha 通道，
再按当前明暗主题渲染成白色或黑色。直接把彩色应用图标塞进菜单栏，会得到一块有色方块 ——
和系统与其它应用的图标风格完全不一致。

## 素材与做法
字形取自 `public/favicon.svg` 的两条 path（白色主体 + 绿色叶子），它们合起来就是这个
「芽 / 鸽」mark。这里**不引第三方 SVG 渲染库**，而是把 path 的贝塞尔控制点手工展平后
用 Pillow 多边形填充：
  - 零依赖（只需要 Pillow）
  - 颜色与尺寸完全可控（透明底 + 纯黑字形）
  - 超采样 4× 再降采样，得到平滑边缘

若 favicon.svg 的字形被改动，本脚本会因遇到未支持的命令而**直接报错退出**，
而不是安静地生成一张过时的图标。

用法：
    python3 scripts/gen-tray-icon.py [输出尺寸，默认 22]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

# ── 字形来源：public/favicon.svg 的两条 path（viewBox 0 0 32 32）────────────────
GLYPH_PATHS = [
    # 主体（白）
    "M8 10c4 0 7 2.5 8 5.5C17 12.5 20 10 24 10c-1 4.5-4 7.5-8 8.5v4.5h-4v-4.5"
    "C8 17.5 5 14.5 4 10c1.4 0 2.7.2 4 .6z",
    # 叶子（绿）
    "M16 15.5c1-3 4-5.5 8-5.5-1 4.5-4 7.5-8 8.5z",
]

VIEWBOX = 32.0
# 菜单栏图标的常规视觉尺寸：字形宽约占画布 20/22，四周留一点呼吸
GLYPH_WIDTH_RATIO = 20.0 / 22.0
SUPERSAMPLE = 4

NUM_RE = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
CMD_RE = re.compile(r"([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)")

# 各命令的参数个数（用于处理「隐式重复」：一个字母后面跟多组参数）
ARITY = {"M": 2, "L": 2, "H": 1, "V": 1, "C": 6, "S": 4, "Q": 4, "T": 2, "A": 7, "Z": 0}


def _cubic(p0, p1, p2, p3, steps=28):
    """把一段三次贝塞尔展平成折线点。"""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def parse_path(d: str):
    """把 path 解析成若干条闭合折线（只支持这两条 path 用到的命令）。"""
    subpaths: list[list[tuple[float, float]]] = []
    cur: list[tuple[float, float]] = []
    start = (0.0, 0.0)
    pos = (0.0, 0.0)

    for cmd, argstr in CMD_RE.findall(d):
        args = [float(v) for v in NUM_RE.findall(argstr)]
        upper = cmd.upper()
        relative = cmd.islower()
        arity = ARITY[upper]

        if upper not in ("M", "L", "H", "V", "C", "Z"):
            raise SystemExit(
                f"[gen-tray-icon] 遇到未支持的 SVG 命令 {cmd!r} —— "
                "favicon.svg 的字形已改动，请同步更新 scripts/gen-tray-icon.py"
            )

        if upper == "Z":
            if cur:
                cur.append(start)
                subpaths.append(cur)
                cur = []
                pos = start
            continue

        if arity == 0:
            continue

        # 隐式重复：一个字母后面可以跟多组参数
        groups = [args[i : i + arity] for i in range(0, len(args), arity)]
        for gi, g in enumerate(groups):
            this = "M" if (upper == "M" and gi == 0) else ("L" if upper == "M" else upper)

            if this == "M":
                x, y = g
                pos = (pos[0] + x, pos[1] + y) if relative else (x, y)
                if cur:
                    subpaths.append(cur)
                cur = [pos]
                start = pos
            elif this == "L":
                x, y = g
                pos = (pos[0] + x, pos[1] + y) if relative else (x, y)
                cur.append(pos)
            elif this == "H":
                (x,) = g
                pos = (pos[0] + x, pos[1]) if relative else (x, pos[1])
                cur.append(pos)
            elif this == "V":
                (y,) = g
                pos = (pos[0], pos[1] + y) if relative else (pos[0], y)
                cur.append(pos)
            elif this == "C":
                x1, y1, x2, y2, x, y = g
                if relative:
                    p1 = (pos[0] + x1, pos[1] + y1)
                    p2 = (pos[0] + x2, pos[1] + y2)
                    p3 = (pos[0] + x, pos[1] + y)
                else:
                    p1, p2, p3 = (x1, y1), (x2, y2), (x, y)
                cur.extend(_cubic(pos, p1, p2, p3))
                pos = p3

    if cur:
        subpaths.append(cur)
    return subpaths


def main() -> int:
    size = int(sys.argv[1]) if len(sys.argv) > 1 else 22
    subpaths = [sp for d in GLYPH_PATHS for sp in parse_path(d)]

    xs = [p[0] for sp in subpaths for p in sp]
    ys = [p[1] for sp in subpaths for p in sp]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    w, h = x1 - x0, y1 - y0

    canvas = size * SUPERSAMPLE
    target_w = canvas * GLYPH_WIDTH_RATIO
    scale = target_w / w
    scaled_w, scaled_h = w * scale, h * scale
    off_x = (canvas - scaled_w) / 2
    off_y = (canvas - scaled_h) / 2

    img = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for sp in subpaths:
        pts = [
            (off_x + (px - x0) * scale, off_y + (py - y0) * scale)
            for px, py in sp
        ]
        # 纯黑 + 不透明：template image 由 macOS 只取 alpha 再按主题着色
        draw.polygon(pts, fill=(0, 0, 0, 255))

    img = img.resize((size, size), Image.LANCZOS)

    out = Path(__file__).resolve().parent.parent / "src-tauri" / "icons" / "tray-icon.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    img.save(out, "PNG")
    print(f"已生成 {out.relative_to(out.parent.parent.parent)}  ({size}x{size}, 字形 {scaled_w:.1f}x{scaled_h:.1f} @超采样{SUPERSAMPLE}x)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
