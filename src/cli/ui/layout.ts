export function cols(): number {
  return Math.min((process.stdout.columns ?? 80) - 2, 90);
}

export function rule(width = cols()): string {
  return "─".repeat(Math.max(0, width));
}

export function write(text: string): void {
  process.stdout.write(text);
}

export function clearScreen(): void {
  write("\x1bc");
}

export function cursorUp(n: number): void {
  if (n > 0) write(`\x1b[${n}A`);
}

export function clearLine(): void {
  write("\x1b[2K\r");
}

export const box = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  vertical: "│",
  horizontal: "─",
  cross: "┼",
  leftCross: "├",
  rightCross: "┤",
  topCross: "┬",
  bottomCross: "┴",
};
