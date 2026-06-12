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
    score: totalQuestions > 0 ? (correctCount / totalQuestions) * 10 : 0,
    timestamp: extraction.timestamp || new Date().toISOString()
  };
}
