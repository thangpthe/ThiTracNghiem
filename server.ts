import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import fs from 'fs';
import { readDB, writeDB, cleanupOldRecords, UPLOADS_DIR, logAudit, findSubmissionIndexed } from './server/db';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import lockfile from 'proper-lockfile';
import cookieParser from 'cookie-parser';

dotenv.config();

const app = express();
app.use(cookieParser());
const PORT = 3000;

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production environment.');
}
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

interface RateLimitEntry { count: number, resetAt: number }

function createRateLimiter(maxRequests: number, windowMs: number) {
  const attempts = new Map<string, RateLimitEntry>();
  
  // Cleanup periodically to prevent memory leaks
  setInterval(() => {
    const now = Date.now();
    for (const [ip, limit] of attempts.entries()) {
      if (limit.resetAt < now) attempts.delete(ip);
    }
  }, windowMs);

  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const limit = attempts.get(ip);
    const now = Date.now();
    
    if (limit && limit.count >= maxRequests && limit.resetAt > now) {
      return res.status(429).json({ error: 'Quá nhiều yêu cầu. Thử lại sau.' });
    }
    
    if (!limit || limit.resetAt < now) {
      attempts.set(ip, { count: 1, resetAt: now + windowMs });
    } else {
      limit.count += 1;
    }
    next();
  };
}

const loginRateLimiter = createRateLimiter(10, 5 * 60 * 1000); // 10 attempts per 5 minutes
const publicApiRateLimiter = createRateLimiter(200, 60 * 1000); // 200 attempts per minute for public queries
const appealRateLimiter = createRateLimiter(50, 60 * 1000); // 50 attempts per minute for appeals

// Serve uploaded images securely
app.use('/uploads', express.static(UPLOADS_DIR));

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

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
    let token = req.cookies?.token;
    if (!token) token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
      token = req.headers['x-auth-token'] as string;
    }
    if (!token) return res.status(401).json({ error: 'Unauthorized: Missing token' });

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as any;
      if (!roles.includes(decoded.role)) {
        return res.status(403).json({ error: 'Forbidden: Invalid role' });
      }
      
      const db = readDB();
      const user = db.users.find(u => u.cccd === decoded.cccd);
      if (!user) return res.status(401).json({ error: 'User no longer exists' });
      
      (req as any).user = user;
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }
  };
}

function calculateRegrades(submissions: any[], testCode: string, key: any) {
  const updates = new Map<string, any>();
  if (!key) return updates;
  const totalQuestions = Object.keys(key).length;
  if (totalQuestions === 0) return updates;

  for (const sub of submissions) {
    if (sub.testCode === testCode) {
      if (sub.status !== 'graded') continue;

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
      
      const score = Math.round((correctCount / totalQuestions) * 10 * 100) / 100;
      updates.set(sub.id, {score, correctCount, results: newResults, totalQuestions});
    }
  }
  return updates;
}

function applyUpdates(db: any, updates: Map<string, any>) {
  for (const sub of db.submissions) {
    if (updates.has(sub.id)) {
      const u = updates.get(sub.id);
      sub.results = u.results;
      sub.correctCount = u.correctCount;
      sub.totalQuestions = u.totalQuestions;
      sub.score = u.score;
    }
  }
}

// --- DB FILE LOCK WRAPPER ---
async function withDBLock(action: (db: any) => void) {
  const filePath = path.resolve('data/db.json');
  let release;
  try {
    if (!fs.existsSync('data')) fs.mkdirSync('data');
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, JSON.stringify({}));
    release = await lockfile.lock(filePath, { retries: { retries: 10, minTimeout: 100, maxTimeout: 1000 } });
    const db = readDB();
    action(db);
    writeDB(db);
  } finally {
    if (release) await release();
  }
}

// --- AUTH APIs ---
app.post('/api/auth/login', loginRateLimiter, (req, res) => {
  const { cccd } = req.body;
  const db = readDB();
  const user = db.users.find(u => u.cccd === cccd);
  if (user) {
    const token = jwt.sign({ cccd: user.cccd, role: user.role }, JWT_SECRET, { expiresIn: '4h' });
    res.cookie('token', token, { 
      httpOnly: true, 
      secure: process.env.NODE_ENV === 'production', 
      sameSite: 'strict', 
      maxAge: 4 * 60 * 60 * 1000 
    });
    res.json({ success: true, user, token });
  } else {
    res.json({ success: false, error: 'CCCD không hợp lệ hoặc không có quyền truy cập.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true });
});

// --- ADMIN APIs ---

app.get('/api/admin/keys', requireRole(['admin', 'teacher', 'principal']), (req, res) => {
  const db = readDB();
  res.json({ success: true, keys: db.answerKeys });
});

app.post('/api/admin/keys', requireRole(['admin']), async (req, res) => {
  const { keys } = req.body;
  if (typeof keys !== 'object' || keys === null || Array.isArray(keys)) {
    return res.status(400).json({ error: 'Invalid keys format' });
  }

  const safeKeys: any = {};
  for (const k in keys) {
     const safeK = k.replace(/[^a-zA-Z0-9_-]/g, '');
     if (safeK) safeKeys[safeK] = keys[k];
  }
  
  const db_cache = readDB();
  const allUpdates = new Map<string, any>();
  for (const k in safeKeys) {
    const keyUpdates = calculateRegrades(db_cache.submissions, k, safeKeys[k]);
    for (const [id, u] of keyUpdates) allUpdates.set(id, u);
  }
  
  await withDBLock((db) => {
    db.answerKeys = safeKeys;
    applyUpdates(db, allUpdates);
  });
  
  const db = readDB();
  res.json({ success: true, keys: db.answerKeys });
});

app.get('/api/admin/keys/pending', requireRole(['admin']), (req, res) => {
  const db = readDB();
  res.json({ success: true, pendingKeys: (db.pendingKeys || []).filter(k => k.status === 'pending') });
});

app.post('/api/admin/keys/approve', requireRole(['admin']), async (req, res) => {
  const { id } = req.body;
  const adminCccd = (req as any).user.cccd;
  let success = false;
  let auditEntry: any = null;
  
  const read_db = readDB();
  const targetPk = (read_db.pendingKeys || []).find((k: any) => k.id === id);
  if (!targetPk) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  // Pre-calculate updates outside the lock to minimize file lock duration
  const updates = calculateRegrades(read_db.submissions, targetPk.testCode, targetPk.keyData);
  
  await withDBLock((db) => {
    const pk = (db.pendingKeys || []).find((k: any) => k.id === id);
    if (pk) {
      pk.status = 'approved';
      db.answerKeys[pk.testCode] = pk.keyData;
      
      auditEntry = {
        action: 'APPROVE_KEY',
        actorCccd: adminCccd,
        targetId: id,
        timestamp: new Date().toISOString(),
        details: `Approved key for test code ${pk.testCode}`
      };
      
      applyUpdates(db, updates);
      success = true;
    }
  });

  if (auditEntry) logAudit(auditEntry);

  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.post('/api/admin/keys/reject', requireRole(['admin']), async (req, res) => {
  const { id } = req.body;
  const adminCccd = (req as any).user.cccd;
  let success = false;
  let auditEntry: any = null;
  
  await withDBLock((db) => {
    const pk = (db.pendingKeys || []).find((k: any) => k.id === id);
    if (pk) {
      pk.status = 'rejected';
      
      auditEntry = {
        action: 'REJECT_KEY',
        actorCccd: adminCccd,
        targetId: id,
        timestamp: new Date().toISOString(),
        details: `Rejected key for test code ${pk.testCode}`
      };
      
      success = true;
    }
  });

  if (auditEntry) logAudit(auditEntry);

  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// --- TEACHER APIs ---

app.post('/api/teacher/keys/submit', requireRole(['teacher']), async (req, res) => {
  const { testCode, keyData, teacherId } = req.body;
  if (typeof testCode !== 'string' || !testCode || typeof keyData !== 'object' || keyData === null) {
    return res.status(400).json({ error: 'Invalid testCode or keyData' });
  }
  if ((req as any).user.cccd !== teacherId) {
    return res.status(403).json({ error: 'Forbidden: teacherId mismatch' });
  }
  const safeTestCode = testCode.replace(/[^a-zA-Z0-9_-]/g, '');
  
  await withDBLock((db) => {
    db.pendingKeys = db.pendingKeys || [];
    db.pendingKeys.push({
      id: crypto.randomUUID(),
      testCode: safeTestCode,
      keyData,
      teacherId,
      status: 'pending',
      timestamp: new Date().toISOString()
    });
  });
  
  res.json({ success: true });
});

app.get('/api/teacher/keys/history/:teacherId', requireRole(['teacher']), (req, res) => {
  const db = readDB();
  res.json({ success: true, pendingKeys: (db.pendingKeys || []).filter(k => k.teacherId === req.params.teacherId) });
});

app.get('/api/teacher/stats/:teacherId', requireRole(['teacher', 'principal']), (req, res) => {
  const teacherId = req.params.teacherId;
  const user = (req as any).user;
  if (user.role === 'teacher' && user.cccd !== teacherId) {
     return res.status(403).json({error: 'Forbidden: Không được xem thông tin giáo viên khác'});
  }
  
  const db = readDB();
  const teacher = db.users.find(u => u.cccd === teacherId);
  if (!teacher || teacher.role !== 'teacher') return res.status(403).json({error: 'Hành động không được phép'});
  
  const assignedClass = teacher.assignedClass || 'Lớp 10';
  const gradeMatch = assignedClass.match(/\d+/);
  const grade = gradeMatch ? gradeMatch[0] : '';
  
  buildBaseStats();
  
  const classStats: Record<string, { totalScore: number; count: number }> = {};
  let submissions: any[] = [];
  
  for (const [classId, stats] of Object.entries(cachedClassStats)) {
    if (grade && classId.includes(grade)) {
      classStats[classId] = stats;
    }
  }
  
  if (cachedSubmissionsByClass[assignedClass]) {
    submissions = cachedSubmissionsByClass[assignedClass];
  }

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
    submissions
  });
});

app.post('/api/admin/submissions/:id/edit-score', requireRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { score } = req.body;
  const adminCccd = (req as any).user.cccd;
  
  const numericScore = Number(score);
  if (isNaN(numericScore) || numericScore < 0 || numericScore > 10) {
    return res.status(400).json({ error: 'Invalid score' });
  }
  
  let success = false;
  let auditEntry: any = null;
  
  await withDBLock((db) => {
    const sub = db.submissions.find((s: any) => s.id === id);
    if (sub) {
      const oldScore = sub.score;
      sub.score = numericScore;
      
      auditEntry = {
        action: 'EDIT_SCORE',
        actorCccd: adminCccd,
        targetId: id,
        timestamp: new Date().toISOString(),
        oldValue: oldScore,
        newValue: numericScore
      };
      
      success = true;
    }
  });
  
  if (auditEntry) logAudit(auditEntry);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.post('/api/admin/submissions/:id/toggle-hide', requireRole(['admin', 'teacher']), async (req, res) => {
  const { id } = req.params;
  const actorCccd = (req as any).user.cccd;
  let isHidden = false;
  let success = false;
  let auditEntry: any = null;
  
  await withDBLock((db) => {
    const sub = db.submissions.find((s: any) => s.id === id);
    if (sub) {
      sub.isHidden = !sub.isHidden;
      isHidden = sub.isHidden;
      
      auditEntry = {
        action: 'TOGGLE_HIDE',
        actorCccd: actorCccd,
        targetId: id,
        timestamp: new Date().toISOString(),
        oldValue: !isHidden,
        newValue: isHidden
      };
      
      success = true;
    }
  });
  
  if (auditEntry) logAudit(auditEntry);
  
  if (success) {
    res.json({ success: true, isHidden });
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

app.get('/api/admin/submissions', requireRole(['admin', 'teacher']), (req, res) => {
  const db = readDB();
  
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 50;
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  
  const paginatedSubmissions = db.submissions.slice(startIndex, endIndex);
  
  const summarySubmissions = paginatedSubmissions.map(s => {
    const { results, ...rest } = s;
    return rest;
  });
  
  res.json({ 
    success: true, 
    submissions: summarySubmissions,
    pagination: {
      total: db.submissions.length,
      page,
      limit,
      totalPages: Math.ceil(db.submissions.length / limit)
    }
  });
});

app.post('/api/admin/appeal-resolve', requireRole(['admin']), async (req, res) => {
  const { id } = req.body;
  const adminCccd = (req as any).user.cccd;
  let success = false;
  let auditEntry: any = null;
  
  await withDBLock((db) => {
    const sub = db.submissions.find((s: any) => s.id === id);
    if (sub) {
      auditEntry = {
        action: 'APPEAL_RESOLVE',
        actorCccd: adminCccd,
        targetId: id,
        timestamp: new Date().toISOString(),
        oldValue: sub.status,
        newValue: 'appeal_resolved'
      };
      sub.status = 'appeal_resolved';
      success = true;
    }
  });
  
  if (auditEntry) logAudit(auditEntry);
  
  if (success) {
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Submission not found' });
  }
});

app.get('/api/admin/settings', requireRole(['admin']), (req, res) => {
  const db = readDB();
  res.json({ success: true, settings: db.settings });
});

app.post('/api/admin/settings', requireRole(['admin']), async (req, res) => {
  let latestSettings = {};
  await withDBLock((db) => {
    db.settings = { ...db.settings, ...req.body };
    latestSettings = db.settings;
  });
  res.json({ success: true, settings: latestSettings });
});

let lastStatsTime = 0;
let cachedClassStats: Record<string, { totalScore: number; count: number }> = {};
let cachedSubmissionsByClass: Record<string, any[]> = {};
let cachedTotalVisibleSubmissionsCount = 0;
let cachedTotalVisibleSubmissionsScore = 0;

function buildBaseStats() {
  const time = getLastModifiedTime();
  if (lastStatsTime === time) return;
  const db = readDB();
  cachedClassStats = {};
  cachedSubmissionsByClass = {};
  let totalCount = 0;
  let totalScore = 0;
  
  db.submissions.forEach((sub: any) => {
    if (sub.isHidden) return;
    totalCount++;
    totalScore += sub.score;
    
    const classId = sub.studentId ? `Lớp ${sub.studentId.substring(0, 2)}` : 'Chưa rõ';
    if (!cachedClassStats[classId]) cachedClassStats[classId] = { totalScore: 0, count: 0 };
    cachedClassStats[classId].totalScore += sub.score;
    cachedClassStats[classId].count += 1;
    
    if (!cachedSubmissionsByClass[classId]) cachedSubmissionsByClass[classId] = [];
    cachedSubmissionsByClass[classId].push({
       studentId: sub.studentId,
       testCode: sub.testCode,
       score: sub.score,
       timestamp: sub.timestamp
    });
  });
  
  cachedTotalVisibleSubmissionsCount = totalCount;
  cachedTotalVisibleSubmissionsScore = totalScore;
  lastStatsTime = time;
}

app.get('/api/principal/stats', requireRole(['principal']), (req, res) => {
  buildBaseStats();
  
  const classAverages = Object.keys(cachedClassStats).map(classId => ({
    className: classId,
    averageScore: cachedClassStats[classId].totalScore / cachedClassStats[classId].count,
    studentCount: cachedClassStats[classId].count
  }));

  const allSubmissions = Object.values(cachedSubmissionsByClass).flat();

  res.json({
    success: true,
    totalSubmissions: cachedTotalVisibleSubmissionsCount,
    averageScore: cachedTotalVisibleSubmissionsCount > 0 ? cachedTotalVisibleSubmissionsScore / cachedTotalVisibleSubmissionsCount : 0,
    classAverages,
    submissions: allSubmissions
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

    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI Request Timeout')), 30000));
    const response: any = await Promise.race([
      ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: promptConfig,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            additionalProperties: { type: Type.STRING }
          }
        }
      }),
      timeoutPromise
    ]);

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
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      return res.status(400).json({ error: 'Invalid image format. Only JPEG, PNG, and WebP are allowed' });
    }
    const base64Data = imageBase64.split(',')[1];
    
    const promptConfig = `
      You are an image analysis tool. I am providing an image of a document (an exam answer sheet). 
      Identify its current orientation. Does it need to be rotated clockwise by 90, 180, or 270 degrees to be upright so that the text is readable from left to right, top to bottom?
      If it is already upright, the answer is 0.
      Only return a valid JSON object with one field 'rotationDegrees' which can only be one of: 0, 90, 180, 270.
    `;

    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI Request Timeout')), 30000));
    const response: any = await Promise.race([
      ai.models.generateContent({
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
      }),
      timeoutPromise
    ]);

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
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      return res.status(400).json({ error: 'Invalid image format. Only JPEG, PNG, and WebP are allowed' });
    }
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

    const timeoutPromise = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('AI Request Timeout')), 45000));
    const response: any = await Promise.race([
      ai.models.generateContent({
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
      }),
      timeoutPromise
    ]);

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
      
      let hasConflict = false;
      await withDBLock((dbLockInstance) => {
        const existingSubmissionIndex = dbLockInstance.submissions.findIndex((s: any) => String(s.studentId) === String(newSubmission.studentId) && String(s.testCode) === String(newSubmission.testCode));
        if (existingSubmissionIndex >= 0) {
          hasConflict = true;
          // Delete the newly uploaded image since we won't save it
          try { fs.unlinkSync(path.join(UPLOADS_DIR, imageFileName)); } catch (e) {}
        } else {
          dbLockInstance.submissions.unshift(newSubmission);
        }
      });
      
      if (hasConflict) {
        return res.json({ success: false, graded: false, error: `Trùng lặp: Học sinh ${newSubmission.studentId} đã có điểm cho mã đề ${newSubmission.testCode}. Vui lòng kiểm tra lại thủ công.` });
      }
      
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

app.get('/api/public/result', publicApiRateLimiter, (req, res) => {
  const { studentId, testCode } = req.query;
  if (!studentId || !testCode) {
    return res.status(400).json({ success: false, error: 'Thiếu số báo danh hoặc mã đề' });
  }

  const db = readDB();
  const sub = findSubmissionIndexed(String(studentId), String(testCode), db);
  if (!sub) {
    return res.json({ success: false, error: 'Không tìm thấy kết quả cho thông tin này' });
  }
  if (sub.isHidden) {
    return res.json({ success: false, error: 'Kết quả của bạn đang được ẩn theo yêu cầu của giáo viên.' });
  }
  
  // Calculate if within appeal window
  const appealTimeMs = db.settings.appealWindowDays * 24 * 60 * 60 * 1000;
  const isWithinWindow = (new Date().getTime() - new Date(sub.timestamp).getTime()) <= appealTimeMs;
  
  res.json({ success: true, submission: sub, isWithinWindow });
});

app.post('/api/student/appeal', appealRateLimiter, async (req, res) => {
  const { id, reason, fullName, className } = req.body;
  let appealResolved = false;
  let updatedSub = null;
  let errorMsg = null;
  
  await withDBLock((db) => {
    const index = db.submissions.findIndex((s: any) => s.id === id);
    if (index >= 0) {
      const sub = db.submissions[index];
      const appealTimeMs = db.settings.appealWindowDays * 24 * 60 * 60 * 1000;
      const isWithinWindow = (new Date().getTime() - new Date(sub.timestamp).getTime()) <= appealTimeMs;
      
      if (isWithinWindow && sub.status === 'graded') {
        db.submissions[index].status = 'appeal_pending';
        db.submissions[index].appealReason = reason;
        db.submissions[index].fullName = fullName;
        db.submissions[index].className = className;
        db.submissions[index].appealTimestamp = new Date().toISOString();
        updatedSub = db.submissions[index];
        appealResolved = true;
      } else {
        errorMsg = 'Không thể phúc khảo (đã hết hạn hoặc trạng thái không hợp lệ)';
      }
    }
  });
  
  if (appealResolved) {
    res.json({ success: true, submission: updatedSub });
  } else {
    res.status(errorMsg ? 400 : 404).json({ error: errorMsg || 'Not found' });
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
