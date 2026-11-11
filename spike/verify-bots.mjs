/**
 * 验证 Bot 库：工具集列表、角色卡自动拆分、从库里拉人。
 *
 * 用法：node spike/verify-bots.mjs <token> [baseUrl]
 */
const [, , token, baseArg] = process.argv
if (!token) {
  console.error('用法: node spike/verify-bots.mjs <token> [baseUrl]')
  process.exit(1)
}
const base = baseArg ?? 'http://127.0.0.1:54873'

async function call(path, init) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${path} → ${res.status} ${text}`)
  return text === '' ? null : JSON.parse(text)
}

const presets = await call('/dshbot/api/presets')
console.log('可用工具集：')
for (const preset of presets.presets) console.log(`  ${preset.id} = ${preset.label}`)

const text = [
  '身份：资深硬件工程师，做过十年电源与热设计，习惯先算最坏情况。',
  '专长：电源设计、热仿真',
  '输出规范：先给结论，再列风险与验证方法；涉及参数必须给出单位和容差。'
].join('\n')

const saved = await call('/dshbot/api/bots', {
  method: 'POST',
  body: JSON.stringify({ name: '老周', avatar: '🛠', text, agentPreset: 'standard' })
})
console.log('\n角色卡自动拆分：')
console.log('  persona     =', saved.bot.persona)
console.log('  expertise   =', saved.bot.expertise)
console.log('  instructions=', saved.bot.instructions)
console.log('  preset      =', saved.bot.agentPreset)

const room = await call('/dshbot/api/rooms', {
  method: 'POST',
  body: JSON.stringify({
    name: '硬件流程',
    goal: '写一份硬件开发流程与文档',
    acceptance: ['x'],
    mode: 'auto'
  })
})
const added = await call(`/dshbot/api/rooms/${room.room.id}/members`, {
  method: 'POST',
  body: JSON.stringify({ defId: saved.bot.id, role: 'host' })
})
const member = added.member
console.log('\n从库里拉进房间：')
console.log(`  ${member.avatar} ${member.name}（${member.role}）`)
console.log('  persona     =', member.persona)
console.log('  expertise   =', member.expertise)
console.log('  preset      =', member.agentPreset)
console.log('  defId       =', member.defId)

const list = await call('/dshbot/api/bots')
console.log(`\n库里现在有 ${list.bots.length} 个 Bot`)
