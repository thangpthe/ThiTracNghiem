import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

export interface Submission {
  id: string;
  studentId: string;
  testCode: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  timestamp: string;
  results: any[];
  imageFile: string;
  status: 'graded' | 'appeal_pending' | 'appeal_resolved';
  appealReason?: string;
  appealTimestamp?: string;
  isHidden?: boolean;
}

export interface PendingKey {
  id: string;
  testCode: string;
  keyData: any;
  teacherId: string;
  status: 'pending' | 'approved' | 'rejected';
  timestamp: string;
}

export interface User {
  cccd: string;
  name: string;
  role: 'admin' | 'teacher' | 'principal';
  assignedClass?: string;
}

export interface Database {
  answerKeys: { [testCode: string]: any };
  pendingKeys: PendingKey[];
  users: User[];
  submissions: Submission[];
  settings: {
    appealWindowDays: number;
    retentionDays: number;
  };
}

const defaultDb: Database = {
  answerKeys: {},
  pendingKeys: [],
  users: [
    { cccd: '000000000001', name: 'Quản trị viên (Admin)', role: 'admin' },
    { cccd: '000000000002', name: 'Giáo viên Chủ nhiệm', role: 'teacher', assignedClass: 'Lớp 10' },
    { cccd: '000000000003', name: 'Hiệu trưởng', role: 'principal' }
  ],
  submissions: [],
  settings: {
    appealWindowDays: 3,
    retentionDays: 15,
  }
};

export function readDB(): Database {
  if (!fs.existsSync(DB_FILE)) {
    writeDB(defaultDb);
    return defaultDb;
  }
  try {
    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    db.pendingKeys = db.pendingKeys || [];
    db.users = db.users || defaultDb.users;
    return db;
  } catch (e) {
    return defaultDb;
  }
}

export function writeDB(db: Database) {
  const tempFile = DB_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(db, null, 2));
  fs.renameSync(tempFile, DB_FILE);
}

// Cleanup job that runs when called
export function cleanupOldRecords() {
  const db = readDB();
  const now = new Date().getTime();
  const retentionMs = db.settings.retentionDays * 24 * 60 * 60 * 1000;
  
  let changed = false;
  const newSubmissions = [];
  
  for (const sub of db.submissions) {
    const time = new Date(sub.timestamp).getTime();
    if (now - time > retentionMs) {
      const filePath = path.join(UPLOADS_DIR, sub.imageFile);
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
      changed = true;
    } else {
      newSubmissions.push(sub);
    }
  }
  
  if (changed) {
    db.submissions = newSubmissions;
    writeDB(db);
  }
}

