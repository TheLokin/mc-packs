import type { PackMetadata } from "../lib/utils"
import fs from "node:fs/promises"
import path from "node:path"
import JSZip from "jszip"
import { PACK_FORMATS } from "../lib/utils"

const EXCLUDED_FILES = new Set(["pack.mcmeta", "metadata.json", "README.md"])
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
