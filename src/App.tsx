import React, { useState, useEffect } from 'react';
import AdminDashboard from './components/AdminDashboard';
import PrincipalDashboard from './components/PrincipalDashboard';
import TeacherDashboard from './components/TeacherDashboard';
import PublicScoreLookup from './components/PublicScoreLookup';
import { ScanFace, Lock, AlertCircle, ArrowRight } from 'lucide-react';
import { cn } from './lib/utils';
import { apiFetch } from './lib/api';
import { User } from '../server/db';

export default function App() {
  const [viewMode, setViewMode] = useState<'lookup' | 'dashboard'>('lookup');
  const [role, setRole] = useState<'teacher' | 'admin' | 'principal'>('teacher');
  const [user, setUser] = useState<{ cccd: string; name: string; role: string; assignedClass?: string } | null>(null);
  
  // Login State
  const [cccd, setCccd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const userStr = localStorage.getItem('vision_grader_user');
    if (userStr) {
      try {
        const u = JSON.parse(userStr);
        setUser(u);
        setRole(u.role as any);
        setViewMode('dashboard');
      } catch(e) {}
    }
  }, []);

  const handleRoleSelect = (selectedRole: typeof role) => {
    setRole(selectedRole);
    if (user?.role !== selectedRole) {
      setUser(null);
      setCccd('');
      setError('');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cccd })
      });
      const data = await res.json();
      if (data.success) {
        if (data.user.role !== role) {
           setError(`CCCD này dành cho ${data.user.role}, không phải ${role}.`);
        } else {
           const sessionUser = { ...data.user, token: data.token };
           setUser(sessionUser);
           localStorage.setItem('vision_grader_user', JSON.stringify(sessionUser));
        }
      } else {
        setError(data.error);
      }
    } catch(err) {
      setError('Lỗi kết nối');
    }
    setLoading(false);
  };

  const handleLogout = () => {
    setUser(null);
    setCccd('');
    localStorage.removeItem('vision_grader_user');
  };

  if (viewMode === 'lookup') {
     return <PublicScoreLookup onGoToLogin={() => setViewMode('dashboard')} />;
  }

  return (
    <div className="min-h-screen bg-neutral-50/50 text-neutral-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10 shadow-sm shadow-black/[0.02]">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 text-indigo-600 cursor-pointer" onClick={() => setViewMode('lookup')}>
            <div className="p-1.5 bg-indigo-50 rounded-lg">
              <ScanFace className="w-6 h-6 stroke-[2.5]" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-neutral-900">Vision Grader</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex bg-neutral-100 p-1 rounded-lg overflow-x-auto w-full md:w-auto">
              <button
                onClick={() => handleRoleSelect('teacher')}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap",
                  role === 'teacher' ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                Giáo viên
              </button>
              <button
                onClick={() => handleRoleSelect('admin')}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap",
                  role === 'admin' ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                Admin
              </button>
              <button
                onClick={() => handleRoleSelect('principal')}
                className={cn(
                  "px-3 py-1.5 text-sm font-medium rounded-md transition-all whitespace-nowrap",
                  role === 'principal' ? "bg-white shadow-sm text-neutral-900" : "text-neutral-500 hover:text-neutral-700"
                )}
              >
                Hiệu trưởng
              </button>
            </div>
          </div>
        </div>
      </header>
      
      <main className="max-w-6xl mx-auto px-4 md:px-6 py-8 md:py-12">
        {!user && (
           <div className="max-w-md mx-auto mt-10 p-8 bg-white border border-neutral-200 rounded-2xl shadow-sm relative">
             <button onClick={() => setViewMode('lookup')} className="absolute top-4 left-4 text-xs font-medium text-neutral-500 hover:text-neutral-900 flex items-center gap-1">
               &larr; Quay lại
             </button>
             <div className="flex flex-col items-center text-center mt-4 mb-6">
                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center mb-3">
                  <Lock className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold text-neutral-900">Xác thực Định danh</h2>
                <p className="text-sm text-neutral-500 mt-1">Sử dụng số CCCD của bạn để đăng nhập vào phân hệ {role === 'admin' ? 'Quản trị' : role === 'teacher' ? 'Giáo viên' : 'Hiệu trưởng'}.</p>
                <div className="text-[11px] text-neutral-400 mt-2 bg-neutral-50 p-2 rounded w-full text-left">
                  <strong>CCCD thử nghiệm:</strong><br/>
                  - Admin: 000000000001<br/>
                  - Teacher: 000000000002<br/>
                  - Principal: 000000000003
                </div>
             </div>
             <form onSubmit={handleLogin} className="space-y-4">
               <div>
                  <label className="block text-sm font-medium text-neutral-700 mb-1">Căn cước Công dân (CCCD)</label>
                  <input 
                    type="text" 
                    value={cccd} 
                    onChange={e => setCccd(e.target.value)}
                    required
                    maxLength={12}
                    className="w-full border border-neutral-300 rounded-md px-3 py-2 text-sm focus:ring-1 focus:ring-indigo-500 font-mono"
                    placeholder="Nhập 12 số CCCD"
                  />
               </div>
               {error && <p className="text-xs text-red-500 flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5"/>{error}</p>}
               <button type="submit" disabled={loading} className="w-full py-2 bg-neutral-900 text-white rounded-md text-sm font-medium hover:bg-black transition-colors disabled:opacity-70">
                 {loading ? 'Đang xác thực...' : 'Đăng nhập'}
               </button>
             </form>
           </div>
        )}

        {user && (
          <div className="mb-6 flex items-center justify-between bg-white px-4 py-3 border border-neutral-200 rounded-xl shadow-sm">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold text-sm">
                {user.name.charAt(0)}
              </div>
              <div>
                <p className="text-sm font-semibold text-neutral-900">{user.name}</p>
                <p className="text-[11px] text-neutral-500">{user.role === 'admin' ? 'Quản trị viên' : user.role === 'teacher' ? `Phụ trách: ${user.assignedClass}` : 'Hiệu trưởng'}</p>
              </div>
            </div>
            <button onClick={handleLogout} className="text-xs font-medium text-neutral-500 hover:text-neutral-900 px-3 py-1.5 bg-neutral-100 rounded-md transition-colors">
              Đăng xuất
            </button>
          </div>
        )}

        {user && role === 'admin' && <AdminDashboard />}
        {user && role === 'teacher' && <TeacherDashboard user={user} />}
        {user && role === 'principal' && <PrincipalDashboard />}
      </main>
    </div>
  );
}
