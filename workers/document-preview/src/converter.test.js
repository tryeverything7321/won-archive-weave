import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import { createDocumentConverter } from './converter.js'

const execFileAsync = promisify(execFile)
const pythonBinary = process.env.PYTHON ?? 'python3'

let crcTable
function crc32(buffer) {
  crcTable ??= Array.from({ length: 256 }, (_, value) => {
    let current = value
    for (let index = 0; index < 8; index += 1) current = (current >>> 1) ^ (0xedb88320 & -(current & 1))
    return current >>> 0
  })
  let value = 0xffffffff
  for (const byte of buffer) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff]
  return (value ^ 0xffffffff) >>> 0
}

function makeZip(entries) {
  const local = []
  const central = []
  let offset = 0
  for (const [name, value] of entries) {
    const nameBytes = Buffer.from(name)
    const data = Buffer.from(value)
    const checksum = crc32(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt32LE(checksum, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(nameBytes.length, 26)
    local.push(header, nameBytes, data)
    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt32LE(checksum, 16)
    directory.writeUInt32LE(data.length, 20)
    directory.writeUInt32LE(data.length, 24)
    directory.writeUInt16LE(nameBytes.length, 28)
    directory.writeUInt32LE(offset, 42)
    central.push(directory, nameBytes)
    offset += header.length + nameBytes.length + data.length
  }
  const directoryBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directoryBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directoryBytes, end])
}

async function preflight(bytes, format) {
  const directory = await mkdtemp(join(tmpdir(), 'weave-preflight-test-'))
  const path = join(directory, `input.${format}`)
  try {
    await writeFile(path, bytes)
    return await execFileAsync(pythonBinary, [join(import.meta.dirname, 'preflight_ooxml.py'), path, format])
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}

const contentTypes = '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
const emptyRelationships = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'

test('OOXML preflight rejects traversal, macros, external relationships, and external spreadsheet formulas', async () => {
  const cases = [
    ['docx', makeZip([['[Content_Types].xml', contentTypes], ['word/document.xml', '<doc/>'], ['../escape', 'x']])],
    ['docx', makeZip([['[Content_Types].xml', `${contentTypes}<Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>`], ['word/document.xml', '<doc/>']])],
    ['pptx', makeZip([['[Content_Types].xml', contentTypes], ['ppt/presentation.xml', '<p/>'], ['ppt/_rels/presentation.xml.rels', '<Relationships><Relationship TargetMode="External" Target="https://example.test"/></Relationships>']])],
    ['xlsx', makeZip([['[Content_Types].xml', contentTypes], ['xl/workbook.xml', '<workbook/>'], ['xl/worksheets/sheet1.xml', '<f>WEBSERVICE("https://example.test")</f>']])],
  ]
  for (const [format, bytes] of cases) {
    await assert.rejects(preflight(bytes, format))
  }
})

test('OOXML preflight accepts a minimal structurally bounded document', async () => {
  const bytes = makeZip([
    ['[Content_Types].xml', contentTypes],
    ['word/document.xml', '<document/>'],
    ['_rels/.rels', emptyRelationships],
  ])
  await assert.doesNotReject(preflight(bytes, 'docx'))
})

test('HWPX requires its bounded container contract and HWP5 requires its exact signature', async () => {
  const hwpx = makeZip([
    ['mimetype', 'application/hwp+zip'],
    ['Contents/content.hpf', '<package/>'],
    ['META-INF/container.xml', '<container/>'],
  ])
  await assert.doesNotReject(preflight(hwpx, 'hwpx'))
  await assert.rejects(preflight(makeZip([
    ['mimetype', 'application/hwp+zip'],
    ['../escape', 'x'],
    ['Contents/content.hpf', '<package/>'],
    ['META-INF/container.xml', '<container/>'],
  ]), 'hwpx'))
  await assert.doesNotReject(preflight(Buffer.from('d0cf11e0a1b11ae1', 'hex'), 'hwp'))
  await assert.rejects(preflight(Buffer.from('not-an-hwp'), 'hwp'))
})

test('converter removes workspace after success and failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weave-converter-test-'))
  try {
    const success = createDocumentConverter({
      tmpRoot: root,
      preflight: async () => undefined,
      runner: async ({ outputPath }) => {
        await writeFile(outputPath, '%PDF-test')
        return { code: 0 }
      },
    })
    assert.equal((await success(Buffer.from('safe'), 'docx')).toString(), '%PDF-test')
    assert.deepEqual(await readdir(root), [])

    const failure = createDocumentConverter({
      tmpRoot: root,
      preflight: async () => undefined,
      runner: async () => ({ code: 1 }),
    })
    await assert.rejects(failure(Buffer.from('bad'), 'pptx'), /conversion_failed/)
    assert.deepEqual(await readdir(root), [])
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
