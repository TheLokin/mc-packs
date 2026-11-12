import { Buffer } from "node:buffer"
import fs from "node:fs/promises"
import path from "node:path"
import JSZip from "jszip"
import { error } from "../lib/console"
import { PACK_FORMATS, readPackMetadata } from "../lib/utils"

const LEGACY_THRESHOLD = { datapack: 82, resourcepack: 65 }
const FLATTEN_CONTENT_TYPES = new Set(["advancement", "recipe"])

function parseOverlayRange(directory: string) {
  const match = directory.match(/^overlay_(\d+)(?:_(\d+))?$/)

  if (!match) error(`Invalid overlay directory name: ${directory}`)

  const min = Number(match[1])
  const max = match[2] !== undefined ? Number(match[2]) : min

  return { min, max }
}

async function generateMcMeta(packPath: string) {
  const metadata = await readPackMetadata(packPath)

  const minVersion = metadata.game_versions.at(-1)!
  const maxVersion = metadata.game_versions[0]!

  const minFormat = PACK_FORMATS[minVersion]![metadata.type]!
  const maxFormat = PACK_FORMATS[maxVersion]![metadata.type]!

  const mcmeta = await fs
    .readFile(path.join(packPath, "pack.mcmeta"), "utf-8")
    .then((content) => JSON.parse(content))

  const pack: Record<string, any> = {
    description: mcmeta.pack.description,
  }

  if (minFormat < LEGACY_THRESHOLD[metadata.type]) {
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

  const result: Record<string, any> = { pack }

  if (mcmeta.overlays?.entries) {
    result.overlays = {
      entries: mcmeta.overlays.entries.map((entry: Record<string, any>) => {
        const { min, max } = parseOverlayRange(entry.directory)

        const resolved: Record<string, any> = {
          directory: entry.directory,
          min_format: min,
          max_format: max,
        }

        if (min < LEGACY_THRESHOLD[metadata.type]) {
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

function flattenNamespacePath(namespacePath: string[]) {
  const [contentType, ...contentPath] = namespacePath

  if (!contentType || !FLATTEN_CONTENT_TYPES.has(contentType) || contentPath.length === 0) {
    return namespacePath
  }

  if (contentType === "recipe") {
    return [contentType, contentPath.at(-1)!]
  }

  const [category, ...categoryPath] = contentPath

  if (!category || categoryPath.length === 0) {
    return namespacePath
  }

  if (category === "recipes") {
    const [subcategory, ...subcategoryPath] = categoryPath

    if (!subcategory || subcategoryPath.length === 0) {
      return namespacePath
    }

    return [contentType, category, subcategory, subcategoryPath.at(-1)!]
  }

  return [contentType, category, categoryPath.at(-1)!]
}

export async function zipFolder(folderPath: string) {
  const zip = new JSZip()
  const mcmeta = await generateMcMeta(folderPath)

  zip.file("pack.mcmeta", `${JSON.stringify(mcmeta, null, 2)}\n`)
  zip.file("pack.png", await fs.readFile(path.join(folderPath, "pack.png")))

  const processedPacks = new Set<string>()
  const collectedFiles: {
    path: string
    content: Buffer
    isJson: boolean
    replacements: Array<[string, string]>
  }[] = []
  const idMappings = new Map<string, string>()
  const targetNamespace = path.basename(folderPath).replace(/-/g, "_")
  const packsDirectory = path.dirname(folderPath)

  async function addPack(packPath: string) {
    if (processedPacks.has(packPath)) return
    processedPacks.add(packPath)

    const metadata = await readPackMetadata(packPath)

    for (const nestedPack of metadata.include) {
      await addPack(path.join(packsDirectory, nestedPack))
    }

    const dataPath = path.join(packPath, "data")
    const dataStat = await fs.stat(dataPath).catch(() => null)
    const namespaces = new Set<string>()

    if (dataStat?.isDirectory()) {
      for (const entry of await fs.readdir(dataPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          namespaces.add(entry.name)
        }
      }
    }

    const namespaceReplacements: Array<[string, string]> = [...namespaces]
      .filter((namespace) => namespace !== "minecraft" && namespace !== targetNamespace)
      .map((namespace): [string, string] => [`${namespace}:`, `${targetNamespace}:`])

    for (const contentDirectory of ["data", "assets"]) {
      const contentPath = path.join(packPath, contentDirectory)
      const contentStat = await fs.stat(contentPath).catch(() => null)

      if (!contentStat?.isDirectory()) continue

      async function collectFiles(directory: string) {
        const entries = await fs.readdir(directory, { withFileTypes: true })

        for (const entry of entries) {
          const filePath = path.join(directory, entry.name)

          if (entry.isDirectory()) {
            await collectFiles(filePath)
            continue
          }

          if (!entry.isFile()) continue

          const [originalNamespace, ...namespacePath] = path
            .relative(contentPath, filePath)
            .split(path.sep)

          if (!originalNamespace) continue

          let targetFileNamespace = originalNamespace
          let flattenedNamespacePath = namespacePath
          let isJson = false

          if (metadata.type === "datapack" && contentDirectory === "data") {
            targetFileNamespace =
              originalNamespace === "minecraft" ? originalNamespace : targetNamespace
            flattenedNamespacePath = flattenNamespacePath(namespacePath)
            isJson = /\.json$/i.test(entry.name)

            const originalIdPath = namespacePath
              .slice(1)
              .join("/")
              .replace(/\.json$/i, "")
            const flattenedIdPath = flattenedNamespacePath
              .slice(1)
              .join("/")
              .replace(/\.json$/i, "")

            if (isJson && originalIdPath !== flattenedIdPath) {
              const newId = `${targetFileNamespace}:${flattenedIdPath}`

              idMappings.set(`${originalNamespace}:${originalIdPath}`, newId)
              idMappings.set(`${targetFileNamespace}:${originalIdPath}`, newId)
            }
          }

          const zipFilePath = path.posix.join(
            contentDirectory,
            targetFileNamespace,
            ...flattenedNamespacePath,
          )

          collectedFiles.push({
            path: zipFilePath,
            content: await fs.readFile(filePath),
            isJson,
            replacements: namespaceReplacements,
          })
        }
      }

      await collectFiles(contentPath)
    }
  }

  await addPack(folderPath)

  for (const file of collectedFiles) {
    if (file.isJson) {
      let text = file.content.toString("utf-8")

      for (const [from, to] of file.replacements) {
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

        text = text.replace(new RegExp(`(?<![a-zA-Z0-9_./-])${escaped}`, "g"), to)
      }

      for (const [from, to] of idMappings) {
        const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

        text = text.replace(
          new RegExp(`(?<![a-zA-Z0-9_./-])${escaped}(?![a-zA-Z0-9_./-])`, "g"),
          to,
        )
      }

      file.content = Buffer.from(text)
    }

    zip.file(file.path, file.content)
  }

  return zip
}
