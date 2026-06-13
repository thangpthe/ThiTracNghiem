import { readDB, writeDB, Database } from '../server/db';
import * as crypto from 'crypto';

const db: Database = readDB();

// Add Users (Teachers)
if (!db.users.find(u => u.cccd === '001002003004')) {
  db.users.push({
    cccd: '001002003004',
    name: 'Nguyễn Văn Định',
    role: 'teacher',
    assignedClass: 'Lớp 11'
  });
}

// Add Answer Keys
db.answerKeys['101'] = {
  testCode: '101',
  questions: Array.from({ length: 40 }, (_, i) => ({
    questionIndex: i + 1,
    correctAnswer: ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)]
  }))
};
db.answerKeys['102'] = {
  testCode: '102',
  questions: Array.from({ length: 40 }, (_, i) => ({
    questionIndex: i + 1,
    correctAnswer: ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)]
  }))
};

// Add Submissions
if (db.submissions.length < 5) {
  const sampleNames = ['Nguyễn Văn A', 'Trần Thị B', 'Lê Văn C', 'Phạm Thị D', 'Hoàng Văn E'];
  
  for (let i = 0; i < 20; i++) {
    const isAppeal = i % 5 === 0;
    const testCode = i % 2 === 0 ? '101' : '102';
    const score = Math.floor(Math.random() * 5) + 5; // 5 to 9
    const studentId = `1100${i.toString().padStart(2, '0')}`;
    
    db.submissions.push({
      id: crypto.randomUUID(),
      studentId,
      testCode,
      score,
      correctCount: score * 4,
      totalQuestions: 40,
      timestamp: new Date(Date.now() - Math.random() * 10 * 24 * 60 * 60 * 1000).toISOString(),
      results: Array.from({ length: 40 }, (_, idx) => ({
        questionIndex: idx + 1,
        studentAnswer: ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)],
        correctAnswer: db.answerKeys[testCode].questions[idx].correctAnswer,
        isCorrect: Math.random() > 0.2
      })),
      imageFile: 'dummy.jpg',
      status: isAppeal ? 'appeal_pending' : 'graded',
      appealReason: isAppeal ? 'Dạ thưa cô em nghĩ câu 5 em tô đúng ạ, mong cô xem xét lại' : undefined,
      fullName: sampleNames[i % sampleNames.length],
      className: `11A${(i % 3) + 1}`,
      isHidden: i % 10 === 0
    });
  }
}

// Add Pending Keys
if (db.pendingKeys.length === 0) {
  db.pendingKeys.push({
    id: crypto.randomUUID(),
    testCode: '201',
    keyData: {
      testCode: '201',
      questions: Array.from({ length: 40 }, (_, i) => ({
        questionIndex: i + 1,
        correctAnswer: 'A'
      }))
    },
    teacherId: '000000000002',
    status: 'pending',
    timestamp: new Date().toISOString()
  });
}

writeDB(db);
console.log('Sample data seeded successfully!');
