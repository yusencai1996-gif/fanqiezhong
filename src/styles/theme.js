// 设计 token(JS 侧) —— 与 global.css 的 CSS 变量保持一致。
// 套用 frontend-design 技能审美:暖墨沉静 + 朱砂番茄红点睛。
// 换主题时,这里和 global.css 的 :root 一起改。
// JS 侧给动态逻辑用(如 canvas/动态色),静态样式走 CSS 变量。
export const theme = {
  colors: {
    primary: 'oklch(0.62 0.19 28)',          // 番茄朱砂
    primaryHover: 'oklch(0.56 0.20 28)',
    break: 'oklch(0.62 0.10 165)',           // 青瓷(休息)
    success: 'oklch(0.65 0.15 150)',         // 翠绿(打卡成功,v0.3.8)
    warning: 'oklch(0.75 0.14 75)',          // 琥珀黄(部分完成)
    danger: 'oklch(0.62 0.18 25)',           // 朱红(缺勤)
    bg: 'oklch(0.18 0.012 270)',             // 暖墨底
    surface: 'oklch(0.23 0.014 270)',
    text: 'oklch(0.92 0.005 270)',
    textMuted: 'oklch(0.65 0.012 270)',
    border: 'oklch(0.32 0.014 270 / 0.6)',
  },
  font: {
    family: '"Outfit", "Noto Sans SC", "Source Han Sans SC", -apple-system, sans-serif',
    mono: '"JetBrains Mono", "Fira Code", monospace',
    sizeSm: '13px',
    sizeMd: '15px',
    sizeLg: '20px',
    sizeXl: '56px',
  },
  spacing: { sm: '8px', md: '16px', lg: '24px' },
  radius: '16px',
  radiusSm: '10px',
  ease: 'cubic-bezier(0.16, 1, 0.3, 1)',
}
