import fs from "node:fs/promises"
import path from "node:path"
import { getGameVersions } from "./modrinth"
import { generatePackFormats } from "./scrape"

export interface PackMetadata {
  project_id: string
  type: "datapack" | "resourcepack"
  version_number: string
  version_type: "release" | "beta" | "alpha"
  changelog: string
  game_versions: string[]
  include: Set<string>
}

export async function readPackMetadata(packPath: string) {
  const data = await fs
    .readFile(path.join(packPath, "metadata.json"), "utf-8")
    .then((content) => JSON.parse(content))

  const isAlpha = data.version_number.includes("-alpha")
  const isBeta = data.version_number.includes("-beta")

  return {
    project_id: data.project_id,
    type: data.type,
    version_number: data.game_version
      ? `${data.version_number}-mc${data.game_version}`
      : data.version_number,
    version_type: isAlpha ? "alpha" : isBeta ? "beta" : "release",
    changelog: await fs.readFile(path.join(packPath, "CHANGELOG.md"), "utf-8"),
    game_versions: data.game_versions || [data.game_version],
    include: new Set<string>(data.include || []),
  } as PackMetadata
}

export const ALL_GAME_VERSIONS = await getGameVersions().then((gameVersions) =>
  gameVersions
    .filter(
      ({ version }) =>
        /^\d+(?:\.\d+){0,2}$/.test(version) ||
        /^\d{2}w\d{2}[a-z]$/i.test(version) ||
        /^\d{2}\.\d+(?:\.\d+)?-(?:snapshot|rc|pre)-\d+$/i.test(version) ||
        /^\d+(?:\.\d+){0,2}-(?:rc|pre)\d+$/i.test(version),
    )
    .map(({ version }) => version),
)

export interface PackFormat {
  datapack: number | null
  resourcepack: number | null
}

export const PACK_FORMATS: Record<string, PackFormat> = await fs
  .readFile("packs/pack-formats.json", "utf-8")
  .then((content) => JSON.parse(content))
  .catch(() =>
    generatePackFormats()
      .then(() => fs.readFile("packs/pack-formats.json", "utf-8"))
      .then((content) => JSON.parse(content)),
  )
