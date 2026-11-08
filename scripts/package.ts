import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { error, info, success } from "./lib/console"
import { getProject, getProjectMembers } from "./lib/modrinth"
import { readPackMetadata } from "./lib/utils"
import { bundleMod } from "./packages/mod"
import { zipFolder } from "./packages/zip"

const packName = process.argv[2]

if (!packName || process.argv.length !== 3) {
  error("❌ Missing pack name. Usage: pnpm package <pack-name>")
}

const packPath = path.join("packs", packName!)
const stat = await fs.stat(packPath).catch(() => null)

if (!stat?.isDirectory()) {
  error(`❌ Pack not found: ${packName}`)
}

const metadata = await readPackMetadata(packPath)

info("🧹 Cleaning dist directory...")

await fs.rm("dist", { recursive: true, force: true })
await fs.mkdir("dist", { recursive: true })

info(`📦 Packaging ${packName}...`)

const zip = await zipFolder(metadata, packPath)
const zipPath = path.join("dist", `${packName}.zip`)
const zipBuffer = await zip.generateAsync({ type: "nodebuffer" })

await fs.writeFile(zipPath, zipBuffer)

success(`✅ Created ${packName}.zip at dist`)

if (metadata.type === "datapack") {
  info("⚙️ Packaging as mod...")

  const [project, members] = await Promise.all([
    getProject(metadata.project_id),
    getProjectMembers(metadata.project_id),
  ])

  const mod = await bundleMod({
    zip,
    project,
    members,
    versionNumber: metadata.version_number,
    gameVersions: metadata.game_versions,
    loaders: ["fabric", "quilt", "forge", "neoforge"],
  })
  const modPath = path.join("dist", `${packName}.jar`)
  const modBuffer = await mod.generateAsync({ type: "nodebuffer" })

  await fs.writeFile(modPath, modBuffer)

  success(`✅ Created ${packName}.jar at dist`)
}

success("🚀 Packaging complete")
