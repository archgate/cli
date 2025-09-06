import { styleText } from "node:util";

export function logDebug(...args: Parameters<typeof console.debug>) {
  if (process.env.DEBUG) {
    const header = styleText("bgWhite", "DEBUG:");
    console.warn(header, ...args);
  }
  if (process.env.TRACE) console.trace();
}

export function logInfo(...args: Parameters<typeof console.info>) {
  console.log(styleText("bold", "info:"), ...args);
}

export function logError(...args: Parameters<typeof console.error>) {
  console.error(styleText(["red", "bold"], "error:"), ...args);
}

export function logWarn(...args: Parameters<typeof console.warn>) {
  console.warn(styleText(["yellow", "bold"], "warn:"), ...args);
}
