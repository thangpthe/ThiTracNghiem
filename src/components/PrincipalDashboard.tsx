import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { LayoutDashboard, Users, BookOpen, GraduationCap, TrendingUp } from 'lucide-react';
import { apiFetch } from '../lib/api';

interface ClassStat {
  className: string;
  averageScore: number;
  studentCount: number;
}

interface PrincipalStats {
  totalSubmissions: number;
  averageScore: number;
  classAverages: ClassStat[];
  submissions: Array<{studentId: string, testCode: string, score: number}>;
}

export default function PrincipalDashboard() {
  const [stats, setStats] = useState<PrincipalStats | null>(null);

  useEffect(() => {
    apiFetch('/api/principal/stats')
      .then(r => r.json())
      .then(data => {
        if (data.success) {
          setStats(data);
        }
      });
  }, []);

  if (!stats) {
    return <div className="text-center py-10 text-neutral-500">Đang tải báo cáo...</div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
          <LayoutDashboard className="w-6 h-6 text-indigo-600" />
          Báo cáo & Thống kê
        </h2>
        <p className="text-neutral-500 text-sm mt-1">Dành cho Cán bộ Quản lý / Hiệu trưởng</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-sm flex items-start gap-4">
          <div className="p-3 bg-blue-50 text-blue-600 rounded-lg"><Users className="w-6 h-6" /></div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Tổng số bài thi</p>
            <p className="text-2xl font-bold text-neutral-900">{stats.totalSubmissions}</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-sm flex items-start gap-4">
          <div className="p-3 bg-emerald-50 text-emerald-600 rounded-lg"><TrendingUp className="w-6 h-6" /></div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Điểm trung bình (Toàn trường)</p>
            <p className="text-2xl font-bold text-neutral-900">{stats.averageScore.toFixed(2)}</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-neutral-200 shadow-sm flex items-start gap-4">
          <div className="p-3 bg-purple-50 text-purple-600 rounded-lg"><GraduationCap className="w-6 h-6" /></div>
          <div>
            <p className="text-sm font-medium text-neutral-500">Số Lớp tham gia</p>
            <p className="text-2xl font-bold text-neutral-900">{stats.classAverages.length}</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-6">
        <h3 className="font-semibold text-neutral-800 mb-6 text-lg flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-indigo-500" />
          Phổ điểm trung bình theo Lớp
        </h3>
        {stats.classAverages.length > 0 ? (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.classAverages} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                <XAxis dataKey="className" axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#6B7280', fontSize: 12}} domain={[0, 10]} />
                <Tooltip 
                  cursor={{fill: '#F3F4F6'}}
                  contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'}}
                />
                <Bar dataKey="averageScore" name="Điểm TB" fill="#6366F1" radius={[4, 4, 0, 0]} maxBarSize={50} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="text-center text-neutral-500 py-10">Chưa có dữ liệu bài thi để hiển thị biểu đồ.</div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-neutral-100 bg-neutral-50">
          <h3 className="font-semibold text-neutral-800">Danh sách tổng hợp (Học sinh)</h3>
        </div>
        <div className="max-h-[300px] overflow-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-white sticky top-0 border-b border-neutral-100">
              <tr>
                <th className="px-5 py-3 font-semibold text-neutral-600">SBD (Học sinh)</th>
                <th className="px-5 py-3 font-semibold text-neutral-600">Mã đề</th>
                <th className="px-5 py-3 font-semibold text-neutral-600">Điểm số</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {stats.submissions.map((sub, idx) => (
                <tr key={idx}>
                  <td className="px-5 py-3 font-medium">{sub.studentId}</td>
                  <td className="px-5 py-3 text-neutral-500">{sub.testCode}</td>
                  <td className="px-5 py-3 font-bold text-emerald-600">{sub.score.toFixed(1)}</td>
                </tr>
              ))}
              {stats.submissions.length === 0 && (
                <tr><td colSpan={3} className="px-5 py-4 text-center text-neutral-500">Chưa có bản ghi nào.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
