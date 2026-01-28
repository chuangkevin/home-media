/**
 * 簡體中文轉繁體中文工具
 * 使用 opencc-js 進行轉換
 */

import * as OpenCC from 'opencc-js';

// 建立轉換器：簡體中文 (cn) -> 繁體中文台灣標準 (twp)
// twp = 台灣繁體 + 台灣用語（例如：軟件 -> 軟體）
const converter = OpenCC.Converter({ from: 'cn', to: 'twp' });

/**
 * 將簡體中文轉換為繁體中文（台灣標準）
 * @param text 要轉換的文字
 * @returns 轉換後的繁體中文
 */
export function toTraditional(text: string): string {
  if (!text) return text;
  return converter(text);
}

/**
 * 批次轉換多行文字
 * @param lines 文字陣列
 * @returns 轉換後的文字陣列
 */
export function toTraditionalLines(lines: string[]): string[] {
  return lines.map(line => toTraditional(line));
}

export default { toTraditional, toTraditionalLines };
