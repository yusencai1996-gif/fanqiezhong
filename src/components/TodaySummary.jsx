import { fmtDuration } from '../features/format.js'

export default function TodaySummary({ totalSec, count }) {
  return (
    <div className="summary">
      今日：{count} 个番茄 / {fmtDuration(totalSec)}
    </div>
  )
}
