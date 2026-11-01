import type { PackMetadata } from "../lib/utils"
import { Buffer } from "node:buffer"
import fs from "node:fs/promises"
import path from "node:path"
import JSZip from "jszip"
import { PACK_FORMATS, readPackMetadata } from "../lib/utils"

const LEGACY_THRESHOLD = { datapack: 82, resourcepack: 65 }

function parseOverlayRange(directory: string) {
  const match = directory.match(/^overlay_(\d+)(?:_(\d+))?$/)

  if (!match) {
    throw new Error(`Invalid overlay directory name: ${directory}`)
  }

  const min = Number(match[1])
  const max = match[2] !== undefined ? Number(match[2]) : min

  return { min, max }
}

async function generateMcMeta(
  metadata: PackMetadata,
  folderPath: string,
  type: "datapack" | "resourcepack",
) {
  const minVersion = metadata.game_versions.at(-1)!
  const maxVersion = metadata.game_versions[0]!

  const minFormat = PACK_FORMATS[minVersion]![type]!
  const maxFormat = PACK_FORMATS[maxVersion]![type]!

  const mcmeta = await fs
    .readFile(path.join(folderPath, "pack.mcmeta"), "utf-8")
    .then((content) => JSON.parse(content))

  const pack: Record<string, any> = {
    description: mcmeta.pack.description,
  }

  if (minFormat < LEGACY_THRESHOLD[type]) {
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

  const result: Record<string, any> = {
    pack,
  }

  if (mcmeta.overlays?.entries) {
    result.overlays = {
      entries: mcmeta.overlays.entries.map((entry: Record<string, any>) => {
        const { min, max } = parseOverlayRange(entry.directory)

        const resolved: Record<string, any> = {
          directory: entry.directory,
          min_format: min,
          max_format: max,
        }

        if (min < LEGACY_THRESHOLD[type]) {
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

export async function zipFolder(
  metadata: PackMetadata,
  folderPath: string,
  type: "datapack" | "resourcepack",
) {
  const zip = new JSZip()
  const mcmeta = await generateMcMeta(metadata, folderPath, type)

  zip.file("pack.mcmeta", `${JSON.stringify(mcmeta, null, 2)}\n`)
  zip.file("pack.png", await fs.readFile(path.join(folderPath, "pack.png")))

  const processedPacks = new Set<string>()
  const targetNamespace = path.basename(folderPath).replace(/-/g, "_")
  const packsDirectory = path.dirname(folderPath)

  async function addPack(packPath: string) {
    if (processedPacks.has(packPath)) return
    processedPacks.add(packPath)

    const packMetadata = await readPackMetadata(packPath)

    for (const pack of packMetadata.include) {
      await addPack(path.join(packsDirectory, pack))
    }

    const dataDirectory = path.join(packPath, "data")

    async function collectFiles(directory: string) {
      const entries = await fs.readdir(directory, { withFileTypes: true })

      for (const entry of entries) {
        const filePath = path.join(directory, entry.name)

        if (entry.isDirectory()) {
          await collectFiles(filePath)
          continue
        }

        if (!entry.isFile()) continue

        const relativePath = path.relative(dataDirectory, filePath)
        const [originalNamespace, ...namespacePath] = relativePath.split(path.sep)

        if (!originalNamespace) continue

        const zipPath = path.posix.join("data", targetNamespace, ...namespacePath)

        let fileContent = await fs.readFile(filePath)

        if (/\.(?:json|mcfunction)$/i.test(entry.name)) {
          fileContent = Buffer.from(
            fileContent
              .toString("utf-8")
              .replace(new RegExp(`\\b${originalNamespace}:`, "g"), `${targetNamespace}:`),
          )
        }

        zip.file(zipPath, fileContent)
      }
    }

    await collectFiles(dataDirectory)
  }

  await addPack(folderPath)

  return zip
}
