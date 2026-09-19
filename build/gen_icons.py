"""生成番茄钟精致图标(v2):渐变立体番茄 + 高光 + 投影 + 绿叶。
v0.3.9.4 森哥要求图标升级。用 PIL 程序生成,无外部素材依赖。
渲染策略:大尺寸(512)绘制抗锯齿,再缩放到目标尺寸,边缘平滑。
"""
from PIL import Image, ImageDraw, ImageFilter

# 朱砂红主色(oklch(0.62 0.19 28) ≈ #D9472E)及其亮/暗变体
RED_LIGHT = (255, 120, 90)     # 高光处偏暖亮
RED = (217, 71, 46)            # 主色
RED_DARK = (165, 40, 25)       # 暗部
GREEN = (95, 165, 90)          # 番茄叶绿
GREEN_DARK = (60, 120, 55)     # 叶子暗部
WHITE = (255, 255, 255, 255)
TRANSPARENT = (0, 0, 0, 0)


def lerp_color(c1, c2, t):
    """线性插值两个 RGB 颜色"""
    return tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(min(len(c1), len(c2))))


def make_app_icon(size=512):
    """应用图标:立体番茄(渐变+高光+投影+绿叶)"""
    s = size
    # 用 4 倍超采样渲染再缩放,抗锯齿
    ss = s * 4
    img = Image.new('RGBA', (ss, ss), TRANSPARENT)
    d = ImageDraw.Draw(img)

    cx, cy = ss // 2, int(ss * 0.54)   # 番茄中心略偏下(给叶子留空间)
    body_r = int(ss * 0.34)            # 番茄主体半径

    # 1. 投影(番茄下方,模糊椭圆)
    shadow_layer = Image.new('RGBA', (ss, ss), TRANSPARENT)
    sd = ImageDraw.Draw(shadow_layer)
    sh_y = cy + body_r + int(ss * 0.04)
    sd.ellipse([cx - body_r * 0.85, sh_y - int(ss * 0.03),
                cx + body_r * 0.85, sh_y + int(ss * 0.06)],
               fill=(60, 20, 15, 90))
    shadow_layer = shadow_layer.filter(ImageFilter.GaussianBlur(ss * 0.025))
    img = Image.alpha_composite(img, shadow_layer)
    d = ImageDraw.Draw(img)

    # 2. 番茄主体:径向渐变(左上亮→右下暗),逐圈绘制
    # 用很多同心椭圆模拟径向渐变,偏移让光源感来自左上
    light_off = int(body_r * 0.25)   # 高光偏移(左上)
    steps = 40
    for i in range(steps, 0, -1):
        t = i / steps                 # 0(中心)→1(边缘)
        r = int(body_r * t)
        # 颜色:中心偏亮(RED_LIGHT),边缘偏暗(RED_DARK)
        col = lerp_color(RED_LIGHT, RED_DARK, t ** 1.2)
        # 椭圆中心向左上偏移(模拟光源)
        ex = cx - int(light_off * (1 - t))
        ey = cy - int(light_off * (1 - t))
        d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=col + (255,))

    # 3. 高光(左上角亮斑,模拟镜面反射)
    hl_layer = Image.new('RGBA', (ss, ss), TRANSPARENT)
    hd = ImageDraw.Draw(hl_layer)
    hl_cx = cx - int(body_r * 0.42)
    hl_cy = cy - int(body_r * 0.42)
    hl_r = int(body_r * 0.32)
    hd.ellipse([hl_cx - hl_r, hl_cy - hl_r, hl_cx + hl_r, hl_cy + hl_r],
               fill=(255, 220, 200, 130))
    hl_layer = hl_layer.filter(ImageFilter.GaussianBlur(ss * 0.03))
    img = Image.alpha_composite(img, hl_layer)

    # 4. 主体边缘暗描(增加轮廓清晰度)
    d = ImageDraw.Draw(img)
    d.ellipse([cx - body_r, cy - body_r, cx + body_r, cy + body_r],
              outline=(*RED_DARK, 200), width=int(ss * 0.012))

    # 5. 绿叶(顶部,3-4片带角度的叶子,不再是单三角)
    leaf_top_y = cy - body_r + int(ss * 0.03)
    leaf_layer = Image.new('RGBA', (ss, ss), TRANSPARENT)
    ld = ImageDraw.Draw(leaf_layer)
    leaf_len = int(body_r * 0.45)
    leaf_w = int(body_r * 0.18)
    # 4 片叶子,朝不同方向
    leaf_angles = [-50, -20, 20, 50]   # 度数(0=正上)
    import math
    for ang in leaf_angles:
        rad = math.radians(ang - 90)   # -90 让0度朝上
        # 叶子用椭圆模拟(从顶部中心向外延伸)
        lx = cx + math.cos(rad) * leaf_len * 0.3
        ly = leaf_top_y + math.sin(rad) * leaf_len * 0.3
        # 叶子主体椭圆
        leaf_cx = cx + math.cos(rad) * leaf_len * 0.5
        leaf_cy = leaf_top_y + math.sin(rad) * leaf_len * 0.5
        # 旋转:画椭圆后旋转图层
        single = Image.new('RGBA', (ss, ss), TRANSPARENT)
        sd2 = ImageDraw.Draw(single)
        sd2.ellipse([leaf_cx - leaf_len * 0.5, leaf_cy - leaf_w,
                     leaf_cx + leaf_len * 0.5, leaf_cy + leaf_w],
                    fill=GREEN + (255,))
        # 叶子暗部(根部)
        sd2.ellipse([leaf_cx - leaf_len * 0.5, leaf_cy - leaf_w,
                     leaf_cx - leaf_len * 0.1, leaf_cy + leaf_w],
                    fill=GREEN_DARK + (255,))
        rotated = single.rotate(ang, center=(cx, leaf_top_y), resample=Image.BICUBIC)
        leaf_layer = Image.alpha_composite(leaf_layer, rotated)
    # 叶子根部小绿团(连接处)
    ld2 = ImageDraw.Draw(leaf_layer)
    ld2.ellipse([cx - int(ss * 0.04), leaf_top_y - int(ss * 0.03),
                 cx + int(ss * 0.04), leaf_top_y + int(ss * 0.04)],
                fill=GREEN_DARK + (255,))
    img = Image.alpha_composite(img, leaf_layer)

    # 6. 整体轻微锐化(补偿缩放后的模糊)
    if s < ss:
        img = img.resize((s, s), Image.LANCZOS)

    return img


def make_tray_icon(size=32):
    """托盘图标:小尺寸要清晰,用简化的立体番茄(去掉叶子细节防糊)"""
    ss = size * 8   # 超采样
    img = Image.new('RGBA', (ss, ss), TRANSPARENT)
    d = ImageDraw.Draw(img)
    cx = cy = ss // 2
    body_r = int(ss * 0.36)

    # 径向渐变主体
    light_off = int(body_r * 0.25)
    steps = 30
    for i in range(steps, 0, -1):
        t = i / steps
        r = int(body_r * t)
        col = lerp_color(RED_LIGHT, RED_DARK, t ** 1.2)
        ex = cx - int(light_off * (1 - t))
        ey = cy - int(light_off * (1 - t))
        d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=col + (255,))

    # 高光
    hl = Image.new('RGBA', (ss, ss), TRANSPARENT)
    hd = ImageDraw.Draw(hl)
    hd.ellipse([cx - int(body_r * 0.5), cy - int(body_r * 0.5),
                cx - int(body_r * 0.05), cy - int(body_r * 0.05)],
               fill=(255, 220, 200, 100))
    hl = hl.filter(ImageFilter.GaussianBlur(ss * 0.04))
    img = Image.alpha_composite(img, hl)

    # 顶部小绿叶标记(简化版)
    ld = ImageDraw.Draw(img)
    lg = int(ss * 0.12)
    ld.ellipse([cx - lg, int(cy - body_r - lg * 0.3),
                cx + lg, int(cy - body_r + lg * 0.7)],
               fill=GREEN + (255,))

    return img.resize((size, size), Image.LANCZOS)


if __name__ == '__main__':
    import os
    out = os.path.dirname(os.path.abspath(__file__))
    app = make_app_icon(512)
    app.save(os.path.join(out, 'icon.png'))
    tray = make_tray_icon(32)
    tray.save(os.path.join(out, 'tray.png'))
    # ICO:多尺寸,Windows 任务栏/资源管理器会按需取
    app.save(os.path.join(out, 'icon.ico'), format='ICO',
             sizes=[(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)])
    print("图标生成完成(v2 精致版):")
    for f in ['icon.png', 'tray.png', 'icon.ico']:
        p = os.path.join(out, f)
        print(f"  {f}: {os.path.getsize(p)} bytes")
