/**
 * fileParser.ts
 * Shared utility for parsing answer-key files (.json, .docx, .xlsx, .csv, .txt).
 *
 * Previously duplicated between AdminDashboard.tsx and TeacherDashboard.tsx.
 * Now lives here as a single source of truth.
 */
import * as xlsx from 'xlsx';
import mammoth from 'mammoth';
import { postJson } from './api';

export interface ParsedKeyResult {
  /** testCode inferred from filename (without extension) */
  testCode: string;
  /** Answer key dict { questionNumber: answer } or null if parsing failed */
  keyDict: Record<string, string> | null;
  /** Human-readable error if parsing failed */
  error?: string;
}

/**
 * Extract raw text from a supported file type.
 * Supports: .json, .docx, .xlsx, .csv, .txt
 */
async function extractRawText(file: File): Promise<{ json?: any; rawText?: string }> {
  const name = file.name.toLowerCase();

  if (name.endsWith('.json')) {
    const text = await file.text();
    return { json: JSON.parse(text) };
  }

  if (name.endsWith('.docx')) {
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    return { rawText: result.value };
  }

  if (name.endsWith('.xlsx')) {
    const arrayBuffer = await file.arrayBuffer();
    const workbook = xlsx.read(arrayBuffer, { type: 'array' });
    let rawText = '';
    Object.keys(workbook.Sheets).forEach((sheetName) => {
      rawText += xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName]) + '\n';
    });
    return { rawText };
  }

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return { rawText: await file.text() };
  }

  throw new Error(`Định dạng file không được hỗ trợ: ${file.name}`);
}

/**
 * Parse a single answer-key file.
 * - If JSON: uses the parsed object directly.
 * - Otherwise: sends rawText to /api/admin/parse-key (AI extraction).
 *
 * @param file - The File object to parse
 * @returns ParsedKeyResult with testCode, keyDict (or null on failure), and optional error
 */
export async function parseKeyFile(file: File): Promise<ParsedKeyResult> {
  const testCode = file.name.split('.')[0];

  try {
    const { json, rawText } = await extractRawText(file);

    // JSON files are already structured — use directly
    if (json !== undefined) {
      return { testCode, keyDict: json };
    }

    // For text-based files, use AI to extract the key
    if (!rawText || rawText.trim().length === 0) {
      return { testCode, keyDict: null, error: `File ${file.name} không có nội dung.` };
    }

    const data = await postJson<{ success: boolean; keyDict: Record<string, string> }>(
      '/api/admin/parse-key',
      { rawText }
    );

    if (data.success && Object.keys(data.keyDict).length > 0) {
      return { testCode, keyDict: data.keyDict };
    }

    return {
      testCode,
      keyDict: null,
      error: `Không thể trích xuất đáp án từ ${file.name}`,
    };
  } catch (err: any) {
    return {
      testCode,
      keyDict: null,
      error: `Lỗi đọc file ${file.name}: ${err.message}`,
    };
  }
}

/**
 * Parse multiple answer-key files in sequence.
 * Returns a dict of successful parses and a list of errors.
 */
export async function parseKeyFiles(files: FileList | File[]): Promise<{
  keysDict: Record<string, Record<string, string>>;
  errors: string[];
}> {
  const keysDict: Record<string, Record<string, string>> = {};
  const errors: string[] = [];

  for (const file of Array.from(files)) {
    const result = await parseKeyFile(file);
    if (result.keyDict && Object.keys(result.keyDict).length > 0) {
      keysDict[result.testCode] = result.keyDict;
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  return { keysDict, errors };
}
