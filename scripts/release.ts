import type { Buffer } from "node:buffer"
import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { error, info, success, warn } from "./lib/console"
import {
  createProjectVersion,
  getProject,
  getProjectMembers,
  getProjectVersions,
} from "./lib/modrinth"
import { readPackMetadata } from "./lib/utils"
import { bundleMod } from "./packages/mod"
import { zipFolder } from "./packages/zip"

function bufferToBlob(buffer: Buffer, mimeType: string) {
  const bytes = new Uint8Array(buffer.byteLength)
  bytes.set(buffer)

  return new Blob([bytes.buffer], { type: mimeType })
}

async function releasePack(packName: string, packPath: string) {
  const metadata = await readPackMetadata(packPath)
  const versions = await getProjectVersions(metadata.project_id).then((project_versions) =>
    project_versions.map((project_version) => project_version.version_number),
  )

  const modVersion = `${metadata.version_number}+mod`

  const needsZip = !versions.includes(metadata.version_number)
  const needsMod = metadata.type === "datapack" && !versions.includes(modVersion)

  if (!needsZip && !needsMod) {
    warn(`⏭️ Skipping ${packName}: all versions already exist`)
    return
  }

  const project = await getProject(metadata.project_id)

  info(`📦 Releasing ${packName} (${metadata.version_number})`)

  const zip = await zipFolder(metadata, packPath)

  if (needsZip) {
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" })

    await createProjectVersion({
      project_id: metadata.project_id,
      name: `${project.title} v${metadata.version_number}`,
      version_number: metadata.version_number,
      changelog: metadata.changelog,
      game_versions: metadata.game_versions,
      version_type: metadata.version_type,
      loaders: metadata.type === "datapack" ? ["datapack"] : ["minecraft"],
      environment: "server_only",
      file: {
        name: `${project.slug}-${metadata.version_number}.zip`,
        data: bufferToBlob(zipBuffer, "application/zip"),
      },
    })

    success(`✅ Published ${metadata.type} ${metadata.version_number}`)
  } else {
    const capitalizedType = metadata.type.charAt(0).toUpperCase() + metadata.type.slice(1)

    warn(`⏭️ ${capitalizedType} ${metadata.version_number} already exists`)
  }

  if (needsMod) {
    const members = await getProjectMembers(metadata.project_id)

    const mod = await bundleMod({
      zip,
      project,
      members,
      versionNumber: metadata.version_number,
      gameVersions: metadata.game_versions,
      loaders: ["fabric", "quilt", "forge", "neoforge"],
    })
    const modBuffer = await mod.generateAsync({ type: "nodebuffer" })

    await createProjectVersion({
      project_id: metadata.project_id,
      name: `${project.title} v${metadata.version_number}`,
      version_number: modVersion,
      changelog: metadata.changelog,
      game_versions: metadata.game_versions,
      version_type: metadata.version_type,
      loaders: ["fabric", "quilt", "forge", "neoforge"],
      environment: "server_only",
      file: {
        name: `${project.slug}-${metadata.version_number}.jar`,
        data: bufferToBlob(modBuffer, "application/java-archive"),
      },
    })

    success(`✅ Published mod ${modVersion}`)
  } else if (metadata.type === "datapack") {
    warn(`⏭️ Mod ${modVersion} already exists`)
  }
}

const packName = process.argv[2]

if (process.argv.length > 3) {
  error("❌ Too many arguments. Usage: pnpm release [pack-name]")
}

const packEntries = await fs.readdir("packs", { withFileTypes: true })
const packFolders = packEntries.filter((entry) => entry.isDirectory())

const packs = packName ? packFolders.filter((folder) => folder.name === packName) : packFolders

if (packName && packs.length === 0) {
  error(`❌ Pack not found: ${packName}`)
}

for (const pack of packs) {
  const packPath = path.join("packs", pack.name)
  const metadataPath = path.join(packPath, "metadata.json")

  try {
    await fs.access(metadataPath)
  } catch {
    continue
  }

  try {
    await releasePack(pack.name, packPath)
  } catch (err) {
    error(`❌ Failed to release ${pack.name}: ${err}`)
  }
}

success("🚀 Release complete")
