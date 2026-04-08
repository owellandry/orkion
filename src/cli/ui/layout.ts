export function cols(): number {
  return Math.min((process.stdout.columns ?? 80) - 2, 90);
}

export function rule(width = cols()): string {
  return "─".repeat(Math.max(0, width));
}

export function write(text: string): void {
  process.stdout.write(text);
}

export function cursorUp(n: number): void {
  write(`\x1b[${n}F`);
}

export function clearLine(): void {
  write("\x1b[2K");
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
