import fs from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import JSZip from "jszip"
import { PACK_FORMATS } from "./constants"
import { createProjectVersion, getProject, getProjectMembers, getProjectVersions } from "./modrinth"
import { packageDatapack } from "./package"

const EXCLUDED_FILES = new Set(["pack.mcmeta", "modrinth.json", "README.md"])
const LEGACY_THRESHOLD = { datapack: 82, resourcepack: 65 }

function parseOverlayRange(directory: string) {
  const match = directory.match(/^overlay_(\d+)(?:_(\d+))?$/)
  if (!match) throw new Error(`Invalid overlay directory name: ${directory}`)

  const min = Number(match[1])
  const max = match[2] !== undefined ? Number(match[2]) : min

  return { min, max }
}

async function generateMcMeta(folderPath: string, packType: "datapack" | "resourcepack") {
  const modrinth = await fs
    .readFile(path.join(folderPath, "modrinth.json"), "utf-8")
    .then((content) => JSON.parse(content))

  const minVersion = modrinth.game_versions[modrinth.game_versions.length - 1]
  const maxVersion = modrinth.game_versions[0]

  const minFormat = PACK_FORMATS[minVersion][packType]
  const maxFormat = PACK_FORMATS[maxVersion][packType]

  const hasLegacy = minFormat < LEGACY_THRESHOLD[packType]

  const mcmeta = await fs
    .readFile(path.join(folderPath, "pack.mcmeta"), "utf-8")
    .then((content) => JSON.parse(content))

  const pack: Record<string, unknown> = { description: mcmeta.pack.description }

  if (hasLegacy) {
    pack.pack_format = minFormat
    pack.min_format = minFormat
    pack.max_format = maxFormat
    pack.supported_formats = {
      min_inclusive: minFormat,
      max_inclusive: maxFormat,
    }
  } else {
    pack.min_format = minFormat
    pack.max_format = maxFormat
  }

  const result: Record<string, unknown> = { pack }

  if (mcmeta.overlays?.entries) {
    result.overlays = {
      entries: mcmeta.overlays.entries.map((entry: Record<string, unknown>) => {
        const { min, max } = parseOverlayRange(entry.directory as string)
        const resolved: Record<string, unknown> = {
          directory: entry.directory,
          min_format: min,
          max_format: max,
        }

        if (min < LEGACY_THRESHOLD[packType]) {
          resolved.formats = {
            min_inclusive: min,
            max_inclusive: max,
          }
        }

        return resolved
      }),
    }
  }

  return result
}

async function zipFolder(folderPath: string, packType: "datapack" | "resourcepack") {
  const zip = new JSZip()

  const mcmeta = await generateMcMeta(folderPath, packType)
  zip.file("pack.mcmeta", `${JSON.stringify(mcmeta, null, 2)}\n`)

  async function collect(currentPath: string) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)

      if (entry.isDirectory()) {
        await collect(fullPath)
      } else if (entry.isFile() && !EXCLUDED_FILES.has(entry.name)) {
        zip.file(
          path.relative(folderPath, fullPath).replace(/\\/g, "/"),
          await fs.readFile(fullPath),
        )
      }
    }
  }

  await collect(folderPath)

  return zip
}

async function main() {
  const packsDir = path.resolve(process.cwd(), "packs")
  const entries = await fs.readdir(packsDir, { withFileTypes: true })
  const packFolders = entries.filter((entry) => entry.isDirectory())

  for (const packFolder of packFolders) {
    console.log(`📦 Packaging: ${packFolder.name}`)

    const packPath = path.join(packsDir, packFolder.name)
    const modrinthPath = path.join(packPath, "modrinth.json")

    const modrinth = await fs.readFile(modrinthPath, "utf-8").then((content) => JSON.parse(content))
    const versions = await getProjectVersions(modrinth.project_id).then((versions) =>
      versions.map((version) => version.version_number),
    )

    if (versions.includes(modrinth.version_number)) {
      console.log(`⚠️ Skipping version ${modrinth.version_number}`)
      continue
    }

    console.log(`🚀 Releasing version ${modrinth.version_number}`)

    const project = await getProject(modrinth.project_id)
    const members = await getProjectMembers(modrinth.project_id)

    const zipDatapack = await zipFolder(packPath, "datapack")
    const blobDatapack = await zipDatapack.generateAsync({
      type: "blob",
      mimeType: "application/zip",
    })

    await createProjectVersion({
      project_id: modrinth.project_id,
      name: `${project.title} v${modrinth.version_number}`,
      version_number: modrinth.version_number,
      changelog: modrinth.changelog,
      game_versions: modrinth.game_versions,
      version_type: "release",
      loaders: ["datapack"],
      file: {
        name: `${project.slug}-v${modrinth.version_number}.zip`,
        data: blobDatapack,
      },
    })

    const zipMod = await packageDatapack({
      zip: zipDatapack,
      project,
      members,
      versionNumber: modrinth.version_number,
      gameVersions: modrinth.game_versions,
      loaders: ["fabric", "quilt", "forge", "neoforge"],
    })
    const blobMod = await zipMod.generateAsync({
      type: "blob",
      mimeType: "application/java-archive",
    })

    await createProjectVersion({
      project_id: modrinth.project_id,
      name: `${project.title} v${modrinth.version_number}`,
      version_number: `${modrinth.version_number}+mod`,
      changelog: modrinth.changelog,
      game_versions: modrinth.game_versions,
      version_type: "release",
      loaders: ["fabric", "quilt", "forge", "neoforge"],
      environment: "server_only",
      file: {
        name: `${project.slug}-v${modrinth.version_number}.jar`,
        data: blobMod,
      },
    })
  }
}

main()
