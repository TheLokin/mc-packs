import type { PackFormat } from "./lib/utils"
import fs from "node:fs/promises"
import * as cheerio from "cheerio"
import { ALL_GAME_VERSIONS, PACK_FORMATS } from "./lib/utils"

const BASE_URL = "https://minecraft.wiki"
const USER_AGENT = "mc-packs/1.0 (github.com/TheLokin/mc-packs)"

async function minecraftWikiFetch(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { "User-Agent": USER_AGENT },
  })

  if (!response.ok) {
    throw new Error(`Minecraft Wiki error ${response.status}: ${path}`)
  }

  return response.text()
}

function parseFormatValue(value: string) {
  const normalized = value.trim()

  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)

  return Number.isFinite(parsed) ? parsed : null
}

function parsePackFormats(html: string) {
  const $ = cheerio.load(html)

  let datapack: number | null = null
  let resourcepack: number | null = null

  $("table tr").each((_, row) => {
    const label = $(row).find("th").text().trim().toLowerCase()
    const value = $(row).find("td").text().trim()

    if (label.includes("data pack")) {
      datapack = parseFormatValue(value)
    }

    if (label.includes("resource pack")) {
      resourcepack = parseFormatValue(value)
    }
  })

  return { datapack, resourcepack } as PackFormat
}

console.log("▶ Starting scraping...")

const newPackFormats: Record<string, PackFormat> = {}

for (const gameVersion of ALL_GAME_VERSIONS) {
  if (PACK_FORMATS[gameVersion]) {
    newPackFormats[gameVersion] = PACK_FORMATS[gameVersion]
    continue
  }

  console.log(`↓ Fetching Minecraft ${gameVersion}...`)

  const html = await minecraftWikiFetch(`/w/Java_Edition_${gameVersion}`)

  newPackFormats[gameVersion] = parsePackFormats(html)
}

await fs.writeFile(
  "packs/pack-formats.json",
  `${JSON.stringify(newPackFormats, null, 2)}\n`,
  "utf-8",
)

console.log("✓ Scraping complete.")
