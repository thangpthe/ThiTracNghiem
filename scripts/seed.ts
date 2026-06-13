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

// Add Answer Keys with proper flat dictionary format
const key101: any = {};
for (let i = 1; i <= 40; i++) {
  key101[String(i)] = ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)];
}
db.answerKeys['101'] = key101;

const key102: any = {};
for (let i = 1; i <= 40; i++) {
  key102[String(i)] = ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)];
}
db.answerKeys['102'] = key102;

// Add Submissions
if (db.submissions.length < 5) {
  const sampleNames = ['Nguyễn Văn A', 'Trần Thị B', 'Lê Văn C', 'Phạm Thị D', 'Hoàng Văn E'];
  
  for (let i = 0; i < 20; i++) {
    const isAppeal = i % 5 === 0;
    const testCode = i % 2 === 0 ? '101' : '102';
    const score = Math.floor(Math.random() * 5) + 5; // 5 to 9
    const studentId = `1100${i.toString().padStart(2, '0')}`;
    const activeKey = db.answerKeys[testCode];
    
    db.submissions.push({
      id: crypto.randomUUID(),
      studentId,
      testCode,
      score,
      correctCount: score * 4,
      totalQuestions: 40,
      timestamp: new Date(Date.now() - Math.random() * 10 * 24 * 60 * 60 * 1000).toISOString(),
      results: Array.from({ length: 40 }, (_, idx) => {
        const qNum = String(idx + 1);
        const correctAns = activeKey[qNum];
        return {
          questionNumber: qNum,
          studentAnswer: ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)],
          correctAnswer: correctAns,
          isCorrect: Math.random() > 0.2
        };
      }),
      imageFile: 'dummy.jpg',
      status: isAppeal ? 'appeal_pending' : 'graded',
      appealReason: isAppeal ? 'Dạ thưa cô em nghĩ câu 5 em tô đúng ạ, mong cô xem xét lại' : undefined,
      fullName: sampleNames[i % sampleNames.length],
      className: `11A${(i % 3) + 1}`,
      isHidden: i % 10 === 0
    });
  }
} else {
  // If we already have submissions, let's fix their results with correct flat answer key format
  for (const sub of db.submissions) {
    const activeKey = db.answerKeys[sub.testCode];
    if (activeKey) {
      sub.results = sub.results.map((r: any) => {
        const qNum = String(r.questionNumber || r.questionIndex || '');
        const correct = activeKey[qNum] || r.correctAnswer;
        return {
          ...r,
          questionNumber: qNum,
          correctAnswer: correct,
          isCorrect: r.isCorrect ?? (r.studentAnswer === correct)
        };
      });
    }
  }
}

// Add Pending Keys with proper flat dictionary format
db.pendingKeys = []; // Let's clear and re-create pendingKeys with proper format to avoid validation mismatch
const pendingKey201: any = {};
for (let i = 1; i <= 40; i++) {
  pendingKey201[String(i)] = 'A';
}
db.pendingKeys.push({
  id: crypto.randomUUID(),
  testCode: '201',
  keyData: pendingKey201,
  teacherId: '000000000002',
  status: 'pending',
  timestamp: new Date().toISOString()
});

writeDB(db);
console.log('Sample data seeded and migrated successfully!');
