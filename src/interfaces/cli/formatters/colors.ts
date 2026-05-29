const enabled = process.env.NO_COLOR !== '1';

function wrap(code: number, value: string): string {
  if (!enabled) {
    return value;
  }
  return `\u001b[${code}m${value}\u001b[0m`;
}

export const colors = {
  green: (value: string) => wrap(32, value),
  yellow: (value: string) => wrap(33, value),
  red: (value: string) => wrap(31, value),
  cyan: (value: string) => wrap(36, value),
  gray: (value: string) => wrap(90, value),
  bold: (value: string) => wrap(1, value),
  dim: (value: string) => wrap(2, value)
};

export function colorRisk(tier: string, value: string): string {
  if (tier === 'low') {
    return colors.green(value);
  }
  if (tier === 'medium') {
    return colors.yellow(value);
  }
  return colors.red(value);
}
