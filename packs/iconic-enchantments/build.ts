import type { PackBuilder } from "../../scripts/lib/builder"
import { Buffer } from "node:buffer"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"

type Enchantment = keyof typeof ENCHANTMENT_MAX_LEVELS

interface EnchantmentCase {
  enchantment: Enchantment
  level: number
  impossible: boolean
}

const ENCHANTMENT_MAX_LEVELS = {
  aqua_affinity: 1,
  bane_of_arthropods: 5,
  blast_protection: 4,
  breach: 4,
  channeling: 1,
  // cleaving: 3, // Experimental axe enchantment introduced in Combat Test development versions
  binding_curse: 1,
  density: 5,
  depth_strider: 3,
  efficiency: 5,
  feather_falling: 4,
  fire_aspect: 2,
  fire_protection: 4,
  flame: 1,
  fortune: 3,
  frost_walker: 2,
  impaling: 5,
  infinity: 1,
  knockback: 2,
  looting: 3,
  loyalty: 3,
  luck_of_the_sea: 3,
  lunge: 3,
  lure: 3,
  mending: 1,
  multishot: 1,
  piercing: 4,
  power: 5,
  projectile_protection: 4,
  protection: 4,
  punch: 2,
  quick_charge: 3,
  respiration: 3,
  riptide: 3,
  sharpness: 5,
  silk_touch: 1,
  smite: 5,
  soul_speed: 3,
  sweeping_edge: 3,
  swift_sneak: 3,
  thorns: 3,
  unbreaking: 3,
  vanishing_curse: 1,
  wind_burst: 3,
}

const ENCHANTMENTS = Object.keys(ENCHANTMENT_MAX_LEVELS) as Enchantment[]

const IMPORTANT_ENCHANTMENTS = new Set<Enchantment>([
  "binding_curse",
  "vanishing_curse",
])

const LANG_TEMPLATE_DIR = path.join(import.meta.dirname, "templates", "lang")
const BOOKS_TEMPLATE_DIR = path.join(import.meta.dirname, "templates", "books")
const ENCHANTMENTS_TEMPLATE_DIR = path.join(import.meta.dirname, "templates", "enchantments")

const MINECRAFT_FONT_DIR = path.posix.join("assets", "minecraft", "font")
const MINECRAFT_LANG_DIR = path.posix.join("assets", "minecraft", "lang")
const MINECRAFT_ITEMS_DIR = path.posix.join("assets", "minecraft", "items")
const MINECRAFT_MODELS_DIR = path.posix.join("assets", "minecraft", "models")
const MINECRAFT_TEXTURES_DIR = path.posix.join("assets", "minecraft", "textures")

class Image {
  readonly data: Buffer
  readonly width: number
  readonly height: number

  private constructor(data: Buffer, width: number, height: number) {
    this.data = data
    this.width = width
    this.height = height
  }

  static async fromFile(filePath: string) {
    const { data, info } = await sharp(filePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    return new Image(data, info.width, info.height)
  }

  tint(colors: string | Record<string, string>) {
    const data = Buffer.from(this.data)

    const replacements =
      typeof colors === "string"
        ? undefined
        : new Map(
            Object.entries(colors).map(([from, to]) => {
              const source = Image.hexToRgb(from)
              const target = Image.hexToRgb(to)

              return [
                (source.r << 16) | (source.g << 8) | source.b,
                target,
              ]
            }),
          )

    const shadow = typeof colors === "string" ? Image.hexToRgb(colors) : undefined

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) continue

      if (shadow) {
        data[i] = shadow.r
        data[i + 1] = shadow.g
        data[i + 2] = shadow.b
        continue
      }

      const color = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!

      const replacement = replacements!.get(color)

      if (!replacement) continue

      data[i] = replacement.r
      data[i + 1] = replacement.g
      data[i + 2] = replacement.b
    }

    return new Image(data, this.width, this.height)
  }

  async composite(image: Image, left = 0, top = 0) {
    const { data, info } = await sharp(this.data, {
      raw: {
        width: this.width,
        height: this.height,
        channels: 4,
      },
    })
      .composite([
        {
          input: image.data,
          raw: {
            width: image.width,
            height: image.height,
            channels: 4,
          },
          left,
          top,
        },
      ])
      .raw()
      .toBuffer({ resolveWithObject: true })

    return new Image(data, info.width, info.height)
  }

  async toPng() {
    return sharp(this.data, {
      raw: {
        width: this.width,
        height: this.height,
        channels: 4,
      },
    })
      .png()
      .toBuffer()
  }

  private static hexToRgb(hex: string) {
    const value = hex.replace("#", "")

    return {
      r: Number.parseInt(value.slice(0, 2), 16),
      g: Number.parseInt(value.slice(2, 4), 16),
      b: Number.parseInt(value.slice(4, 6), 16),
    }
  }
}

async function addEnchantmentTooltips(builder: PackBuilder) {
  const enchantments = ENCHANTMENTS.map((enchantment, index) => ({
    enchantment,
    character: String.fromCodePoint(0xe000 + index),
    key: `enchantment.minecraft.${enchantment}`,
  }))

  for (const filename of await fs.readdir(LANG_TEMPLATE_DIR)) {
    const translations = await fs
      .readFile(path.join(LANG_TEMPLATE_DIR, filename), "utf8")
      .then((content) => JSON.parse(content))

    const enchantmentTranslations = Object.fromEntries(
      enchantments.map(({ key, character }) => [
        key,
        `\u00A7f${character}\u00A7r ${translations[key]}`,
      ]),
    )

    builder.file(
      path.posix.join(MINECRAFT_LANG_DIR, filename),
      `${JSON.stringify(enchantmentTranslations, null, 2)}\n`,
    )
  }

  const providers = []

  for (const { enchantment, character } of enchantments) {
    const defaultPath = path.join(ENCHANTMENTS_TEMPLATE_DIR, `${enchantment}.png`)
    const altPath = path.join(ENCHANTMENTS_TEMPLATE_DIR, "alt", `${enchantment}.png`)

    const imagePath = await fs
      .access(altPath)
      .then(() => altPath)
      .catch(() => defaultPath)

    const image = await Image.fromFile(imagePath)

    providers.push({
      type: "bitmap",
      file: `minecraft:font/${enchantment}.png`,
      ascent: image.height,
      height: image.height,
      chars: [character],
    })

    builder.file(
      path.posix.join(MINECRAFT_TEXTURES_DIR, "font", `${enchantment}.png`),
      await image.toPng(),
    )
  }

  builder.file(
    path.posix.join(MINECRAFT_FONT_DIR, "default.json"),
    `${JSON.stringify({ providers }, null, 2)}\n`,
  )
}

async function addBookTextures(
  builder: PackBuilder,
  enchantment: Enchantment,
  templateSuffix: string,
  outputSuffix: string,
  shadowImage: Image,
  iconImage: Image,
) {
  const bookVariants = [
    {
      template: `base_level_${templateSuffix}.png`,
      destination: path.posix.join(
        MINECRAFT_TEXTURES_DIR,
        "item",
        `enchantment_book_${enchantment}_${outputSuffix}.png`,
      ),
    },
    {
      template: `base_thick_level_${templateSuffix}.png`,
      destination: path.posix.join(
        MINECRAFT_TEXTURES_DIR,
        "item",
        `enchantment_book_${enchantment}_thick_${outputSuffix}.png`,
      ),
    },
  ]

  await Promise.all(
    bookVariants.map(async ({ template, destination }) => {
      const templatePath = path.join(BOOKS_TEMPLATE_DIR, template)

      const buffer = await Image.fromFile(templatePath)
        .then((image) => image.composite(shadowImage, 8, 1))
        .then((image) => image.composite(iconImage, 8, 0))
        .then((image) => image.toPng())

      builder.file(destination, buffer)
    }),
  )
}

function addBookModels(builder: PackBuilder, enchantment: Enchantment, suffix: string) {
  const bookVariants = [
    `enchantment_book_${enchantment}_${suffix}`,
    `enchantment_book_${enchantment}_thick_${suffix}`,
  ]

  for (const bookVariant of bookVariants) {
    const model = {
      parent: "minecraft:item/generated",
      textures: {
        layer0: `minecraft:item/${bookVariant}`,
      },
    }

    builder.file(
      path.posix.join(MINECRAFT_MODELS_DIR, "item", `${bookVariant}.json`),
      `${JSON.stringify(model, null, 2)}\n`,
    )
  }
}

function getEnchantmentCases() {
  const importantCases: EnchantmentCase[] = []
  const remainingCases: EnchantmentCase[] = []

  for (const enchantment of ENCHANTMENTS) {
    const maxLevel = ENCHANTMENT_MAX_LEVELS[enchantment]

    const targetCases = IMPORTANT_ENCHANTMENTS.has(enchantment) ? importantCases : remainingCases

    targetCases.push({
      enchantment,
      level: maxLevel + 1,
      impossible: true,
    })

    for (let level = maxLevel; level >= 1; level--) {
      targetCases.push({
        enchantment,
        level,
        impossible: false,
      })
    }
  }

  remainingCases.sort((a, b) => Number(b.impossible) - Number(a.impossible) || b.level - a.level)

  return [...importantCases, ...remainingCases]
}

function addEnchantmentBookStates(builder: PackBuilder) {
  const itemDefinition = {
    model: {},
  }

  let current = itemDefinition.model

  for (const { enchantment, level, impossible } of getEnchantmentCases()) {
    const suffix = impossible ? "impossible" : level.toString()

    const otherEnchantments = ENCHANTMENTS.filter(
      (otherEnchantment) => otherEnchantment !== enchantment,
    ).map((otherEnchantment) => `minecraft:${otherEnchantment}`)

    const modelSelector = {
      type: "minecraft:condition",
      property: "minecraft:component",
      predicate: "minecraft:stored_enchantments",
      value: [
        {
          enchantments: otherEnchantments,
        },
      ],
      on_true: {
        type: "minecraft:model",
        model: `minecraft:item/enchantment_book_${enchantment}_thick_${suffix}`,
      },
      on_false: {
        type: "minecraft:model",
        model: `minecraft:item/enchantment_book_${enchantment}_${suffix}`,
      },
    }

    const condition = {
      type: "minecraft:condition",
      property: "minecraft:component",
      predicate: "minecraft:stored_enchantments",
      value: [
        {
          enchantments: `minecraft:${enchantment}`,
          levels: impossible ? { min: level } : level,
        },
      ],
      on_true: modelSelector,
      on_false: {},
    }

    const nextCondition = {}

    condition.on_false = nextCondition

    Object.assign(current, condition)

    current = nextCondition
  }

  Object.assign(current, {
    type: "minecraft:model",
    model: "minecraft:item/enchanted_book",
  })

  builder.file(
    path.posix.join(MINECRAFT_ITEMS_DIR, "enchanted_book.json"),
    `${JSON.stringify(itemDefinition, null, 2)}\n`,
  )
}

async function addEnchantmentBooks(builder: PackBuilder) {
  for (const [enchantment, maxLevel] of Object.entries(ENCHANTMENT_MAX_LEVELS) as [
    Enchantment,
    number,
  ][]) {
    const imagePath = path.join(ENCHANTMENTS_TEMPLATE_DIR, `${enchantment}.png`)

    const image = await Image.fromFile(imagePath)
    const shadowImage = image.tint("#312104")
    const iconImage = image.tint({
      "#999999": "#c1ab5a",
      "#6b6b6b": "#957f2d",
      "#585858": "#522e10",
    })

    for (let level = 1; level <= maxLevel; level++) {
      const templateSuffix = level === maxLevel ? "max" : level.toString()
      const outputSuffix = level.toString()

      await addBookTextures(
        builder,
        enchantment,
        templateSuffix,
        outputSuffix,
        shadowImage,
        iconImage,
      )

      addBookModels(builder, enchantment, outputSuffix)
    }

    await addBookTextures(builder, enchantment, "impossible", "impossible", shadowImage, iconImage)

    addBookModels(builder, enchantment, "impossible")
  }

  addEnchantmentBookStates(builder)
}

export default async function build(builder: PackBuilder, buildId?: string) {
  if (buildId !== "nt") {
    await addEnchantmentTooltips(builder)
  }
  if (buildId !== "tt") {
    await addEnchantmentBooks(builder)
  }
}
