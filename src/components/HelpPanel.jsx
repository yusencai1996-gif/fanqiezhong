import { HelpCircle, Rocket, GitBranch, Link2, Layers, HelpCircle as QIcon } from 'lucide-react'
import './HelpPanel.css'

// 使用说明面板。纯展示,无逻辑。
export default function HelpPanel({ onClose }) {
  return (
    <div className="help-overlay" onClick={onClose}>
      <div className="help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="help-header">
          <h2><HelpCircle size={20} /> 使用说明</h2>
          <button className="help-close" onClick={onClose}>×</button>
        </div>

        <div className="help-scroll">
          {/* 一、快速上手 */}
          <section className="help-section">
            <h3><Rocket size={16} /> 快速上手（3步）</h3>
            <ol className="help-steps">
              <li><strong>建目标</strong>：点右上角 🎯，创建一个目标（如「中级会计考试」），设个截止日。</li>
              <li><strong>加计划</strong>：目标下设科目（如「实务」「财管」），科目下加计划（如「第一轮」，设总时长+截止日）。任务可选，灵活。</li>
              <li><strong>选任务→开始计时</strong>：左边任务列表点一个任务，点「开始」。计时结束自动记录到该任务名下。</li>
            </ol>
          </section>

          {/* 二、核心概念 */}
          <section className="help-section">
            <h3><GitBranch size={16} /> 核心概念：4层结构</h3>
            <div className="help-concept">
              <p>番茄钟是「目标驱动的学习管理系统」，数据从上到下分4层：</p>
              <pre className="help-tree">🎯 目标（如：中级会计考试）
 └─ 📚 科目（如：实务、财管、经济法）
     └─ 📋 计划（如：第一轮、第二轮，各有总时长+截止日）
         └─ ✏️ 任务（具体的学习内容，可选）</pre>
              <p className="help-note">💡 <b>任务可选</b>——你也可以不选任务直接计时（叫「自由专注」），但建议选任务，这样学习时长会归入对应科目，进度/打卡才能算到。</p>
            </div>
          </section>

          {/* 三、功能联动（最容易困惑的） */}
          <section className="help-section">
            <h3><Link2 size={16} /> 功能怎么联动</h3>
            <p className="help-subtitle">这是最容易困惑的部分，重点看：</p>
            <div className="help-flow">
              <div className="help-flow-item">
                <strong>① 计时 → 统计/打卡</strong>
                <p>每次专注结束，自动生成一条记录。<b>打卡判定</b>：今天总专注达到「每日门槛」（默认30分，设置里改）= 打卡成功。看 📋 打卡表的日历热力图能一眼看出坚持情况。</p>
              </div>
              <div className="help-flow-item">
                <strong>② 计时 → 计划进度</strong>
                <p>专注时若选了任务，时长会归入该任务的<b>科目</b>，自动累加到该科目下所有计划的「已完成」。<b>每日自动分配</b>：系统按「(总时长-已完成)÷剩余天数」算今天该学多少，显示在今日计划面板。</p>
              </div>
              <div className="help-flow-item">
                <strong>③ 计划 → 进度预测</strong>
                <p>📈 进度预测面板根据你的专注速率（近7天均值 + 计划至今总均），预测能不能按时完成，还画燃尽图（理想线vs你的实际线）。</p>
              </div>
              <div className="help-flow-item">
                <strong>④ 目标 → 倒计时</strong>
                <p>主界面常驻显示「距目标还有X天」，过期会红字警示。提醒你别拖。</p>
              </div>
            </div>
            <p className="help-note">⚠️ <b>关于「自由专注」</b>：没选任务的专注，时长不计入任何科目/计划（只在全局统计和打卡里算）。所以想看进度准确，请记得选任务。</p>
          </section>

          {/* 四、各模块 */}
          <section className="help-section">
            <h3><Layers size={16} /> 各模块说明</h3>
            <ul className="help-modules">
              <li><strong>⏱️ 计时器</strong>：可自定义工作/休息时长。时间戳计时法，电脑睡眠唤醒后时间依然准。支持暂停、提前结束（按实际时间记）、跳过、重置。</li>
              <li><strong>✏️ 任务清单</strong>：左边列表。支持标签、排序、归属科目。<b>点任务选中→开始计时→自动绑定</b>。再点一次已选中的任务 = 取消选中（回到自由专注）。任务选中状态会<b>持久化</b>，关掉应用重开不丢。</li>
              <li><strong>🎯 目标管理</strong>：弹层。管理 目标/科目/计划 三层。计划可改（名称/总时长/截止日）、可删。科目/计划支持归档（隐藏但保留数据）。</li>
              <li><strong>📋 打卡表</strong>：弹层。日历热力图看每天打卡状态（绿=达标/黄=部分/灰=缺勤）。显示连续打卡天数。门槛在设置里改。</li>
              <li><strong>📈 进度预测</strong>：弹层。目标总进度条 + 各计划完成预测（双速率）+ 燃尽图。点倒计时行也能打开。</li>
              <li><strong>📊 数据统计</strong>：弹层。今日概览 + 近7天/月/年趋势 + 任务时间去向排行。</li>
              <li><strong>⚙️ 设置</strong>：弹层。时长、每日打卡门槛、开机自启。</li>
              <li><strong>🔌 小插件浮窗</strong>：独立小窗，极简显示，全局快捷键 <kbd>Ctrl+Shift+Space</kbd> 开始/暂停。</li>
            </ul>
          </section>

          {/* 五、常见问题 */}
          <section className="help-section">
            <h3><QIcon size={16} /> 常见问题</h3>
            <ul className="help-faq">
              <li><strong>Q：为什么任务选中后，下一轮番茄钟还是这个任务？</strong><br />A：这是设计——选了就一直保持，直到你主动换任务（点别的）或取消（再点一次）。关掉应用重开也不丢。</li>
              <li><strong>Q：软件闪退了，专注的时间丢了吗？</strong><br />A：不会。专注超过30秒的部分，下次启动会自动恢复（顶部弹提示「已自动恢复X分钟」）。</li>
              <li><strong>Q：自由专注和绑任务有什么区别？</strong><br />A：绑任务的专注会算入科目/计划进度；自由专注只在全局统计里算。建议平时选任务。</li>
              <li><strong>Q：打卡的「成功」标准是什么？</strong><br />A：今天总专注（含自由专注）≥ 每日门槛（默认30分）。不绑定具体计划，看整体投入。</li>
              <li><strong>Q：进度预测说「落后」，怎么办？</strong><br />A：说明按当前速率可能赶不上截止日。提速（多学）或调整计划截止日。</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}
