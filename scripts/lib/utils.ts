import fs from "node:fs/promises"
import path from "node:path"
import { error } from "./console"
import { GAME_VERSIONS, loadPackFormats, refreshPackFormats } from "./scrape"

function parseGameVersionRange(gameVersion: string) {
  const gameVersions: string[] = []

  for (const part of gameVersion.split(",")) {
    const value = part.trim()

    if (!value) {
      error(`Invalid Minecraft version: ${value}`)
    }

    if (!value.includes("..")) {
      gameVersions.push(value)
      continue
    }

    const range = value.split("..")

    if (range.length !== 2 || !range[0]?.trim() || !range[1]?.trim()) {
      error(`Invalid Minecraft version range: ${value}`)
    }

    const [start, end] = range.map((gameVersion) => gameVersion.trim())

    const startIndex = GAME_VERSIONS.indexOf(start!)
    const endIndex = GAME_VERSIONS.indexOf(end!)

    if (startIndex === -1 || endIndex === -1) {
      gameVersions.push(start!, end!)
      continue
    }

    gameVersions.push(
      ...GAME_VERSIONS.slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1),
    )
  }

  return gameVersions
}

async function getGameVersionRange(gameVersion: string) {
  let gameVersions = parseGameVersionRange(gameVersion)

  if (gameVersions.some((version) => !GAME_VERSIONS.includes(version))) {
    await refreshPackFormats()
    gameVersions = parseGameVersionRange(gameVersion)
  }

  const missing = gameVersions.filter((version) => !GAME_VERSIONS.includes(version))

  if (missing.length) {
    error(`Unknown Minecraft version${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`)
  }

  return gameVersions
}

const MINIMUM_GAME_VERSIONS = {
  neoforge: "1.20.1",
  quilt: "1.14",
  fabric: "1.14",
  forge: "1.14",
  datapack: "1.13",
  resourcepack: "1.7",
} as const

export function supportsGameVersions(
  gameVersions: string[],
  type: keyof typeof MINIMUM_GAME_VERSIONS,
) {
  const index = GAME_VERSIONS.indexOf(MINIMUM_GAME_VERSIONS[type])

  return gameVersions.some((gameVersion) => {
    const cutoffIndex = GAME_VERSIONS.indexOf(gameVersion)

    return cutoffIndex !== -1 && cutoffIndex <= index
  })
}

export async function readPackMetadata(packPath: string) {
  const metadata = await fs
    .readFile(path.join(packPath, "metadata.json"), "utf-8")
    .then((content) => JSON.parse(content))

  const isAlpha = metadata.version_number.includes("-alpha")
  const isBeta = metadata.version_number.includes("-beta")

  const changelog = await fs
    .readFile(path.join(packPath, "CHANGELOG.md"), "utf-8")
    .then((content) =>
      content.replace(/\$\{(\w+)\}/g, (_, key) =>
        metadata[key] != null ? String(metadata[key]) : `\${${key}}`,
      ),
    )

  const gameVersions = await getGameVersionRange(metadata.game_version)

  return {
    project_id: metadata.project_id as string,
    type: metadata.type as "datapack" | "resourcepack",
    version_number: `${metadata.version_number}-mc${metadata.game_version}`,
    version_type: isAlpha ? ("alpha" as const) : isBeta ? ("beta" as const) : ("release" as const),
    changelog,
    game_versions: gameVersions,
    loaders: (["fabric", "forge", "neoforge", "quilt"] as const).filter((loader) =>
      supportsGameVersions(gameVersions, loader),
    ),
    include: new Set<string>(metadata.include || []),
  }
}

export async function getPackFormat(gameVersion: string) {
  let packFormats = await loadPackFormats()

  if (!packFormats[gameVersion]) {
    packFormats = await refreshPackFormats()
  }

  const packFormat = packFormats[gameVersion]

  if (!packFormat) {
    error(`Unknown Minecraft version: ${gameVersion}`)
  }

  return {
    datapack: packFormat.datapack,
    resourcepack: packFormat.resourcepack,
  }
}

export function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}
