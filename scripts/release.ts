import type { Buffer } from "node:buffer"
import fs from "node:fs/promises"
import path from "node:path"
import { error, info, success, warn } from "./lib/console"
import {
  createProjectVersion,
  getProject,
  getProjectMembers,
  getProjectVersions,
} from "./lib/modrinth"
import { readPackMetadata } from "./lib/utils"
import { zipFolder } from "./packages/datapack"
import { packageDatapack } from "./packages/mod"

function bufferToBlob(buffer: Buffer, mimeType: string) {
  const bytes = new Uint8Array(buffer.byteLength)
  bytes.set(buffer)

  return new Blob([bytes.buffer], { type: mimeType })
}

async function releasePack(packName: string, packPath: string) {
  const metadata = await readPackMetadata(packPath)

  const existingVersions = await getProjectVersions(metadata.project_id)
  const versionNumbers = new Set(existingVersions.map((version) => version.version_number))

  const datapackVersion = metadata.version_number
  const modVersion = `${metadata.version_number}+mod`

  const needsDatapack = !versionNumbers.has(datapackVersion)
  const needsMod = !versionNumbers.has(modVersion)

  if (!needsDatapack && !needsMod) {
    warn(`⏭️ Skipping ${packName}: both versions already exist`)
    return
  }

  const project = await getProject(metadata.project_id)

  info(`📦 Releasing ${packName} (${metadata.version_number})`)

  const datapackZip = await zipFolder(metadata, packPath, "datapack")

  if (needsDatapack) {
    const buffer = await datapackZip.generateAsync({ type: "nodebuffer" })

    await createProjectVersion({
      project_id: metadata.project_id,
      name: `${project.title} v${metadata.version_number}`,
      version_number: datapackVersion,
      changelog: metadata.changelog,
      game_versions: metadata.game_versions,
      version_type: "release",
      loaders: ["datapack"],
      file: {
        name: `${project.slug}-${metadata.version_number}.zip`,
        data: bufferToBlob(buffer, "application/zip"),
      },
    })

    success(`✅ Published datapack ${datapackVersion}`)
  } else {
    warn(`⏭️ Datapack ${datapackVersion} already exists`)
  }

  if (needsMod) {
    const members = await getProjectMembers(metadata.project_id)

    const modZip = await packageDatapack({
      zip: datapackZip,
      project,
      members,
      versionNumber: metadata.version_number,
      gameVersions: metadata.game_versions,
      loaders: ["fabric", "quilt", "forge", "neoforge"],
    })

    const buffer = await modZip.generateAsync({ type: "nodebuffer" })

    await createProjectVersion({
      project_id: metadata.project_id,
      name: `${project.title} v${metadata.version_number}`,
      version_number: modVersion,
      changelog: metadata.changelog,
      game_versions: metadata.game_versions,
      version_type: "release",
      loaders: ["fabric", "quilt", "forge", "neoforge"],
      environment: "server_only",
      file: {
        name: `${project.slug}-${metadata.version_number}.jar`,
        data: bufferToBlob(buffer, "application/java-archive"),
      },
    })

    success(`✅ Published mod ${modVersion}`)
  } else {
    warn(`⏭️ Mod ${modVersion} already exists`)
  }
}

const packsDir = path.resolve("packs")
const entries = await fs.readdir(packsDir, { withFileTypes: true })
const packFolders = entries.filter((entry) => entry.isDirectory())

let failed = 0

for (const folder of packFolders) {
  const packPath = path.join(packsDir, folder.name)
  const metadataPath = path.join(packPath, "modrinth.json")

  try {
    await fs.access(metadataPath)
  } catch {
    continue
  }

  try {
    await releasePack(folder.name, packPath)
  } catch (err) {
    failed++
    warn(`❌ Failed to release ${folder.name}: ${err}`)
  }
}

if (failed > 0) {
  error(`❌ ${failed} pack(s) failed to release`)
}

success("🚀 Release complete")
