import type { PackBuilder } from "../lib/builder"
import { Buffer } from "node:buffer"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import JSZip from "jszip"
import { error } from "../lib/console"
import { getPackFormat, readPackMetadata } from "../lib/utils"

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

  const minFormat = await getPackFormat(minVersion).then((format) => format[metadata.type]!)
  const maxFormat = await getPackFormat(maxVersion).then((format) => format[metadata.type]!)

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

function replaceJsonReferences(
  content: Buffer,
  replacements: Array<[string, string]>,
  mappings: Map<string, string>,
) {
  let text = content.toString("utf-8")

  for (const [from, to] of replacements) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

    text = text.replace(new RegExp(`(?<![a-zA-Z0-9_./-])${escaped}`, "g"), to)
  }

  for (const [from, to] of mappings) {
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

    text = text.replace(new RegExp(`(?<![a-zA-Z0-9_./-])${escaped}(?![a-zA-Z0-9_./-])`, "g"), to)
  }

  return Buffer.from(text)
}

export async function bundleZip(packPath: string) {
  const zip = new JSZip()
  const mcmeta = await generateMcMeta(packPath)

  zip.file("pack.mcmeta", `${JSON.stringify(mcmeta, null, 2)}\n`)
  zip.file("pack.png", await fs.readFile(path.join(packPath, "pack.png")))

  const creditsPath = path.join(packPath, "credits.txt")
  const creditsStat = await fs.stat(creditsPath).catch(() => null)

  if (creditsStat?.isFile()) {
    zip.file("credits.txt", await fs.readFile(creditsPath))
  }

  const packName = path.basename(packPath)
  const targetNamespace = packName.replace(/-/g, "_")
  const processedPacks = new Set<string>()
  const collectedFiles: {
    path: string
    content: Buffer
    isJson: boolean
    replacements: Array<[string, string]>
  }[] = []
  const mappings = new Map<string, string>()

  async function addPack(packName: string) {
    if (processedPacks.has(packName)) return
    processedPacks.add(packName)

    const packPath = path.join("packs", packName)
    const dataPath = path.join(packPath, "data")
    const dataStat = await fs.stat(dataPath).catch(() => null)

    const namespaces: string[] = []

    if (dataStat?.isDirectory()) {
      for (const entry of await fs.readdir(dataPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          namespaces.push(entry.name)
        }
      }
    }

    const namespaceReplacements: Array<[string, string]> = namespaces
      .filter((namespace) => namespace !== "minecraft" && namespace !== targetNamespace)
      .map((namespace) => [`${namespace}:`, `${targetNamespace}:`])

    for (const contentDirectory of ["data", "assets"]) {
      const contentPath = path.join(packPath, contentDirectory)
      const contentStat = await fs.stat(contentPath).catch(() => null)

      if (!contentStat?.isDirectory()) continue

      async function collectFile(directory: string) {
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
          const filePath = path.join(directory, entry.name)

          if (entry.isDirectory()) {
            await collectFile(filePath)
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

          if (contentDirectory === "data") {
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

              mappings.set(`${originalNamespace}:${originalIdPath}`, newId)
              mappings.set(`${targetFileNamespace}:${originalIdPath}`, newId)
            }
          }

          collectedFiles.push({
            path: path.posix.join(contentDirectory, targetFileNamespace, ...flattenedNamespacePath),
            content: await fs.readFile(filePath),
            isJson,
            replacements: namespaceReplacements,
          })
        }
      }

      await collectFile(contentPath)
    }

    const buildPath = path.join(packPath, "build.ts")
    const buildStat = await fs.stat(buildPath).catch(() => null)

    if (buildStat?.isFile()) {
      const { default: build } = await import(pathToFileURL(buildPath).href)

      const builder: PackBuilder = {
        file(filePath, content) {
          const normalizedPath = path.posix.normalize(filePath.replace(/\\/g, "/"))

          collectedFiles.push({
            path: normalizedPath,
            content: Buffer.isBuffer(content) ? content : Buffer.from(content),
            isJson: /^data\/.*\.json$/i.test(normalizedPath),
            replacements: namespaceReplacements,
          })
        },
        pack: addPack,
      }

      await build(builder)
    }
  }

  await addPack(packName)

  for (const file of collectedFiles) {
    if (file.isJson) {
      file.content = replaceJsonReferences(file.content, file.replacements, mappings)
    }

    zip.file(file.path, file.content)
  }

  return zip
}
