// Copies the SQLite database to a timestamped file and reports what the media
// folder contains. The database and the videos are backed up separately, because
// only the database can be copied safely while the site is running (VACUUM INTO).
import { mkdir, stat, readdir } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { loadLocalEnvironment } from './env.mjs'

loadLocalEnvironment()

const dbPath = process.env.NUXT_LIBRARY_DB_PATH || '.data/library.sqlite'
const mediaRoot = process.env.NUXT_LIBRARY_MEDIA_ROOT || 'media'
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outDir = process.env.NUXT_LIBRARY_BACKUP_DIR || 'backups'
const target = join(outDir, `${basename(dbPath, '.sqlite')}-${stamp}.sqlite`)

try {
  await stat(dbPath)
} catch {
  console.error(`找不到数据库：${dbPath}`)
  process.exit(1)
}

await mkdir(dirname(target), { recursive: true })

// VACUUM INTO writes a consistent snapshot even while the site keeps running.
const db = new DatabaseSync(dbPath, { readOnly: true })
try {
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
} finally {
  db.close()
}

const size = (await stat(target)).size
console.log(`数据库已备份：${target} (${(size / 1024).toFixed(1)} KB)`)

let files = 0
let bytes = 0
async function walk(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await walk(path)
    else if (entry.isFile()) {
      files++
      bytes += (await stat(path).catch(() => ({ size: 0 }))).size
    }
  }
}
await walk(mediaRoot)

console.log(`媒体目录：${mediaRoot} — ${files} 个文件，${(bytes / 1024 ** 3).toFixed(2)} GB`)
console.log('影片原文件没有包含在本脚本中，请单独备份媒体目录。')
console.log('恢复时：停止站点 → 用备份替换数据库 → 保持相对路径恢复媒体目录 → 重启并按 4 查看状态。')
