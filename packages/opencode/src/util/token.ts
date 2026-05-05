const CHARS_PER_TOKEN = 4

function estimate(input: string) {
  return Math.max(0, Math.round((input || "").length / CHARS_PER_TOKEN))
}

export const Token = {
  estimate,
}
