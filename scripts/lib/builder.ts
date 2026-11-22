import type { Buffer } from "node:buffer"

export interface PackBuilder {
  file: (path: string, content: string | Buffer) => void
  pack: (packName: string) => Promise<void>
}
