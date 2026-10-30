import process from "node:process"

const colors = {
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  gray: "\x1B[90m",
  reset: "\x1B[0m",
}

export function info(message: string) {
  console.log(`${colors.gray}${message}${colors.reset}`)
}

export function success(message: string) {
  console.log(`${colors.green}${message}${colors.reset}`)
}

export function warn(message: string) {
  console.log(`${colors.yellow}${message}${colors.reset}`)
}

export function error(message: string) {
  console.error(`${colors.red}${message}${colors.reset}`)
  process.exit(0)
}
