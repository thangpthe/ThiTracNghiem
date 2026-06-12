import React, { useState } from 'react';
import { Search, Image as ImageIcon, AlertCircle, CheckCircle, ArrowRight, ScanFace } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { Submission } from '../../server/db';

export default function PublicScoreLookup({ onGoToLogin }: { onGoToLogin: () => void }) {
  const [studentId, setStudentId] = useState('');
  const [testCode, setTestCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [className, setClassName] = useState('');
  
  const [result, setResult] = useState<Submission | null>(null);
  const [error, setError] = useState('');
  const [isWithinWindow, setIsWithinWindow] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [appealReason, setAppealReason] = useState('');
  const [submittingAppeal, setSubmittingAppeal] = useState(false);
  const [appealSuccess, setAppealSuccess] = useState(false);

  const fetchScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId.trim() || !testCode.trim() || !fullName.trim() || !className.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    setAppealSuccess(false);
    
    try {
      // Send fullName and className along with the query so backend could optionally log it or just query by ID & testCode
      const res = await apiFetch(`/api/public/result?studentId=${studentId}&testCode=${testCode}&name=${encodeURIComponent(fullName)}&className=${encodeURIComponent(className)}`);
      const data = await res.json();
      if (data.success) {
        setResult(data.submission);
        setIsWithinWindow(data.isWithinWindow);
      } else {
        setError(data.error || 'Không tìm thấy kết quả. Vui lòng kiểm tra lại thông tin.');
      }
    } catch(err) {
      setError('Lỗi kết nối tới máy chủ.');
    }
    setLoading(false);
  };

  const handeSubmitAppeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!result || !appealReason.trim()) return;
    setSubmittingAppeal(true);
    try {
      const res = await apiFetch('/api/student/appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: result.id, reason: appealReason, fullName, className })
      });
      const data = await res.json();
      if (data.success) {
        setResult(data.submission);
        setAppealSuccess(true);
      } else {
        alert(data.error);
      }
    } catch(err) {
      alert('Lỗi gửi yêu cầu.');
    }
    setSubmittingAppeal(false);
  };

  return (
    <div className="min-h-screen bg-neutral-50/50 flex flex-col items-center p-4">
      <div className="w-full max-w-4xl flex justify-between items-center py-6">
        <div className="flex items-center gap-2.5 text-indigo-600">
            <div className="p-1.5 bg-indigo-50 rounded-lg">
              <ScanFace className="w-6 h-6 stroke-[2.5]" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">Vision Grader</h1>
        </div>
        <button onClick={onGoToLogin} className="text-sm font-medium text-neutral-600 hover:text-neutral-900 flex items-center gap-1.5">
          Dành cho Cán bộ / Giáo viên <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      <div className="w-full max-w-4xl space-y-8">
        
        <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-8">
          <h2 className="text-2xl font-bold text-neutral-900 mb-2">Tra cứu điểm thi</h2>
          <p className="text-sm text-neutral-500 mb-8">Nhập thông tin của bạn để xem kết quả và bài thi chi tiết.</p>
          
          <form onSubmit={fetchScore} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Số báo danh (SBD)</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: 123456" 
                  value={studentId}
                  onChange={e => setStudentId(e.target.value)}
                  className="w-full border border-neutral-300 rounded-lg px-4 py-2.5 font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Mã đề</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: 101" 
                  value={testCode}
                  onChange={e => setTestCode(e.target.value)}
                  className="w-full border border-neutral-300 rounded-lg px-4 py-2.5 font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Họ và tên</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: Nguyễn Văn A" 
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full border border-neutral-300 rounded-lg px-4 py-2.5 font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1.5">Lớp</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: 12A1" 
                  value={className}
                  onChange={e => setClassName(e.target.value)}
                  className="w-full border border-neutral-300 rounded-lg px-4 py-2.5 font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
                  required
                />
              </div>
            </div>

            <div className="pt-2 border-t border-neutral-100 flex items-center justify-between">
              <div className="flex-1">
                {error && <p className="text-red-500 text-sm font-medium flex items-center gap-1.5"><AlertCircle className="w-4 h-4"/> {error}</p>}
              </div>
              <button type="submit" disabled={loading} className="px-8 py-2.5 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-70 flex items-center gap-2 transition-colors">
                <Search className="w-5 h-5" />
                {loading ? 'Đang tìm kiếm...' : 'Tra cứu'}
              </button>
            </div>
          </form>
        </section>

        {result && (
        <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden mb-12 fade-in">
          <div className="p-6 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-4 bg-neutral-50/50">
            <div>
              <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider mb-1">Thông tin thi</h3>
              <p className="text-xl font-bold text-neutral-900">{fullName} <span className="text-neutral-400 font-normal">|</span> {className}</p>
              <p className="text-sm text-neutral-600 mt-0.5">SBD: <span className="font-semibold text-neutral-900">{result.studentId}</span></p>
            </div>
            <div className="text-right">
              <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider mb-1">Tổng điểm</h3>
              <p className="text-4xl font-bold text-emerald-600 leading-none">{result.score.toFixed(1)} <span className="text-lg text-neutral-400 font-normal">/ 10</span></p>
            </div>
          </div>
          
          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-neutral-100">
            <div className="p-6 bg-neutral-50/30">
              <h4 className="font-semibold text-neutral-800 mb-4 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-indigo-500"/> Ảnh bài thi gốc</h4>
              <div className="bg-white rounded-lg p-2 border border-neutral-200 flex justify-center items-center shadow-sm">
                <img src={`/uploads/${result.imageFile}`} alt="Bài thi" className="w-full h-auto rounded object-contain max-h-[500px]" />
              </div>
              <p className="text-xs text-neutral-400 mt-3 text-center">Ảnh bài thi của bạn được lưu trữ trên hệ thống trong vòng 30 ngày.</p>
            </div>
            
            <div className="p-6 flex flex-col">
              <h4 className="font-semibold text-neutral-800 mb-4 bg-indigo-50 text-indigo-800 inline-block px-3 py-1 rounded-md text-sm">Mã đề: {result.testCode}</h4>
              <div className="flex-1 overflow-y-auto max-h-[350px] border border-neutral-200 rounded-lg mb-6 custom-scrollbar shadow-inner bg-white">
                 <table className="w-full text-sm text-left">
                   <thead className="bg-neutral-100 sticky top-0 shadow-sm z-10 text-neutral-600">
                     <tr><th className="px-4 py-3 border-b font-medium">Câu</th><th className="px-4 py-3 border-b font-medium">Đáp án của bạn</th><th className="px-4 py-3 border-b font-medium">Đáp án chuẩn</th></tr>
                   </thead>
                   <tbody>
                     {result.results.map((r, i) => (
                       <tr key={i} className={`border-b border-neutral-50 last:border-0 ${r.isCorrect ? "" : "bg-red-50/30"}`}>
                         <td className="px-4 py-2.5 font-medium text-neutral-600 border-r border-neutral-50 w-16">{r.questionNumber}</td>
                         <td className="px-4 py-2.5 text-neutral-800">{r.extractedAnswer || '-'}</td>
                         <td className={`px-4 py-2.5 font-semibold ${r.isCorrect ? "text-emerald-600" : "text-red-500"}`}>{r.correctAnswer.toString()}</td>
                       </tr>
                     ))}
                   </tbody>
                 </table>
              </div>

              {/* Appeal Section */}
              <div className="bg-white rounded-xl p-5 border border-neutral-200 shadow-sm mt-auto">
                <h4 className="font-semibold text-neutral-800 mb-3 flex items-center gap-2">
                  Đề nghị Phúc khảo
                </h4>
                
                {!isWithinWindow && result.status === 'graded' && (
                  <p className="text-sm text-neutral-600 bg-neutral-100 p-3 rounded-lg border border-neutral-200">Đã hết thời gian cho phép gửi yêu cầu phúc khảo.</p>
                )}
                
                {result.status === 'appeal_pending' && (
                  <div className="flex items-start gap-3 text-amber-800 bg-amber-50 p-4 rounded-lg border border-amber-200">
                    <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Đang chờ xử lý</p>
                      <p className="text-sm mt-1 opacity-90">Yêu cầu của bạn đang được giáo viên xem xét và chấm lại thủ công.</p>
                    </div>
                  </div>
                )}

                {result.status === 'appeal_resolved' && (
                  <div className="flex items-start gap-3 text-emerald-800 bg-emerald-50 p-4 rounded-lg border border-emerald-200">
                    <CheckCircle className="w-5 h-5 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Đã được giải quyết</p>
                      <p className="text-sm mt-1 opacity-90">Yêu cầu phúc khảo của bạn đã được giáo viên hoàn tất kiểm tra. Điểm trên hệ thống là điểm cuối cùng.</p>
                    </div>
                  </div>
                )}

                {isWithinWindow && result.status === 'graded' && (
                  <form onSubmit={handeSubmitAppeal} className="space-y-4">
                    {appealSuccess && <p className="text-sm font-semibold text-emerald-600 bg-emerald-50 p-2 rounded border border-emerald-100 flex items-center gap-1.5"><CheckCircle className="w-4 h-4"/> Đã gửi yêu cầu thành công!</p>}
                    <div>
                      <label className="block text-xs font-medium text-neutral-600 mb-1.5 uppercase tracking-wider">Lý do phúc khảo</label>
                      <textarea 
                        value={appealReason}
                        onChange={e => setAppealReason(e.target.value)}
                        placeholder="Ví dụ: Chấm sai câu 4, trong ảnh gốc em đã tô đáp án B..."
                        className="w-full border border-neutral-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none h-24"
                        required
                      ></textarea>
                    </div>
                    <button type="submit" disabled={submittingAppeal} className="w-full py-2.5 bg-neutral-900 text-white text-sm font-semibold rounded-lg hover:bg-neutral-800 disabled:opacity-50 transition-colors">
                      {submittingAppeal ? 'Đang gửi...' : 'Gửi yêu cầu Phúc khảo'}
                    </button>
                  </form>
                )}
              </div>
              
            </div>
          </div>
        </section>
        )}
      </div>
    </div>
  );
}
