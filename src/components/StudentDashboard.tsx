import { useState } from 'react';
import { Search, Image as ImageIcon, AlertCircle, CheckCircle } from 'lucide-react';
import { Submission } from '../../server/db';

export default function StudentDashboard() {
  const [studentId, setStudentId] = useState('');
  const [result, setResult] = useState<Submission | null>(null);
  const [error, setError] = useState('');
  const [isWithinWindow, setIsWithinWindow] = useState(false);
  const [loading, setLoading] = useState(false);
  
  const [appealReason, setAppealReason] = useState('');
  const [submittingAppeal, setSubmittingAppeal] = useState(false);
  const [appealSuccess, setAppealSuccess] = useState(false);

  const fetchScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!studentId.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);
    setAppealSuccess(false);
    
    try {
      const res = await fetch(`/api/student/result/${studentId}`);
      const data = await res.json();
      if (data.success) {
        setResult(data.submission);
        setIsWithinWindow(data.isWithinWindow);
      } else {
        setError(data.error || 'Không tìm thấy kết quả.');
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
      const res = await fetch('/api/student/appeal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: result.id, reason: appealReason })
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
    <div className="max-w-2xl mx-auto space-y-8">
      
      <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 p-6">
        <h2 className="text-xl font-bold text-neutral-900 mb-2">Tra cứu điểm thi</h2>
        <p className="text-sm text-neutral-500 mb-6">Nhập Số báo danh của bạn để xem kết quả và bài thi chi tiết.</p>
        
        <form onSubmit={fetchScore} className="flex gap-3">
          <input 
            type="text" 
            placeholder="Ví dụ: 123456" 
            value={studentId}
            onChange={e => setStudentId(e.target.value)}
            className="flex-1 border border-neutral-300 rounded-lg px-4 py-2 text-lg font-medium focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          <button type="submit" disabled={loading} className="px-6 py-2 bg-indigo-600 text-white font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-70 flex items-center gap-2">
            <Search className="w-5 h-5" />
            Tra cứu
          </button>
        </form>
        {error && <p className="text-red-500 text-sm mt-4 font-medium flex items-center gap-1.5"><AlertCircle className="w-4 h-4"/> {error}</p>}
      </section>

      {result && (
      <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
        <div className="p-6 border-b border-neutral-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">Kết quả của SBD</h3>
            <p className="text-3xl font-bold text-neutral-900 mt-1">{result.studentId}</p>
          </div>
          <div className="text-right">
            <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">Tổng điểm</h3>
            <p className="text-4xl font-bold text-emerald-600 mt-1">{result.score.toFixed(1)} <span className="text-lg text-neutral-400 font-normal">/ 10</span></p>
          </div>
        </div>
        
        <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-neutral-100">
          <div className="p-6">
            <h4 className="font-semibold text-neutral-800 mb-4 flex items-center gap-2"><ImageIcon className="w-4 h-4 text-indigo-500"/> Ảnh bài thi gốc</h4>
            <div className="bg-neutral-100 rounded-lg p-2 border border-neutral-200">
              <img src={`/uploads/${result.imageFile}`} alt="Bài thi" className="w-full h-auto rounded object-contain" style={{maxHeight:'500px'}} />
            </div>
            <p className="text-xs text-neutral-400 mt-3 text-center">Ảnh bài thi của bạn được lưu trữ trên hệ thống.</p>
          </div>
          
          <div className="p-6 flex flex-col">
            <h4 className="font-semibold text-neutral-800 mb-4">Chi tiết bài làm (Mã đề: {result.testCode})</h4>
            <div className="flex-1 overflow-y-auto max-h-[300px] border border-neutral-100 rounded-lg mb-6">
               <table className="w-full text-xs text-left">
                 <thead className="bg-neutral-50 sticky top-0">
                   <tr><th className="p-2 border-b">Câu</th><th className="p-2 border-b">Đáp án của bạn</th><th className="p-2 border-b">Đáp án chuẩn</th></tr>
                 </thead>
                 <tbody>
                   {result.results.map((r, i) => (
                     <tr key={i} className={r.isCorrect ? "bg-emerald-50/30" : "bg-red-50/30"}>
                       <td className="p-2 border-b font-medium">{r.questionNumber}</td>
                       <td className="p-2 border-b text-neutral-700">{r.extractedAnswer || '-'}</td>
                       <td className={`p-2 border-b font-medium ${r.isCorrect ? "text-emerald-600" : "text-red-500"}`}>{r.correctAnswer.toString()}</td>
                     </tr>
                   ))}
                 </tbody>
               </table>
            </div>

            {/* Appeal Section */}
            <div className="bg-neutral-50 rounded-xl p-4 border border-neutral-100 mt-auto">
              <h4 className="font-semibold text-neutral-800 text-sm mb-2">Đề nghị Phúc khảo</h4>
              
              {!isWithinWindow && result.status === 'graded' && (
                <p className="text-sm text-red-500 bg-red-50 p-2 rounded">Đã hết thời gian cho phép gửi yêu cầu phúc khảo.</p>
              )}
              
              {result.status === 'appeal_pending' && (
                <div className="flex items-start gap-2 text-amber-700 bg-amber-50 p-3 rounded border border-amber-200 text-sm">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Đang chờ xử lý</p>
                    <p className="text-xs mt-1">Yêu cầu của bạn đang được giáo viên xem xét.</p>
                  </div>
                </div>
              )}

              {result.status === 'appeal_resolved' && (
                <div className="flex items-start gap-2 text-emerald-700 bg-emerald-50 p-3 rounded border border-emerald-200 text-sm">
                  <CheckCircle className="w-5 h-5 shrink-0" />
                  <div>
                    <p className="font-semibold">Đã được giải quyết</p>
                    <p className="text-xs mt-1">Yêu cầu phúc khảo của bạn đã được giáo viên hoàn tất kiểm tra.</p>
                  </div>
                </div>
              )}

              {isWithinWindow && result.status === 'graded' && (
                <form onSubmit={handeSubmitAppeal} className="space-y-3">
                  {appealSuccess && <p className="text-xs font-semibold text-emerald-600">Đã gửi yêu cầu thành công!</p>}
                  <textarea 
                    value={appealReason}
                    onChange={e => setAppealReason(e.target.value)}
                    placeholder="Nhập lý do phúc khảo (ví dụ: Chấm sai câu I.4, tôi tô đáp án B theo ảnh gốc)..."
                    className="w-full border border-neutral-300 rounded-md p-2 text-sm focus:ring-1 focus:ring-amber-500 outline-none resize-none h-20"
                    required
                  ></textarea>
                  <button type="submit" disabled={submittingAppeal} className="w-full py-2 bg-amber-500 text-white text-sm font-semibold rounded-md hover:bg-amber-600 disabled:opacity-50 transition-colors">
                    Gửi yêu cầu Phúc khảo
                  </button>
                </form>
              )}
            </div>
            
          </div>
        </div>
      </section>
      )}
    </div>
  );
}
