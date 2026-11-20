/** Shared palette: chop pads, and one colour per pattern letter so A / B / C read apart on the timeline. */
export const PAD_COLORS = ['#7c5cff', '#39c5ff', '#2ee66b', '#ffd23c', '#ff7a39', '#ff4d6d', '#c084fc', '#22d3ee']

/** Colour for a pattern named "A", "B", … ("A2" continues the cycle so it differs from "A"). */
export function patternColor(name: string): string {
  const letter = Math.max(0, name.charCodeAt(0) - 65)
  const round = Number(name.slice(1)) || 1
  return PAD_COLORS[(letter + (round - 1) * 3) % PAD_COLORS.length]
}
