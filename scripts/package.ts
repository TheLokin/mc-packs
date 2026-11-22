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
import { setGameVersionMode } from "./lib/scrape"
import { capitalize, readPackMetadata, supportsGameVersions } from "./lib/utils"
import { bundleMod } from "./packages/mod"
import { bundleZip } from "./packages/zip"

async function saveArtifact(filename: string, buffer: Buffer, directory: string | undefined) {
  const filePath = path.join("dist", filename)

  await fs.writeFile(filePath, buffer)

  success(`✅ Created ${filename} at dist`)

  if (!directory) return

  const dirStat = await fs.stat(directory).catch(() => null)

  if (!dirStat?.isDirectory()) {
    warn(`⚠️ Directory not found: ${directory}`)
    return
  }

  await fs.copyFile(filePath, path.join(directory, path.basename(filePath)))

  info(`📁 Copied to ${directory}`)
}

const args = process.argv.slice(2)
const release = args.includes("--release")

setGameVersionMode(release)

const packNames = args.filter((arg) => arg !== "--release")

if (packNames.length > 1) {
  error("❌ Too many arguments. Usage: pnpm package [pack-name] [--release]")
}

const packName = packNames[0]

const packEntries = await fs.readdir("packs", { withFileTypes: true })
const packFolders = packEntries.filter((entry) => entry.isDirectory())
const packs = packName ? packFolders.filter((folder) => folder.name === packName) : packFolders

if (packName && packs.length === 0) {
  error(`❌ Pack not found: ${packName}`)
}

if (!release) {
  info("🧹 Cleaning dist directory...")

  await fs.rm("dist", { recursive: true, force: true })
  await fs.mkdir("dist", { recursive: true })
}

for (const pack of packs) {
  const packPath = path.join("packs", pack.name)

  try {
    const metadata = await readPackMetadata(packPath)

    const supportsZip = supportsGameVersions(metadata.game_versions, metadata.type)
    const supportsMod = metadata.type === "datapack" && metadata.loaders.length > 0

    if (!supportsZip && !supportsMod) {
      warn(`⏭️ Skipping ${pack.name}: unsupported Minecraft versions`)
      continue
    }

    const versions = release
      ? await getProjectVersions(metadata.project_id).then((projectVersions) =>
          projectVersions.map((projectVersion) => projectVersion.version_number),
        )
      : []

    const modVersion = `${metadata.version_number}+mod`

    const needsZip = supportsZip && (!release || !versions.includes(metadata.version_number))
    const needsMod = supportsMod && (!release || !versions.includes(modVersion))

    if (!needsZip && !needsMod) {
      warn(`⏭️ Skipping ${pack.name}: all versions already exist`)
      continue
    }

    info(`${release ? "🚀 Releasing" : "📦 Packaging"} ${pack.name} (${metadata.version_number})`)

    const [project, members] = await Promise.all([
      release || needsMod ? getProject(metadata.project_id) : undefined,
      needsMod ? getProjectMembers(metadata.project_id) : undefined,
    ])

    const zip = await bundleZip(packPath)

    if (needsZip) {
      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" })

      if (release) {
        await createProjectVersion({
          project_id: metadata.project_id,
          name: `${project!.title} v${metadata.version_number}`,
          version_number: metadata.version_number,
          changelog: metadata.changelog,
          game_versions: metadata.game_versions,
          version_type: metadata.version_type,
          loaders: metadata.type === "datapack" ? ["datapack"] : ["minecraft"],
          environment: "server_only",
          file: {
            name: `${project!.slug}-${metadata.version_number}.zip`,
            data: new Blob([new Uint8Array(zipBuffer)], { type: "application/zip" }),
          },
        })

        success(`✅ Published ${metadata.type} ${metadata.version_number}`)
      } else {
        await saveArtifact(
          `${pack.name}.zip`,
          zipBuffer,
          metadata.type === "resourcepack"
            ? process.env.RESOURCEPACK_DIR
            : process.env.DATAPACK_DIR,
        )
      }
    } else if (release && supportsZip) {
      warn(`⏭️ ${capitalize(metadata.type)} ${metadata.version_number} already exists`)
    } else if (!supportsZip) {
      warn(`⏭️ ${capitalize(metadata.type)} does not support the specified Minecraft versions`)
    }

    if (needsMod) {
      const mod = await bundleMod({
        zip,
        project: project!,
        members: members!,
        versionNumber: metadata.version_number,
        gameVersions: metadata.game_versions,
        loaders: metadata.loaders,
      })

      const modBuffer = await mod.generateAsync({ type: "nodebuffer" })

      if (release) {
        await createProjectVersion({
          project_id: metadata.project_id,
          name: `${project!.title} v${metadata.version_number}`,
          version_number: modVersion,
          changelog: metadata.changelog,
          game_versions: metadata.game_versions,
          version_type: metadata.version_type,
          loaders: metadata.loaders,
          environment: "server_only",
          file: {
            name: `${project!.slug}-${metadata.version_number}.jar`,
            data: new Blob([new Uint8Array(modBuffer)], { type: "application/java-archive" }),
          },
        })

        success(`✅ Published mod ${modVersion}`)
      } else {
        await saveArtifact(`${pack.name}.jar`, modBuffer, process.env.MOD_DIR)
      }
    } else if (release && supportsMod) {
      warn(`⏭️ Mod ${modVersion} already exists`)
    } else if (metadata.type === "datapack" && !supportsMod) {
      warn("⏭️ Mod does not support the specified Minecraft versions")
    }
  } catch (err) {
    error(`❌ Failed to process ${pack.name}: ${err}`)
  }
}

success(`🚀 ${release ? "Release" : "Packaging"} complete`)
