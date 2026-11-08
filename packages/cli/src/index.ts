#!/usr/bin/env node
/**
 * dsh-bot：DSHBot 的命令行入口。
 *
 * M0 之前只提供骨架命令；真正的房间读写会在房间存储落地后接上。
 */
import { newId } from '@dshbot/core'

const HELP = `dsh-bot — DSHBot 命令行

用法:
  dsh-bot room new <名称>    建一个房间（骨架实现，不落盘）
  dsh-bot --help             显示本帮助
  dsh-bot --version          显示版本

房间的真正读写会在 M0 接上。`

function main(argv: string[]): number {
  const [cmd, sub, ...rest] = argv

  if (cmd === '--help' || cmd === '-h' || !cmd) {
    console.log(HELP)
    return 0
  }

  if (cmd === '--version' || cmd === '-v') {
    console.log('0.0.0')
    return 0
  }

  if (cmd === 'room' && sub === 'new') {
    const name = rest.join(' ')
    if (!name) {
      console.error('缺少房间名称')
      return 2
    }
    console.log(JSON.stringify({ id: newId('room'), name, status: 'created' }, null, 2))
    return 0
  }

  console.error(`未知命令: ${argv.join(' ')}`)
  console.error('用 dsh-bot --help 看看能做什么')
  return 2
}

process.exitCode = main(process.argv.slice(2))
