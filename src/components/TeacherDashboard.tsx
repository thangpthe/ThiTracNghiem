import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, CheckCircle, RefreshCw, AlertCircle, KeyRound, Clock, Users, BookOpen } from 'lucide-react';
import { cn } from '../lib/utils';
import { apiFetch } from '../lib/api';
import * as xlsx from 'xlsx';
import mammoth from 'mammoth';

export default function TeacherDashboard({ user }: { user: any }) {
  const [tab, setTab] = useState<'upload' | 'stats'>('upload');
  
  const [keyError, setKeyError] = useState<string | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  
  const keyInputRef = useRef<HTMLInputElement>(null);

  const fetchState = async () => {
    try {
      setFetchError(null);
      const [histRes, statRes] = await Promise.all([
        apiFetch(`/api/teacher/keys/history/${user.cccd}`).then(r => r.json()),
        apiFetch(`/api/teacher/stats/${user.cccd}`).then(r => r.json()),
      ]);
      setPendingKeys(histRes.pendingKeys || []);
      setStats(statRes);
    } catch(e) {
      setFetchError('Lỗi kết nối tới máy chủ. Vui lòng thử lại sau.');
    }
  };

  useEffect(() => { fetchState(); }, [tab]);

  const handleKeysUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setKeyError(null);
    let errorAcc = '';
    
    for (let i = 0; i < files.length; i++) {
       const file = files[i];
       const testCode = file.name.split('.')[0];
       let parsedKey: any = null;
       
       try {
           if (file.name.endsWith('.json')) {
              parsedKey = JSON.parse(await file.text());
           } else {
              let rawText = '';
              if (file.name.endsWith('.docx')) {
                  const arrayBuffer = await file.arrayBuffer();
                  const result = await mammoth.extractRawText({ arrayBuffer });
                  rawText = result.value;
              } else if (file.name.endsWith('.xlsx')) {
                  const arrayBuffer = await file.arrayBuffer();
                  const workbook = xlsx.read(arrayBuffer, { type: 'array' });
                  Object.keys(workbook.Sheets).forEach(sheetName => {
                      rawText += xlsx.utils.sheet_to_csv(workbook.Sheets[sheetName]) + '\n';
                  });
              } else if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
                  rawText = await file.text();
              }
              
              const res = await apiFetch('/api/admin/parse-key', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ rawText })
              });
              const data = await res.json();
              if (data.success && Object.keys(data.keyDict).length > 0) {
                   parsedKey = data.keyDict;
              }
           }
           
           if (parsedKey && Object.keys(parsedKey).length > 0) {
              await apiFetch('/api/teacher/keys/submit', {
                 method: 'POST',
                 headers: { 'Content-Type': 'application/json' },
                 body: JSON.stringify({ testCode, keyData: parsedKey, teacherId: user.cccd })
              });
           } else {
              errorAcc += `\nKhông thể trích xuất đáp án từ ${file.name}`;
           }
       } catch(err: any) {
           errorAcc += `\nLỗi đọc file ${file.name}: ${err.message}`;
       }
    }
    
    if (errorAcc) setKeyError(errorAcc);
    fetchState();
    if (keyInputRef.current) keyInputRef.current.value = '';
  };

  return (
    <div className="space-y-8">
      {fetchError && (
        <div className="bg-red-50 text-red-600 p-4 rounded-lg flex items-center gap-2 mb-4">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{fetchError}</p>
        </div>
      )}
      <div className="flex border-b border-neutral-200">
        <button className={cn("pb-2 px-4 font-medium text-sm transition-colors", tab==='upload' ? "border-b-2 border-indigo-600 text-indigo-600" : "text-neutral-500 hover:text-neutral-700")} onClick={()=>setTab('upload')}>Đề xuất Đáp án</button>
        <button className={cn("pb-2 px-4 font-medium text-sm transition-colors", tab==='stats' ? "border-b-2 border-indigo-600 text-indigo-600" : "text-neutral-500 hover:text-neutral-700")} onClick={()=>setTab('stats')}>Thống kê Lớp phụ trách</button>
      </div>

      {tab === 'upload' && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="p-4 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/80">
            <h2 className="font-semibold text-neutral-800 flex items-center gap-2 text-sm">
              <KeyRound className="w-4 h-4 text-indigo-500" />
              Đẩy lên Đáp án (Cần Admin duyệt)
            </h2>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <input type="file" accept=".json,.txt,.csv,.docx,.xlsx" multiple ref={keyInputRef} onChange={handleKeysUpload} className="hidden" />
            <div className="text-center py-6">
                <button 
                  onClick={() => keyInputRef.current?.click()} 
                  className="w-full relative group border-2 border-dashed border-indigo-300 rounded-xl p-6 flex flex-col items-center justify-center gap-2 transition-all hover:border-indigo-400 hover:bg-indigo-50/50"
                 >
                  <UploadCloud className="w-6 h-6 text-indigo-500" />
                  <span className="text-sm font-medium text-neutral-800">Tải file Đáp án lên (.docx, .xlsx, .json, .txt)</span>
                </button>
            </div>
            {keyError && <p className="text-xs text-red-600 mt-1 whitespace-pre-wrap">{keyError}</p>}
            <p className="text-[11px] text-amber-600 bg-amber-50 p-2 rounded">
              Ghi chú: Mọi đáp án bạn đẩy lên sẽ chuyển vào trạng thái CHỜ DUYỆT. Hệ thống chỉ chấm điểm khi Admin (Quản trị viên) đã chấp thuận mã đề này. Tên file sẽ được tự động đóng vai trò là "Mã đề".
            </p>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="p-4 border-b border-neutral-100 bg-neutral-50/80">
            <h2 className="font-semibold text-neutral-800 text-sm">Lịch sử Đề xuất</h2>
          </div>
          <div className="overflow-auto max-h-[350px]">
            <table className="w-full text-sm text-left">
               <thead className="bg-neutral-50 text-xs uppercase text-neutral-500 sticky top-0 border-b border-neutral-100">
                 <tr>
                   <th className="px-4 py-3">Mã đề</th>
                   <th className="px-4 py-3">Thời gian</th>
                   <th className="px-4 py-3 text-right">Trạng thái</th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-neutral-100">
                 {pendingKeys.map(k => (
                   <tr key={k.id}>
                     <td className="px-4 py-3 font-semibold">{k.testCode}</td>
                     <td className="px-4 py-3 text-xs text-neutral-500">{new Date(k.timestamp).toLocaleString('vi-VN')}</td>
                     <td className="px-4 py-3 text-right">
                       {k.status === 'pending' && <span className="text-amber-600 text-xs font-semibold bg-amber-50 px-2 py-1 rounded flex items-center gap-1 justify-end w-max ml-auto"><Clock className="w-3 h-3"/> Đang chờ</span>}
                       {k.status === 'approved' && <span className="text-emerald-600 text-xs font-semibold bg-emerald-50 px-2 py-1 rounded flex items-center gap-1 justify-end w-max ml-auto"><CheckCircle className="w-3 h-3"/> Đã duyệt</span>}
                       {k.status === 'rejected' && <span className="text-red-600 text-xs font-semibold bg-red-50 px-2 py-1 rounded flex items-center gap-1 justify-end w-max ml-auto"><AlertCircle className="w-3 h-3"/> Bị từ chối</span>}
                     </td>
                   </tr>
                 ))}
                 {pendingKeys.length === 0 && <tr><td colSpan={3} className="px-4 py-6 text-center text-neutral-400 text-sm italic">Chưa có đề xuất nào.</td></tr>}
               </tbody>
            </table>
          </div>
        </section>
      </div>
      )}

      {tab === 'stats' && stats && (
         <div className="flex flex-col gap-6">
         <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
            <div className="p-4 border-b border-neutral-100 bg-neutral-50/80 flex justify-between items-center">
              <h2 className="font-semibold text-neutral-800 text-sm flex items-center gap-2">
                 <Users className="w-4 h-4 text-indigo-500" />
                 Thống kê lớp phụ trách ({stats.assignedClass})
              </h2>
            </div>
            <div className="p-5 flex gap-6 border-b border-neutral-100 bg-white">
               <div className="bg-neutral-50 border border-neutral-200 rounded-lg p-4 flex-1">
                  <p className="text-xs text-neutral-500 uppercase tracking-wider font-semibold mb-1">Số bài đã chấm</p>
                  <p className="text-3xl font-bold text-neutral-900">{stats.totalSubmissions}</p>
               </div>
               <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex-1">
                  <p className="text-xs text-emerald-600 uppercase tracking-wider font-semibold mb-1">Điểm Trung bình</p>
                  <p className="text-3xl font-bold text-emerald-700">{stats.averageScore.toFixed(2)}</p>
               </div>
            </div>
            
            <div className="overflow-x-auto max-h-[400px]">
              <table className="w-full text-sm text-left">
                <thead className="bg-neutral-50 border-b border-neutral-100 text-xs uppercase text-neutral-500 sticky top-0">
                  <tr>
                    <th className="px-4 py-3">Thời gian</th>
                    <th className="px-4 py-3">Số báo danh</th>
                    <th className="px-4 py-3">Mã đề</th>
                    <th className="px-4 py-3 text-right">Điểm số</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {stats.submissions.map((s: any) => (
                    <tr key={s.id}>
                      <td className="px-4 py-3 text-xs text-neutral-500">{new Date(s.timestamp).toLocaleString('vi-VN')}</td>
                      <td className="px-4 py-3 font-semibold">{s.studentId}</td>
                      <td className="px-4 py-3 text-neutral-600">{s.testCode}</td>
                      <td className="px-4 py-3 font-bold text-emerald-600 text-right">{s.score.toFixed(1)}</td>
                    </tr>
                  ))}
                  {stats.submissions.length === 0 && (
                     <tr><td colSpan={4} className="text-center py-6 text-neutral-500 italic">Chưa có bài kiểm tra nào của {stats.assignedClass}.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
         </section>
         
         <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden mt-6">
            <div className="p-4 border-b border-neutral-100 bg-neutral-50/80">
              <h2 className="font-semibold text-neutral-800 text-sm flex items-center gap-2">
                 <BookOpen className="w-4 h-4 text-indigo-500" />
                 Thống kê các lớp trong Khối {stats.grade}
              </h2>
            </div>
            <div className="p-5">
               <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {stats.gradeClassAverages?.map((c: any) => (
                    <div key={c.className} className={cn("p-4 rounded-xl border", c.className === stats.assignedClass ? "border-indigo-300 bg-indigo-50/50" : "border-neutral-200 bg-white")}>
                       <p className="text-sm font-semibold text-neutral-800 flex items-center justify-between">
                         {c.className}
                         {c.className === stats.assignedClass && <span className="text-[10px] text-indigo-600 bg-indigo-100 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider">Lớp bạn</span>}
                       </p>
                       <p className="text-2xl font-bold text-emerald-600 mt-2">{c.averageScore.toFixed(2)}</p>
                       <p className="text-xs text-neutral-500 font-medium">Điểm trung bình</p>
                    </div>
                  ))}
                  {(!stats.gradeClassAverages || stats.gradeClassAverages.length === 0) && (
                     <div className="col-span-full text-center py-6 text-neutral-500 italic text-sm">Chưa có dữ liệu bài thi của khối {stats.grade}.</div>
                  )}
               </div>
            </div>
         </section>
         </div>
      )}
    </div>
  );
}
