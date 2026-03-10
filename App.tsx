import React, { useState, useEffect } from 'react';
import { LiveData } from './components/LiveData';
import { Login } from './components/Login';
import { AdminPanel } from './components/AdminPanel';

interface AuthUser {
  userId: string;
  username: string;
  rol: string;
  nombre: string;
}

const App: React.FC = () => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [verifying, setVerifying] = useState(true);
  const [showAdmin, setShowAdmin] = useState(false);

  // On mount: check if we already have a valid token
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) { setVerifying(false); return; }
    fetch('/api/auth/verify', { headers: { 'Authorization': `Bearer ${token}` } })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => setUser(data.user))
      .catch(() => { localStorage.removeItem('auth_token'); localStorage.removeItem('auth_user'); })
      .finally(() => setVerifying(false));
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setUser(null);
    setShowAdmin(false);
  };

  if (verifying) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', fontFamily: "'Inter', sans-serif" }}>
        <div style={{ textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ width: '40px', height: '40px', border: '4px solid #e2e8f0', borderTopColor: '#1B6DB5', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px' }} />
          <p style={{ fontSize: '13px', fontWeight: 600 }}>Verificando sesión...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login onLoginSuccess={setUser} />;
  }

  return (
    <div className="bg-slate-50 h-[100dvh] flex flex-col font-sans overflow-hidden">
      <LiveData
        user={user}
        onLogout={handleLogout}
        onOpenAdmin={user.rol === 'admin' ? () => setShowAdmin(true) : undefined}
      />

      {showAdmin && (
        <AdminPanel currentUser={user} onClose={() => setShowAdmin(false)} />
      )}
    </div>
  );
};

export default App;
