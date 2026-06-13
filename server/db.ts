import fs from 'fs';
import path from 'path';
import lockfile from 'proper-lockfile';

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
  fullName?: string;
  className?: string;
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

export interface AuditLogEntry {
  action: string;
  actorCccd: string;
  targetId?: string;
  timestamp: string;
  oldValue?: any;
  newValue?: any;
  details?: string;
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

let cachedDB: Database | null = null;
let lastModifiedTime: number = 0;
const submissionIndexCache = new Map<string, Submission>();
const AUDIT_LOG_FILE = path.join(DATA_DIR, 'audit.log');

function rebuildSubmissionIndex(db: Database) {
  submissionIndexCache.clear();
  for (const sub of db.submissions) {
    if (sub.studentId && sub.testCode) {
      const key = `${sub.studentId}_${sub.testCode}`;
      if (!submissionIndexCache.has(key)) {
        submissionIndexCache.set(key, sub);
      }
    }
  }
}

export function logAudit(entry: AuditLogEntry) {
  try {
    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(AUDIT_LOG_FILE, line, 'utf-8');
  } catch (e) {
    console.error('Failed to write audit log:', e);
  }
}

export function findSubmissionIndexed(studentId: string, testCode: string, db?: Database): Submission | undefined {
  if (!db) readDB();
  return submissionIndexCache.get(`${studentId}_${testCode}`);
}

export function getLastModifiedTime() {
  return lastModifiedTime;
}

export function readDB(): Database {
  if (!fs.existsSync(DB_FILE)) {
    writeDB(defaultDb);
    return JSON.parse(JSON.stringify(defaultDb));
  }
  try {
    const stats = fs.statSync(DB_FILE);
    if (cachedDB && stats.mtimeMs === lastModifiedTime) {
      return cachedDB;
    }

    const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    db.pendingKeys = db.pendingKeys || [];
    db.users = db.users || defaultDb.users;
    
    // Build quick lookup cache for public scores
    rebuildSubmissionIndex(db);
    
    cachedDB = db;
    lastModifiedTime = stats.mtimeMs;
    return db;
  } catch (e) {
    console.error('[db] readDB error, returning safe default:', e);
    return JSON.parse(JSON.stringify(defaultDb));
  }
}

export function writeDB(db: Database) {
  const tempFile = DB_FILE + '.tmp';
  fs.writeFileSync(tempFile, JSON.stringify(db));
  fs.renameSync(tempFile, DB_FILE);
  
  rebuildSubmissionIndex(db);
  cachedDB = db;
  lastModifiedTime = fs.statSync(DB_FILE).mtimeMs;
}

export async function withDBLock(action: (db: Database) => void) {
  let release;
  try {
    release = await lockfile.lock(DB_FILE, { retries: { retries: 10, minTimeout: 100, maxTimeout: 1000 } });
    const db = readDB();
    action(db);
    writeDB(db);
  } finally {
    if (release) await release();
  }
}

// Cleanup job that runs when called
export async function cleanupOldRecords() {
  const db = readDB();
  const now = new Date().getTime();
  const retentionMs = db.settings.retentionDays * 24 * 60 * 60 * 1000;
  
  const hasExpired = db.submissions.some(sub => 
    now - new Date(sub.timestamp).getTime() > retentionMs
  );
  
  if (!hasExpired) return;

  await withDBLock((lockedDb) => {
    let changed = false;
    const newSubmissions = [];
    const currentNow = new Date().getTime();
    const currentRetentionMs = lockedDb.settings.retentionDays * 24 * 60 * 60 * 1000;
    
    for (const sub of lockedDb.submissions) {
      const time = new Date(sub.timestamp).getTime();
      if (currentNow - time > currentRetentionMs) {
        if (sub.imageFile) {
          const filePath = path.join(UPLOADS_DIR, sub.imageFile);
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) {}
          }
        }
        changed = true;
      } else {
        newSubmissions.push(sub);
      }
    }
    
    if (changed) {
      lockedDb.submissions = newSubmissions;
    }
  });
}

