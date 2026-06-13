import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { AnswerKey, SheetExtraction, GradingResponse, GradingResultItem } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function exportToCSV(data: any[], filename: string) {
  if (!data || !data.length) return;
  
  const headers = Object.keys(data[0]);
  const csvContent = 
    headers.join(',') + '\n' + 
    data.map(row => {
      return headers.map(fieldName => {
        let val = row[fieldName] === null || row[fieldName] === undefined ? '' : row[fieldName];
        let valStr = String(val);
        // Escape quotes
        valStr = valStr.replace(/"/g, '""');
        // Wrap in quotes if it contains comma, newline, or quote
        if (valStr.search(/("|,|\n)/g) >= 0) {
          valStr = `"${valStr}"`;
        }
        return valStr;
      }).join(',');
    }).join('\n');
    
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * Tính điểm với integer arithmetic để tránh sai số floating-point IEEE 754.
 * Công thức: Math.round((correctCount * 10 * 100) / totalQuestions) / 100
 * Ví dụ: 3/30 câu = Math.round(3*1000/30)/100 = Math.round(100)/100 = 1.00
 *         không bị 0.9999999... như float thuần túy.
 */
export function calcScore(correctCount: number, totalQuestions: number): number {
  if (totalQuestions === 0) return 0;
  // Nhân nguyên trước (×1000) để giữ độ chính xác, sau đó chia
  return Math.round((correctCount * 10 * 100) / totalQuestions) / 100;
}

export function gradeSheet(extraction: SheetExtraction, key: AnswerKey): GradingResponse {
  const results: GradingResultItem[] = [];
  let correctCount = 0;
  const totalQuestions = Object.keys(key).length;

  for (const [qNum, correctAns] of Object.entries(key)) {
    const extAns = extraction.answers[qNum] || null;
    let isCorrect = false;
    
    if (extAns) {
      isCorrect = extAns.toString().toLowerCase().trim() === correctAns.toString().toLowerCase().trim();
    }
    
    if (isCorrect) {
      correctCount++;
    }
    
    results.push({
      questionNumber: qNum,
      extractedAnswer: extAns,
      correctAnswer: correctAns,
      isCorrect
    });
  }

  return {
    studentId: extraction.studentId,
    testCode: extraction.testCode,
    results,
    correctCount,
    totalQuestions,
    // Dùng calcScore thay vì float division trực tiếp
    score: calcScore(correctCount, totalQuestions),
    timestamp: extraction.timestamp || new Date().toISOString()
  };
}
