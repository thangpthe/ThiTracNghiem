import React, { useState, useRef, useEffect } from 'react';
import { UploadCloud, CheckCircle, FileSpreadsheet, RefreshCw, AlertCircle, Scan, Trash2, KeyRound, ImageIcon, Settings } from 'lucide-react';
import { cn, exportToCSV } from '../lib/utils';
import { apiFetch } from '../lib/api';
import { Submission } from '../../server/db'; 
import * as xlsx from 'xlsx';
import mammoth from 'mammoth';

interface QueueItem {
  id: string;
  file: File;
  previewUrl: string;
  status: 'idle' | 'extracting' | 'success' | 'error';
  result?: any;
  error?: string;
}

export default function AdminDashboard() {
  const [keysCount, setKeysCount] = useState<number>(0);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isProcessingBatch, setIsProcessingBatch] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pendingKeys, setPendingKeys] = useState<any[]>([]);
  const [tab, setTab] = useState<'scan' | 'submissions' | 'approvals' | 'settings'>('scan');

  const [settings, setSettings] = useState({ appealWindowDays: 3, retentionDays: 15 });
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  const fetchState = async () => {
    try {
      if (tab === 'scan' || tab === 'submissions') {
        const keysRes = await apiFetch('/api/admin/keys').then(r => r.json());
        setKeysCount(Object.keys(keysRes.keys || {}).length);
      }
      
      if (tab === 'submissions') {
        const subRes = await apiFetch(`/api/admin/submissions?page=${currentPage}&limit=50`).then(r => r.json());
        setSubmissions(subRes.submissions || []);
        setTotalPages(subRes.pagination?.totalPages || 1);
      } 
      
      if (tab === 'approvals') {
        const pendingRes = await apiFetch('/api/admin/keys/pending').then(r => r.json());
        setPendingKeys(pendingRes.pendingKeys || []);
      }
      
      if (tab === 'settings') {
        const setRes = await apiFetch('/api/admin/settings').then(r => r.json());
        setSettings(setRes.settings || { appealWindowDays: 3, retentionDays: 15 });
      }
    } catch(e) {}
  };

  useEffect(() => { fetchState(); }, [tab, currentPage]);

  const handleKeysUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setKeyError(null);
    let newKeysDict: any = {};
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const testCode = file.name.split('.')[0];
        if (file.name.endsWith('.json')) {
          const text = await file.text();
          newKeysDict[testCode] = JSON.parse(text);
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
            } else {
                throw new Error(`Unsupported type: ${file.name}`);
            }

            // Call API to parse unstructured text
            const res = await apiFetch('/api/admin/parse-key', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ rawText })
            });
            const data = await res.json();
            if (data.success && Object.keys(data.keyDict).length > 0) {
                 newKeysDict[testCode] = data.keyDict;
            } else {
                 setKeyError((prev) => prev ? prev + `\nCould not extract answer key from ${file.name}` : `Could not extract answer key from ${file.name}`);
            }
        }
      } catch (err: any) {
        setKeyError((prev) => prev ? prev + `\nFailed to parse ${file.name}: ${err.message}` : `Failed to parse ${file.name}: ${err.message}`);
      }
    }
    
    try {
       await apiFetch('/api/admin/keys', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ keys: newKeysDict })
       });
       fetchState();
    } catch(e) {}
    if (keyInputRef.current) keyInputRef.current.value = '';
  };

  const handleImagesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newItems: QueueItem[] = Array.from(files).map((file: File, idx) => ({
      id: `${Date.now()}_${idx}`, file, previewUrl: URL.createObjectURL(file), status: 'idle'
    }));
    setQueue(prev => [...prev, ...newItems]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const processFile = async (item: QueueItem): Promise<QueueItem> => {
    try {
      const base64Str = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(item.file);
      });
      
      const orientRes = await apiFetch('/api/detect-orientation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: base64Str }),
      }).then(r => r.json());
      
      let finalBase64 = base64Str;
      if (orientRes.success && orientRes.rotationDegrees) {
        finalBase64 = await new Promise<string>((resolve, reject) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (orientRes.rotationDegrees === 90 || orientRes.rotationDegrees === 270) {
              canvas.width = img.height; canvas.height = img.width;
            } else {
              canvas.width = img.width; canvas.height = img.height;
            }
            if(ctx) {
              ctx.translate(canvas.width / 2, canvas.height / 2);
              ctx.rotate((orientRes.rotationDegrees * Math.PI) / 180);
              ctx.drawImage(img, -img.width / 2, -img.height / 2);
              resolve(canvas.toDataURL('image/jpeg', 0.95));
            } else reject();
          };
          img.onerror = reject; img.src = base64Str;
        });
      }

      const extRes = await apiFetch('/api/extract-sheet', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageBase64: finalBase64 }),
      }).then(r => r.json());

      if (!extRes.success) throw new Error(extRes.error || 'Failed');
      return { ...item, status: 'success', result: extRes.data };
    } catch (error: any) {
      return { ...item, status: 'error', error: error.message || 'Processing failed' };
    }
  };

  const processBatch = async () => {
    if (queue.length === 0) return;
    setIsProcessingBatch(true);
    const currentQueue = [...queue];
    
    const MAX_CONCURRENT = 3;
    let i = 0;
    
    const executeNext = async (): Promise<void> => {
      if (i >= currentQueue.length) return;
      const index = i++;
      const item = currentQueue[index];
      if (item.status === 'success') {
         return executeNext();
      }
      setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'extracting' } : q));
      const updatedItem = await processFile(item);
      setQueue(prev => prev.map(q => q.id === updatedItem.id ? updatedItem : q));
      return executeNext();
    };

    const workers = [];
    for (let w = 0; w < Math.min(MAX_CONCURRENT, currentQueue.length); w++) {
      workers.push(executeNext());
    }
    
    await Promise.all(workers);
    
    setIsProcessingBatch(false);
    fetchState();
  };
  
  const handleResolveAppeal = async (id: string) => {
    await apiFetch('/api/admin/appeal-resolve', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id})});
    fetchState();
  }

  const handleEditScore = async (id: string, currentScore: number) => {
    const input = prompt(`Nhập điểm mới (hiện tại: ${currentScore}):`, currentScore.toString());
    if (input === null) return;
    const score = parseFloat(input);
    if (!isNaN(score) && score >= 0 && score <= 10) {
       await apiFetch(`/api/admin/submissions/${id}/edit-score`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({score}) });
       fetchState();
    } else {
       alert('Điểm không hợp lệ');
    }
  };

  const handleToggleHide = async (id: string) => {
    await apiFetch(`/api/admin/submissions/${id}/toggle-hide`, { method: 'POST', headers:{'Content-Type':'application/json'} });
    fetchState();
  };

  const handleApproveKey = async (id: string) => {
    await apiFetch('/api/admin/keys/approve', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id})});
    fetchState();
  }

  const handleRejectKey = async (id: string) => {
    await apiFetch('/api/admin/keys/reject', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({id})});
    fetchState();
  }

  const handleUpdateSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    await apiFetch('/api/admin/settings', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(settings)});
    alert('Settings compiled successfully');
  }

  return (
    <div className="space-y-8">
      <div className="flex border-b border-neutral-200 overflow-x-auto">
        <button className={cn("pb-2 px-4 font-medium text-sm transition-colors whitespace-nowrap", tab==='scan' ? "border-b-2 border-indigo-600 text-indigo-600" : "text-neutral-500 hover:text-neutral-700")} onClick={()=>setTab('scan')}>Chấm bài (Scan)</button>
        <button className={cn("pb-2 px-4 font-medium text-sm transition-colors flex items-center gap-2 whitespace-nowrap", tab==='approvals' ? "border-b-2 border-indigo-600 text-indigo-600" : "text-neutral-500 hover:text-neutral-700")} onClick={()=>setTab('approvals')}>
          Phê duyệt Đáp án
          {pendingKeys.length > 0 && <span className="bg-blue-500 text-white text-[10px] px-1.5 rounded-full">{pendingKeys.length}</span>}
        </button>
        <button className={cn("pb-2 px-4 font-medium text-sm transition-colors flex items-center gap-2 whitespace-nowrap", tab==='submissions' ? "border-b-2 border-indigo-600 text-indigo-600" : "text-neutral-500 hover:text-neutral-700")} onClick={()=>setTab('submissions')}>
          Danh sách bài thi 
          {submissions.filter(s => s.status==='appeal_pending').length > 0 && <span className="bg-red-500 text-white text-[10px] px-1.5 rounded-full">{submissions.filter(s => s.status==='appeal_pending').length}</span>}
        </button>
        <button className={cn("pb-2 px-4 font-medium text-sm transition-colors whitespace-nowrap", tab==='settings' ? "border-b-2 border-indigo-600 text-indigo-600" : "text-neutral-500 hover:text-neutral-700")} onClick={()=>setTab('settings')}>Cài đặt hệ thống</button>
      </div>

      {tab === 'scan' && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="p-4 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/80">
            <h2 className="font-semibold text-neutral-800 flex items-center gap-2 text-sm">
              <KeyRound className="w-4 h-4 text-indigo-500" />
              Đáp án chuẩn (Answer Keys)
            </h2>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <input type="file" accept=".json,.txt,.csv,.docx,.xlsx" multiple ref={keyInputRef} onChange={handleKeysUpload} className="hidden" />
            <div className="text-center py-4">
                <p className="text-sm font-medium text-neutral-800 mb-2">Đang có <span className="text-indigo-600 text-lg">{keysCount}</span> mã đề trên hệ thống</p>
                <div className="flex gap-2 justify-center">
                  <button onClick={() => keyInputRef.current?.click()} className="px-3 py-1.5 bg-neutral-100 text-neutral-700 rounded-lg hover:bg-neutral-200 transition text-sm font-medium">Tải lên file Đáp án (.json, .txt, .csv, .docx, .xlsx)</button>
                  <button onClick={async () => { await apiFetch('/api/admin/keys', {method:'POST', body:JSON.stringify({keys:{}}), headers:{'Content-Type':'application/json'}}); fetchState(); }} className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition text-sm font-medium">Xóa tất cả</button>
                </div>
            </div>
            {keyError && <p className="text-xs text-red-600 mt-1 whitespace-pre-wrap">{keyError}</p>}
            <p className="text-[11px] text-neutral-400">Lưu ý: Tên file sẽ được lấy làm Mã đề (vd: "101.docx" -&gt; mã "101"). Admin tải lên sẽ được áp dụng ngay.</p>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="p-4 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/80">
            <h2 className="font-semibold text-neutral-800 flex items-center gap-2 text-sm">
              <ImageIcon className="w-4 h-4 text-emerald-500" /> Quét Phiếu bài thi
            </h2>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <input type="file" accept="image/*" multiple ref={fileInputRef} onChange={handleImagesUpload} className="hidden" />
            <div className="text-center py-4">
               {queue.length === 0 ? (
                 <button onClick={() => fileInputRef.current?.click()} className="w-full relative group border-2 border-dashed border-neutral-300 rounded-xl p-6 flex flex-col items-center justify-center gap-2 transition-all hover:border-emerald-400 hover:bg-emerald-50/50">
                    <UploadCloud className="w-6 h-6 text-emerald-500" />
                    <span className="text-sm font-medium text-neutral-800">Chọn ảnh Phiếu thi</span>
                 </button>
               ) : (
                 <div className="flex flex-col gap-3">
                    <p className="text-sm font-medium text-neutral-800">{queue.length} ảnh đang chờ</p>
                    <div className="flex justify-center gap-2">
                       <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 bg-neutral-100 text-neutral-700 rounded-lg text-sm font-medium">Thêm ảnh</button>
                       <button onClick={processBatch} disabled={isProcessingBatch || keysCount === 0} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg disabled:opacity-50 text-sm font-medium flex items-center gap-2">
                         {isProcessingBatch ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Scan className="w-4 h-4" />}
                         Bắt đầu chấm
                       </button>
                    </div>
                 </div>
               )}
            </div>
          </div>
        </section>

        {queue.length > 0 && (
        <section className="md:col-span-2 bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
          <div className="p-4 border-b border-neutral-100 flex justify-between bg-neutral-50/80">
            <h2 className="font-semibold text-sm">Hàng đợi chấm thi</h2>
            <button onClick={()=>setQueue([])} className="px-2 py-1 border border-neutral-200 rounded text-xs">Clear</button>
          </div>
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-sm text-left">
              <thead className="bg-white sticky top-0 border-b border-neutral-100 text-xs">
                <tr>
                  <th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">SBD</th><th className="px-4 py-3">Mã đề</th><th className="px-4 py-3">Điểm</th><th className="px-4 py-3">Lỗi (nếu có)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {queue.map((item) => (
                  <tr key={item.id}>
                    <td className="px-4 py-3 text-center">
                      {item.status === 'success' && <CheckCircle className="w-4 h-4 text-emerald-500 inline" />}
                      {item.status === 'error' && <AlertCircle className="w-4 h-4 text-red-500 inline" />}
                      {item.status === 'extracting' && <RefreshCw className="w-4 h-4 text-indigo-500 animate-spin inline" />}
                    </td>
                    <td className="px-4 py-3 font-semibold">{item.result?.studentId || '-'}</td>
                    <td className="px-4 py-3">{item.result?.testCode || '-'}</td>
                    <td className="px-4 py-3 font-bold text-emerald-600">{item.result?.score?.toFixed(1) || '-'}</td>
                    <td className="px-4 py-3 text-red-500 text-xs">{item.error || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        )}
      </div>
      )}

      {tab === 'approvals' && (
      <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
        <div className="p-4 border-b border-neutral-100 bg-neutral-50/80">
          <h2 className="font-semibold text-neutral-800 text-sm">Xét duyệt Đáp án từ Giáo viên</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-neutral-50 border-b border-neutral-100 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Thời gian gửi</th>
                <th className="px-4 py-3">Mã đề</th>
                <th className="px-4 py-3">Cán bộ gửi</th>
                <th className="px-4 py-3">Số câu</th>
                <th className="px-4 py-3 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {pendingKeys.map(k => (
                <tr key={k.id}>
                  <td className="px-4 py-3 text-xs text-neutral-500">{new Date(k.timestamp).toLocaleString('vi-VN')}</td>
                  <td className="px-4 py-3 font-semibold text-indigo-600">{k.testCode}</td>
                  <td className="px-4 py-3 text-neutral-600">{k.teacherId}</td>
                  <td className="px-4 py-3 font-medium">{Object.keys(k.keyData || {}).length} câu</td>
                  <td className="px-4 py-3 flex justify-end gap-2">
                    <button onClick={() => handleApproveKey(k.id)} className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700 transition font-medium">Phê duyệt</button>
                    <button onClick={() => handleRejectKey(k.id)} className="px-3 py-1.5 border border-red-200 text-red-600 rounded text-xs hover:bg-red-50 transition font-medium">Từ chối</button>
                  </td>
                </tr>
              ))}
              {pendingKeys.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-neutral-500 italic">Không có yêu cầu duyệt đáp án nào.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {tab === 'submissions' && (
      <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
        <div className="p-4 border-b border-neutral-100 flex justify-between items-center bg-neutral-50/80">
          <h2 className="font-semibold text-neutral-800 text-sm">Danh sách đã chấm ({submissions.length})</h2>
          <button onClick={()=>{
             const data = submissions.map(s => ({ SBD: s.studentId, 'Mã đề': s.testCode, 'Điểm': s.score.toFixed(1), 'Tình trạng': s.status }));
             exportToCSV(data, 'Tat_ca_diem.csv');
          }} className="px-3 py-1.5 bg-neutral-900 text-white text-xs font-medium rounded-lg flex items-center gap-1.5">
            <FileSpreadsheet className="w-4 h-4" /> Xuất File CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-neutral-50 border-b border-neutral-100 text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-4 py-3">Thời gian</th><th className="px-4 py-3">SBD</th><th className="px-4 py-3">Mã đề</th><th className="px-4 py-3 text-center">Điểm</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Phúc khảo</th><th className="px-4 py-3 text-right">Sửa & Ẩn</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {submissions.map(s => (
                <tr key={s.id} className={s.isHidden ? "opacity-50 grayscale bg-neutral-100/50" : ""}>
                  <td className="px-4 py-3 text-xs text-neutral-500">{new Date(s.timestamp).toLocaleString('vi-VN')}</td>
                  <td className="px-4 py-3 font-semibold">{s.studentId}</td>
                  <td className="px-4 py-3">{s.testCode}</td>
                  <td className="px-4 py-3 text-center font-bold text-neutral-900">{s.score.toFixed(1)}</td>
                  <td className="px-4 py-3">
                     <div className="flex gap-1 flex-col items-start w-max">
                       {s.status === 'graded' && <span className="bg-neutral-100 text-neutral-600 px-2 py-0.5 rounded text-xs">Đã chấm</span>}
                       {s.status === 'appeal_pending' && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded text-xs font-bold">Yêu cầu phúc khảo</span>}
                       {s.status === 'appeal_resolved' && <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-xs">Đã giải quyết</span>}
                       {s.isHidden && <span className="bg-red-100 text-red-600 px-2 py-0.5 rounded text-[10px] font-bold">Đã ẩn</span>}
                     </div>
                  </td>
                  <td className="px-4 py-3 text-xs">
                     {s.status === 'appeal_pending' && (
                       <div className="flex flex-col gap-1 items-start">
                         <span className="italic">"{s.appealReason}"</span>
                         <button onClick={()=>handleResolveAppeal(s.id)} className="text-indigo-600 font-medium hover:underline">Xác nhận hoàn thành</button>
                       </div>
                     )}
                     {s.status === 'appeal_resolved' && <span className="text-neutral-400">Đã xong.</span>}
                     {s.status === 'graded' && <span className="text-neutral-300">-</span>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                       <button title="Sửa điểm" onClick={() => handleEditScore(s.id, s.score)} className="p-1 hover:bg-neutral-200 rounded text-neutral-500 transition">✍️</button>
                       <button title={s.isHidden ? "Hiện lại bài thi" : "Ẩn kết quả khỏi học sinh"} onClick={() => handleToggleHide(s.id)} className="p-1 hover:bg-neutral-200 rounded text-neutral-500 transition">{s.isHidden ? '👁️' : '🚫'}</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="p-4 border-t border-neutral-100 flex items-center justify-between text-sm text-neutral-500 bg-neutral-50/50">
            <span>Trang {currentPage} / {totalPages||1}</span>
            <div className="flex gap-2">
               <button disabled={currentPage <= 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))} className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50 font-medium transition-colors shadow-sm">Trước</button>
               <button disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} className="px-3 py-1.5 rounded-lg bg-white border border-neutral-200 hover:bg-neutral-50 disabled:opacity-50 font-medium transition-colors shadow-sm">Sau</button>
            </div>
          </div>
        </div>
      </section>
      )}

      {tab === 'settings' && (
      <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-6 max-w-xl">
        <h2 className="font-semibold text-lg mb-6 flex items-center gap-2"><Settings className="w-5 h-5"/> Cài đặt Hệ thống</h2>
        <form className="space-y-4" onSubmit={handleUpdateSettings}>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Thời gian cho phép Phúc khảo (Ngày)</label>
            <input type="number" min="0" value={settings.appealWindowDays} onChange={e => setSettings({...settings, appealWindowDays: Number(e.target.value)})} className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500" />
            <p className="text-xs text-neutral-500 mt-1">Học sinh chỉ có thể gửi yêu cầu phúc khảo trong khoảng thời gian này kể từ khi bài được chấm.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-neutral-700 mb-1">Thời gian lưu trữ hệ thống (Ngày)</label>
            <input type="number" min="1" value={settings.retentionDays} onChange={e => setSettings({...settings, retentionDays: Number(e.target.value)})} className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500" />
            <p className="text-xs text-neutral-500 mt-1">Bài thi và Hình ảnh sẽ tự động bị xóa sau {settings.retentionDays} ngày để tiết kiệm dung lượng.</p>
          </div>
          <button type="submit" className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700">Lưu cài đặt</button>
        </form>
      </section>
      )}

    </div>
  );
}
