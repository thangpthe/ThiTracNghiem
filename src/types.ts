export interface AnswerKey {
  [questionNumber: string]: string;
}

export interface AnswerKeysDict {
  [testCode: string]: AnswerKey;
}

export interface SheetExtraction {
  studentId: string | null;
  testCode: string | null;
  answers: { [questionNumber: string]: string };
  timestamp: string;
}

export interface GradingResultItem {
  questionNumber: string;
  extractedAnswer: string | null;
  correctAnswer: string;
  isCorrect: boolean;
}

export interface GradingResponse {
  studentId: string | null;
  testCode: string | null;
  results: GradingResultItem[];
  correctCount: number;
  totalQuestions: number;
  score: number;
  timestamp: string;
  error?: string; // If parsing failed or no matching answer key
}

