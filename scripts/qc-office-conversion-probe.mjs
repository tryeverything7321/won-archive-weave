// Self-authored fixtures only. No production documents or credentials.
// This qualifies a local engine candidate, not the deployed preview pipeline.
import { mkdtemp, writeFile, readFile, readdir, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import assert from 'node:assert/strict'
const execute = promisify(execFile)
const xml = body => '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + body
const rels = items => xml('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + items.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('') + '</Relationships>')
const types = overrides => xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' + overrides.map(([part, type]) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join('') + '</Types>')
function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  return (crc ^ 0xffffffff) >>> 0
}
function zip(entries) {
  const chunks = [], directory = []
  let offset = 0
  for (const [path, contents] of Object.entries(entries)) {
    const name = Buffer.from(path), bytes = Buffer.from(contents), crc = crc32(bytes)
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42)
    chunks.push(local, name, bytes); directory.push(central, name); offset += local.length + name.length + bytes.length
  }
  const central = Buffer.concat(directory), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(directory.length / 2, 8); end.writeUInt16LE(directory.length / 2, 10)
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, central, end])
}
const fixtures = {
  pptx: {
    '[Content_Types].xml': types([['ppt/presentation.xml', 'presentationml.presentation.main'], ['ppt/slides/slide1.xml', 'presentationml.slide']]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]),
    'ppt/presentation.xml': xml('<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>'),
    'ppt/_rels/presentation.xml.rels': rels([['rId1', 'slide', 'slides/slide1.xml']]),
    'ppt/slides/slide1.xml': xml('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Probe"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="10058400" cy="1828800"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="2400"/><a:t>WEAVE PPTX PROBE — 위브 발표 자료</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>'),
  },
  docx: {
    '[Content_Types].xml': types([['word/document.xml', 'wordprocessingml.document.main']]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
    'word/document.xml': xml('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>WEAVE DOCX PROBE — 위브 회의록</w:t></w:r></w:p><w:p><w:r><w:t>Self-authored conversion fixture. Not a real user record.</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'),
  },
  xlsx: {
    '[Content_Types].xml': types([['xl/workbook.xml', 'spreadsheetml.sheet.main'], ['xl/worksheets/sheet1.xml', 'spreadsheetml.worksheet']]),
    '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': xml('<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="합성 명단" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml']]),
    'xl/worksheets/sheet1.xml': xml('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>WEAVE XLSX PROBE</t></is></c><c r="B1"><v>42</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>위브 합성 자료</t></is></c></row></sheetData></worksheet>'),
  },
}
const keepFixtures = process.argv.includes('--keep-fixtures')
const executable = process.argv.slice(2).find(arg => arg !== '--keep-fixtures') || '/opt/homebrew/bin/soffice'
const remote = executable.startsWith('http://127.0.0.1:') ? executable : null
const temp = await mkdtemp(join(tmpdir(), 'weave-office-probe-'))
const results = []
try {
  for (const [extension, entries] of Object.entries(fixtures)) {
    const dir = join(temp, extension); await mkdir(dir)
    const source = join(dir, 'synthetic.' + extension); await writeFile(source, zip(entries))
    if (remote) {
      const response = await fetch(`${remote}/convert?format=${extension}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: zip(entries), signal: AbortSignal.timeout(60_000) })
      assert.equal(response.status, 200, `${extension}: ${response.status}`)
      assert.match(response.headers.get('content-type') ?? '', /application\/pdf/)
      await writeFile(join(dir, 'synthetic.pdf'), Buffer.from(await response.arrayBuffer()))
    } else {
      await execute(executable, ['-env:UserInstallation=' + pathToFileURL(join(dir, 'profile')).href,
        '--headless', '--nologo', '--nodefault', '--norestore', '--convert-to', 'pdf', '--outdir', dir, source],
      { timeout: 45_000, maxBuffer: 128 * 1024 })
    }
    assert.ok((await readdir(dir)).includes('synthetic.pdf'), extension + ' PDF missing')
    const bytes = await readFile(join(dir, 'synthetic.pdf'))
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    const { stdout } = await execute('/opt/homebrew/bin/pdftotext', [join(dir, 'synthetic.pdf'), '-'])
    assert.match(stdout, /WEAVE/)
    assert.match(stdout, /위브/)
    results.push({ extension, result: remote ? 'LIVE_WORKER_PDF_TEXT_PASS' : 'LOCAL_PDF_TEXT_PASS', bytes: bytes.length })
  }
  console.log(JSON.stringify({ results, ...(keepFixtures ? { fixtureDirectory: temp } : {}), limitation: 'Self-authored minimal DOCX/PPTX/XLSX only; layout fidelity and signed-in upload-to-viewer flow are separate checks.' }, null, 2))
} finally {
  // Only this process-created temporary fixture directory is removed.
  if (!keepFixtures) await rm(temp, { recursive: true, force: true })
}
