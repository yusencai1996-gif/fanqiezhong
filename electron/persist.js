const fs = require('fs')
const path = require('path')

// v0.5.0:状态文件 IO 从 main.js 抽出(损坏自愈 + 原子写)。
// 三态区分(2026-09-24 独立复审 B1 整改):
//   文件不存在 → 返回 null(新用户,安全创建)
//   内容损坏(JSON 解析失败)→ 备份成功返回 null 安全重建;备份失败抛错保护原件
//   普通 IO 错误(占用/权限等临时故障)→ 抛错向上传递,绝不伪装成"无数据"
//   (否则空状态自动落盘会把旧档覆盖掉——内存复现已证实该风险)
// 原子写:先写同目录临时文件再 rename;失败时清理临时文件(防残留含密钥副本)。
function createPersist({ getDataFile }) {
  function readState() {
    const file = getDataFile()
    if (!fs.existsSync(file)) return null
    const text = fs.readFileSync(file, 'utf-8')   // IO 错误(EPERM/EBUSY/EISDIR…)直接向上抛
    try {
      return JSON.parse(text)
    } catch (e) {
      const backup = `${file}.corrupt-${Date.now()}`
      try {
        fs.renameSync(file, backup)
        console.error('state file corrupt, renamed to', backup)
        return null
      } catch (_) {
        console.error('state file corrupt, backup failed; keep original untouched')
        throw new Error('STATE_CORRUPT_BACKUP_FAILED')
      }
    }
  }

  function writeState(state) {
    const file = getDataFile()
    const tmp = `${file}.tmp-write`
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
      fs.renameSync(tmp, file)
      return true
    } catch (e) {
      // 写入/改名失败:清掉临时文件(内容含完整状态与密钥,不能残留)
      try { fs.unlinkSync(tmp) } catch (_) { /* tmp 未产生或已改名,忽略 */ }
      console.error('write state failed')
      return false
    }
  }

  return { readState, writeState }
}

module.exports = { createPersist }
