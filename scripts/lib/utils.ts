import fs from "node:fs/promises"
import path from "node:path"
import { getGameVersions } from "./modrinth"
import { generatePackFormats } from "./scrape"

export interface PackMetadata {
  project_id: string
  version_number: string
  changelog: string
  game_versions: string[]
}

export const readPackMetadata = (packPath: string) =>
  fs
    .readFile(path.join(packPath, "metadata.json"), "utf-8")
    .then((content) => JSON.parse(content))
    .then(
      (data) =>
        ({
          project_id: data.project_id,
          version_number: data.game_version
            ? `${data.version_number}-mc${data.game_version}`
            : data.version_number,
          changelog: data.changelog,
          game_versions: data.game_versions || [data.game_version],
        }) as PackMetadata,
    )

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
