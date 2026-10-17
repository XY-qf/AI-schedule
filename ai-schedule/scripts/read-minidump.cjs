// 解析 Windows minidump，输出异常码与出错的模块（不需要调试器）
const fs = require('node:fs')

const file = process.argv[2]
const buf = fs.readFileSync(file)

if (buf.toString('ascii', 0, 4) !== 'MDMP') {
  console.log('不是 minidump 文件')
  process.exit(1)
}

const numberOfStreams = buf.readUInt32LE(8)
const streamDirRva = buf.readUInt32LE(12)

const streams = []
for (let i = 0; i < numberOfStreams; i += 1) {
  const off = streamDirRva + i * 12
  streams.push({
    type: buf.readUInt32LE(off),
    size: buf.readUInt32LE(off + 4),
    rva: buf.readUInt32LE(off + 8),
  })
}

function readUtf16String(rva) {
  const len = buf.readUInt32LE(rva)
  return buf.toString('utf16le', rva + 4, rva + 4 + len)
}

const modules = []
const moduleStream = streams.find((s) => s.type === 4)
if (moduleStream) {
  const count = buf.readUInt32LE(moduleStream.rva)
  for (let i = 0; i < count; i += 1) {
    const base = moduleStream.rva + 4 + i * 108
    const baseOfImage = buf.readBigUInt64LE(base)
    const sizeOfImage = buf.readUInt32LE(base + 8)
    const nameRva = buf.readUInt32LE(base + 20)
    modules.push({
      base: baseOfImage,
      size: BigInt(sizeOfImage),
      name: readUtf16String(nameRva),
    })
  }
}

const exceptionStream = streams.find((s) => s.type === 6)
if (!exceptionStream) {
  console.log('没有异常流')
  process.exit(0)
}

const exceptionCode = buf.readUInt32LE(exceptionStream.rva + 8)
const exceptionAddress = buf.readBigUInt64LE(exceptionStream.rva + 24)

const names = {
  0x80000003: 'STATUS_BREAKPOINT（断言失败/主动中断）',
  0xc0000005: 'STATUS_ACCESS_VIOLATION（访问违例）',
  0xc0000409: 'STATUS_STACK_BUFFER_OVERRUN（安全 cookie 被破坏）',
  0xc000001d: 'STATUS_ILLEGAL_INSTRUCTION（非法指令）',
  0xe06d7363: 'C++ 异常',
}

console.log('异常码: 0x' + exceptionCode.toString(16).toUpperCase(), '=', names[exceptionCode] ?? '未知')
console.log('异常地址: 0x' + exceptionAddress.toString(16).toUpperCase())

const hit = modules.find(
  (m) => exceptionAddress >= m.base && exceptionAddress < m.base + m.size,
)
console.log('出错模块:', hit ? hit.name : '（不在任何已知模块内）')

const ntdll = modules.find((m) => m.name.toLowerCase().endsWith('ntdll.dll'))
if (ntdll) {
  const off = exceptionAddress - ntdll.base
  if (off >= 0n && off < ntdll.size) console.log('在 ntdll 内偏移: 0x' + off.toString(16))
}

console.log('\n已加载模块（前 25 个）:')
for (const m of modules.slice(0, 25)) console.log('  ' + m.name)
