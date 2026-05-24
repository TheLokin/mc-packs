import fs from "node:fs/promises"
import * as cheerio from "cheerio"
import { ALL_GAME_VERSIONS, PACK_FORMATS } from "./constants"

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

function parsePackFormats(html: string) {
  const $ = cheerio.load(html)
  let resourcePackFormat: number | null = null
  let dataPackFormat: number | null = null

  $("table tr").each((_, row) => {
    const label = $(row).find("th").text().trim().toLowerCase()
    const value = $(row).find("td").text().trim()

    if (label.includes("data pack")) dataPackFormat = Number(value)
    if (label.includes("resource pack")) resourcePackFormat = Number(value)
  })

  return {
    dataPackFormat,
    resourcePackFormat,
  }
}

async function main() {
  console.log("▶ Starting scraping...")

  const newPackFormats: typeof PACK_FORMATS = {}
  for (const gameVersion of ALL_GAME_VERSIONS) {
    if (PACK_FORMATS[gameVersion]) {
      newPackFormats[gameVersion] = PACK_FORMATS[gameVersion]
      continue
    }

    console.log(`↓ Fetching Minecraft ${gameVersion}...`)

    const html = await minecraftWikiFetch(`/w/Java_Edition_${gameVersion}`)
    const formats = parsePackFormats(html)

    newPackFormats[gameVersion] = {
      datapack: formats.dataPackFormat,
      resourcepack: formats.resourcePackFormat,
    }
  }

  await fs.writeFile(
    "packs/pack-formats.json",
    `${JSON.stringify(newPackFormats, null, 2)}\n`,
    "utf-8",
  )

  console.log("✓ Scraping complete.")
}

main()
