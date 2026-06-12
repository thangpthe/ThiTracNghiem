import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import { readDB, writeDB, cleanupOldRecords, UPLOADS_DIR } from './server/db';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = 3000;

// Serve uploaded images securely
app.use('/uploads', express.static(UPLOADS_DIR));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    }
  }
});

// Run cleanup job occasionally (or on start)
cleanupOldRecords();
setInterval(cleanupOldRecords, 1000 * 60 * 60 * 12); // every 12 hours

function requireRole(roles: string[]) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const cccd = req.headers['x-auth-cccd'] as string;
    if (!cccd) return res.status(401).json({ error: 'Unauthorized: Missing CCCD header' });
    const db = readDB();
    const user = db.users.find(u => u.cccd === cccd);
    if (!user || !roles.includes(user.role)) {
      return res.status(403).json({ error: 'Forbidden: Invalid role' });
    }
    (req as any).user = user;
    next();
  };
}

function regradeSubmissions(db: any, testCode: string) {
  const key = db.answerKeys[testCode];
  if (!key) return;
  const totalQuestions = Object.keys(key).length;
  if (totalQuestions === 0) return;

  for (const sub of db.submissions) {
    if (sub.testCode === testCode) {
      let correctCount = 0;
      const newResults = [];
      for (const [qNum, correctAns] of Object.entries(key)) {
         const oldRes = sub.results.find((r: any) => r.questionNumber === qNum);
         const extAns = oldRes ? oldRes.extractedAnswer : null;
         let isCorrect = false;
         if (extAns) {
           isCorrect = String(extAns).toLowerCase().trim() === String(correctAns).toLowerCase().trim();
         }
         if (isCorrect) correctCount++;
         newResults.push({ questionNumber: qNum, extractedAnswer: extAns, correctAnswer: correctAns, isCorrect });
      }
      sub.results = newResults;
      sub.correctCount = correctCount;
      sub.totalQuestions = totalQuestions;
      sub.score = Math.round((correctCount / totalQuestions) * 10 * 100) / 100;
      // Do not override 'appeal_pending' or 'appeal_resolved' if we want to preserve them, but we could set it to graded. Let's just update score.
    }
  }
}

// --- AUTH APIs ---
app.post('/api/auth/login', (req, res) => {
  const { cccd } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.cccd === cccd);
  if (user) {
    res.json({ success: true, user });
  } else {
    res.json({ success: false, error: 'CCCD không hợp lệ hoặc không có quyền truy cập.' });
  }
});

// --- ADMIN APIs ---

app.get('/api/admin/keys', requireRole(['admin', 'teacher', 'principal']), (req, res) => {
  const db = readDB();
  res.json({ success: true, keys: db.answerKeys });
});

app.post('/api/admin/keys', requireRole(['admin']), (req, res) => {
  const { keys } = req.body;
  const db = readDB();
  const safeKeys: any = {};
  for (const k in keys) {
     const safeK = k.replace(/[^a-zA-Z0-9_-]/g, '');
     if (safeK) safeKeys[safeK] = keys[k];
  }
  db.answerKeys = safeKeys; // or merge depending on your usage, UI sends empty to clear all
  for (const k in safeKeys) {
     regradeSubmissions(db, k);
  }
  writeDB(db);
  res.json({ success: true, keys: db.answerKeys });
});

app.get('/api/admin/keys/pending', requireRole(['admin']), (req, res) => {
  const db = readDB();
  res.json({ success: true, pendingKeys: (db.pendingKeys || []).filter(k => k.status === 'pending') });
});

app.post('/api/admin/keys/approve', requireRole(['admin']), (req, res) => {
  const { id } = req.body;
  const db = readDB();
  const pk = (db.pendingKeys || []).find(k => k.id === id);
  if (pk) {
    pk.status = 'approved';
    db.answerKeys[pk.testCode] = pk.keyData;
    regradeSubmissions(db, pk.testCode);
    writeDB(db);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.post('/api/admin/keys/reject', requireRole(['admin']), (req, res) => {
  const { id } = req.body;
  const db = readDB();
  const pk = (db.pendingKeys || []).find(k => k.id === id);
  if (pk) {
    pk.status = 'rejected';
    writeDB(db);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// --- TEACHER APIs ---

app.post('/api/teacher/keys/submit', requireRole(['teacher']), (req, res) => {
  const { testCode, keyData, teacherId } = req.body;
  const safeTestCode = testCode.replace(/[^a-zA-Z0-9_-]/g, '');
  const db = readDB();
  db.pendingKeys = db.pendingKeys || [];
  db.pendingKeys.push({
    id: crypto.randomUUID(),
    testCode: safeTestCode,
    keyData,
    teacherId,
    status: 'pending',
    timestamp: new Date().toISOString()
  });
  writeDB(db);
  res.json({ success: true });
});

app.get('/api/teacher/keys/history/:teacherId', requireRole(['teacher']), (req, res) => {
  const db = readDB();
  res.json({ success: true, pendingKeys: (db.pendingKeys || []).filter(k => k.teacherId === req.params.teacherId) });
});

app.get('/api/teacher/stats/:teacherId', requireRole(['teacher']), (req, res) => {
  const db = readDB();
  const teacher = db.users.find(u => u.cccd === req.params.teacherId);
  if (!teacher || teacher.role !== 'teacher') return res.status(403).json({error: 'Hành động không được phép'});
  
  const assignedClass = teacher.assignedClass || 'Lớp 10';
  const gradeMatch = assignedClass.match(/\d+/);
  const grade = gradeMatch ? gradeMatch[0] : '';
  
  const classStats: Record<string, { totalScore: number; count: number }> = {};
  let submissions: any[] = [];
  
  db.submissions.filter(s => !s.isHidden).forEach(sub => {
    const classId = sub.studentId ? `Lớp ${sub.studentId.substring(0, 2)}` : 'Chưa rõ';
    
    if (grade && classId.includes(grade)) {
      if (!classStats[classId]) classStats[classId] = { totalScore: 0, count: 0 };
      classStats[classId].totalScore += sub.score;
      classStats[classId].count += 1;
    }
    
    if (classId === assignedClass) {
       submissions.push(sub);
    }
  });

  const gradeClassAverages = Object.keys(classStats).map(cId => ({
    className: cId,
    averageScore: classStats[cId].totalScore / classStats[cId].count
  }));

  const averageScore = submissions.length > 0 ? submissions.reduce((sum, s) => sum + s.score, 0) / submissions.length : 0;

  res.json({
    success: true,
    assignedClass,
    grade,
    totalSubmissions: submissions.length,
    averageScore,
    gradeClassAverages,
    submissions: submissions.map(s => ({
      ...s
    }))
  });
});

app.post('/api/admin/submissions/:id/edit-score', requireRole(['admin']), (req, res) => {
  const { id } = req.params;
  const { score } = req.body;
  const db = readDB();
  const sub = db.submissions.find(s => s.id === id);
  if (sub) {
    sub.score = Number(score);
    writeDB(db);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.post('/api/admin/submissions/:id/toggle-hide', requireRole(['admin', 'teacher']), (req, res) => {
  const { id } = req.params;
  const db = readDB();
  const sub = db.submissions.find(s => s.id === id);
  if (sub) {
    sub.isHidden = !sub.isHidden;
    writeDB(db);
    res.json({ success: true, isHidden: sub.isHidden });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.get('/api/admin/submissions', requireRole(['admin', 'teacher']), (req, res) => {

  const db = readDB();
  // Don't send full results array to save bandwidth if many, but we will send it for now
  res.json({ success: true, submissions: db.submissions });
});

app.post('/api/admin/appeal-resolve', requireRole(['admin']), (req, res) => {
  const { id } = req.body;
  const db = readDB();
  const sub = db.submissions.find(s => s.id === id);
  if (sub) {
    sub.status = 'appeal_resolved';
    writeDB(db);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Submission not found' });
  }
});

app.get('/api/admin/settings', requireRole(['admin']), (req, res) => {
  const db = readDB();
  res.json({ success: true, settings: db.settings });
});

app.post('/api/admin/settings', requireRole(['admin']), (req, res) => {
  const db = readDB();
  db.settings = { ...db.settings, ...req.body };
  writeDB(db);
  res.json({ success: true, settings: db.settings });
});

app.get('/api/principal/stats', requireRole(['principal']), (req, res) => {
  const db = readDB();
  const submissions = db.submissions.filter((s:any) => !s.isHidden);
  
  const classStats: Record<string, { totalScore: number; count: number }> = {};
  submissions.forEach(sub => {
    // Giả lập lấy Mã Lớp từ 2 số đầu của SBD (Ví dụ: SBD 10123 -> Lớp 10)
    const classId = sub.studentId ? `Lớp ${sub.studentId.substring(0, 2)}` : 'Chưa rõ';
    if (!classStats[classId]) classStats[classId] = { totalScore: 0, count: 0 };
    classStats[classId].totalScore += sub.score;
    classStats[classId].count += 1;
  });

  const classAverages = Object.keys(classStats).map(classId => ({
    className: classId,
    averageScore: classStats[classId].totalScore / classStats[classId].count,
    studentCount: classStats[classId].count
  }));

  res.json({
    success: true,
    totalSubmissions: submissions.length,
    averageScore: submissions.length > 0 ? submissions.reduce((sum, s) => sum + s.score, 0) / submissions.length : 0,
    classAverages,
    submissions: submissions.map(s => ({
      studentId: s.studentId,
      testCode: s.testCode,
      score: s.score,
      timestamp: s.timestamp
    }))
  });
});

app.post('/api/admin/parse-key', requireRole(['admin', 'teacher']), async (req, res) => {
  try {
    const { rawText } = req.body;
    if (!rawText) return res.status(400).json({ error: 'Text is required' });

    const promptConfig = `
      Bạn là một chuyên gia trích xuất dữ liệu. Tôi đang cung cấp cho bạn một đoạn văn bản (được trích xuất từ file Word, Excel, hoặc Text) chứa ĐÁP ÁN của một đề thi trắc nghiệm.
      Hãy phân tích đoạn văn bản này và trích xuất ra một danh sách các đáp án đúng cho từng câu hỏi.
      
      Trả về kết quả TẤT CẢ các câu hỏi có trong văn bản dưới dạng một JSON Object (không phải mảng).
      - Key: Số thứ tự câu (ví dụ: "1", "2", "3" hoặc có thể theo phần "I.1", "II.1.a")
      - Value: Đáp án đúng (ví dụ: "A", "B", "C", "D", "Đúng", "Sai" hoặc các đáp án text khác).
      
      Nếu nội dung có vẻ không chứa đáp án chuẩn, trả về JSON rỗng.
      
      Nội dung văn bản:
      ${rawText}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: promptConfig,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          additionalProperties: { type: Type.STRING }
        }
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({ success: true, keyDict: parsed });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to parse keys', details: error.message });
  }
});

app.post('/api/detect-orientation', requireRole(['admin', 'teacher']), async (req, res) => {
  // Existing detect-orientation logic
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Image is required' });

    const mimeType = imageBase64.substring(imageBase64.indexOf(":") + 1, imageBase64.indexOf(";"));
    const base64Data = imageBase64.split(',')[1];
    
    const promptConfig = `
      You are an image analysis tool. I am providing an image of a document (an exam answer sheet). 
      Identify its current orientation. Does it need to be rotated clockwise by 90, 180, or 270 degrees to be upright so that the text is readable from left to right, top to bottom?
      If it is already upright, the answer is 0.
      Only return a valid JSON object with one field 'rotationDegrees' which can only be one of: 0, 90, 180, 270.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: [{ text: promptConfig }, { inlineData: { mimeType: mimeType, data: base64Data } }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: { rotationDegrees: { type: Type.INTEGER } },
          required: ['rotationDegrees']
        }
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    res.json({ success: true, rotationDegrees: parsed.rotationDegrees || 0 });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to detect orientation', details: error.message });
  }
});

app.post('/api/extract-sheet', requireRole(['admin', 'teacher']), async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) return res.status(400).json({ error: 'Image is required' });

    const mimeType = imageBase64.substring(imageBase64.indexOf(":") + 1, imageBase64.indexOf(";"));
    const base64Data = imageBase64.split(',')[1];
    
    const promptConfig = `
      Bạn là một chuyên gia Hệ thống Nhận diện Thị giác (Computer Vision) để đọc Phiếu trả lời trắc nghiệm.
      Tôi cung cấp cho bạn một hình ảnh Phiếu trả lời trắc nghiệm của học sinh.
      
      Phiếu này chuẩn cấu trúc gồm 3 phần:
      - Phần I: Trắc nghiệm 4 đáp án (A, B, C, D).
      - Phần II: Trắc nghiệm Đúng / Sai (Gồm các ý a, b, c, d).
      - Phần III: Điền khuyết (Gồm dấu âm, dấu phẩy và các chữ số từ 0-9).
      
      Góc trên bên phải có khu vực "7. Số báo danh" (SBD - gồm 6 cột chữ số) và "8. Mã đề thi" (gồm 3 cột chữ số). Hãy đọc kỹ các ô được tô đen ở đây để lấy ra SBD và Mã đề.

      Bạn phải trả về một JSON Object chứa các trường:
      - studentId: Số báo danh của học sinh (string, ví dụ "123456", hoặc rỗng nếu không thể đọc)
      - testCode: Mã đề thi (string, ví dụ "101", hoặc rỗng nếu không thể đọc)
      - answers: Một JSON Object (không phải array) chứa tất cả các câu hỏi mà học sinh đã tô.
        - Key: mã câu hỏi (VD: "I.1", "II.1.a", "III.1")
        - Value: đáp án học sinh đã tô (VD: "A", "Đúng", "Sai", "15.2", "-4", hoặc rỗng nếu không tô)
      
      Lưu ý: Chỉ trả về đoạn JSON hợp lệ như định dạng mô tả.
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-3.1-pro-preview',
      contents: [{ text: promptConfig }, { inlineData: { mimeType: mimeType, data: base64Data } }],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            studentId: { type: Type.STRING },
            testCode: { type: Type.STRING },
            answers: { type: Type.OBJECT, additionalProperties: { type: Type.STRING } }
          },
          required: ['studentId', 'testCode', 'answers']
        }
      }
    });

    const parsed = JSON.parse(response.text || '{}');
    let rawTestCode = parsed.testCode || '';
    const safeTestCode = typeof rawTestCode === 'string' ? rawTestCode.replace(/[^a-zA-Z0-9_-]/g, '') : null;
    
    const extractionResult = {
      studentId: parsed.studentId || null,
      testCode: safeTestCode,
      answers: parsed.answers || {},
      timestamp: new Date().toISOString()
    };
    
    // Now we grade it right away if test code is valid
    const db = readDB();
    if (extractionResult.testCode && db.answerKeys[extractionResult.testCode]) {
      const key = db.answerKeys[extractionResult.testCode];
      let correctCount = 0;
      const totalQuestions = Object.keys(key).length;
      const results = [];
      
      for (const [qNum, correctAns] of Object.entries(key)) {
        const extAns = extractionResult.answers[qNum] || null;
        let isCorrect = false;
        if (extAns) {
          isCorrect = String(extAns).toLowerCase().trim() === String(correctAns).toLowerCase().trim();
        }
        if (isCorrect) correctCount++;
        results.push({ questionNumber: qNum, extractedAnswer: extAns, correctAnswer: correctAns, isCorrect });
      }
      
      const score = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 10 * 100) / 100 : 0;
      
      // Save image to disk
      const imageFileName = `${crypto.randomUUID()}.jpg`;
      fs.writeFileSync(path.join(UPLOADS_DIR, imageFileName), Buffer.from(base64Data, 'base64'));
      
      const newSubmission = {
        id: crypto.randomUUID(),
        studentId: extractionResult.studentId || 'unknown',
        testCode: safeTestCode,
        score,
        correctCount,
        totalQuestions,
        timestamp: extractionResult.timestamp,
        results,
        imageFile: imageFileName,
        status: 'graded' as const
      };
      
      const existingSubmissionIndex = db.submissions.findIndex(s => String(s.studentId) === String(newSubmission.studentId) && String(s.testCode) === String(newSubmission.testCode));
      if (existingSubmissionIndex >= 0) {
        newSubmission.id = db.submissions[existingSubmissionIndex].id; // Keep same ID so frontend keys don't break if dependent
        db.submissions[existingSubmissionIndex] = newSubmission;
      } else {
        db.submissions.unshift(newSubmission);
      }
      
      writeDB(db);
      
      res.json({ success: true, graded: true, data: newSubmission });
    } else {
      res.json({ 
        success: false, 
        graded: false, 
        error: `Mã đề không hợp lệ / không có Key: ${extractionResult.testCode}`,
        data: extractionResult
      });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to extract sheet data', details: error.message });
  }
});

// --- STUDENT APIs ---

app.get('/api/student/result/:studentId', (req, res) => {
  const { studentId } = req.params;
  const db = readDB();
  const sub = db.submissions.find(s => String(s.studentId) === String(studentId));
  if (!sub) {
    return res.json({ success: false, error: 'Không tìm thấy kết quả cho số báo danh này' });
  }
  if (sub.isHidden) {
    return res.json({ success: false, error: 'Kết quả của bạn đã bị ẩn theo yêu cầu.' });
  }
  
  // Calculate if within appeal window
  const appealTimeMs = db.settings.appealWindowDays * 24 * 60 * 60 * 1000;
  const isWithinWindow = (new Date().getTime() - new Date(sub.timestamp).getTime()) <= appealTimeMs;
  
  res.json({ success: true, submission: sub, isWithinWindow });
});

app.post('/api/student/appeal', (req, res) => {
  const { id, reason } = req.body;
  const db = readDB();
  const index = db.submissions.findIndex(s => s.id === id);
  if (index >= 0) {
    const sub = db.submissions[index];
    const appealTimeMs = db.settings.appealWindowDays * 24 * 60 * 60 * 1000;
    const isWithinWindow = (new Date().getTime() - new Date(sub.timestamp).getTime()) <= appealTimeMs;
    
    if (isWithinWindow && sub.status === 'graded') {
      db.submissions[index].status = 'appeal_pending';
      db.submissions[index].appealReason = reason;
      db.submissions[index].appealTimestamp = new Date().toISOString();
      writeDB(db);
      res.json({ success: true, submission: db.submissions[index] });
    } else {
      res.status(400).json({ error: 'Không thể phúc khảo' });
    }
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => { res.sendFile(path.join(distPath, 'index.html')); });
  }
  app.listen(PORT, "0.0.0.0", () => { console.log(`Server running on http://localhost:${PORT}`); });
}

startServer();
