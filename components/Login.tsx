import React, { useState } from 'react';

interface LoginProps {
  onLoginSuccess: (user: { userId: string; username: string; rol: string; nombre: string }) => void;
}

export const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Error al iniciar sesión');
      } else {
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('auth_user', JSON.stringify(data.user));
        onLoginSuccess(data.user);
      }
    } catch {
      setError('No se pudo conectar con el servidor. Verifica que el backend esté corriendo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100dvh',
      /* Fondo tecnológico tipo red/abstracto usando Unsplash temporalmente, o un degradado fuerte si falla la imagen */
      backgroundImage: 'url("https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2072&auto=format&fit=crop")',
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', sans-serif",
      padding: '16px',
      position: 'relative',
    }}>
      {/* Overlay oscuro para darle contraste a la tarjeta brillante */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 50, 100, 0.4)',
        zIndex: 1
      }}></div>

      {/* Tarjeta Glassmorphism (Efecto Cristal y luces Neón) */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        background: 'rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderRadius: '20px',
        border: '2px solid rgba(100, 200, 255, 0.5)',
        boxShadow: '0 0 30px rgba(0, 150, 255, 0.4), inset 0 0 20px rgba(100, 200, 255, 0.2)',
        padding: '48px 40px',
        width: '100%',
        maxWidth: '420px',
      }}>
        {/* Cabecera */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '12px' }}>
            <img
              src="/logo_issatec.png"
              alt="issatec logo"
              style={{ height: '50px', objectFit: 'contain', filter: 'drop-shadow(0 0 10px rgba(255,255,255,0.8))' }}
            />
          </div>
          <h2 style={{ margin: 0, fontSize: '18px', color: '#fff', fontWeight: 600, letterSpacing: '1px', textShadow: '0 0 10px rgba(255,255,255,0.6)' }}>
            ACCESO AL SISTEMA
          </h2>
          <h1 style={{ margin: '4px 0 0 0', fontSize: '26px', color: '#8be9fd', fontWeight: 800, textShadow: '0 0 15px rgba(139, 233, 253, 0.8)' }}>
            INICIAR SESIÓN
          </h1>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Usuario */}
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#e0f2fe', marginBottom: '8px', textShadow: '0 0 5px rgba(255,255,255,0.3)' }}>
              Usuario
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="ingrese su usuario"
                required
                autoComplete="username"
                className="glass-input"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(139, 233, 253, 0.4)',
                  borderRadius: '10px',
                  fontSize: '15px',
                  color: '#fff',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'all 0.3s ease',
                  boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)',
                }}
                onFocus={e => {
                  e.target.style.borderColor = '#8be9fd';
                  e.target.style.boxShadow = '0 0 15px rgba(139, 233, 253, 0.6), inset 0 0 10px rgba(0,0,0,0.5)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = 'rgba(139, 233, 253, 0.4)';
                  e.target.style.boxShadow = 'inset 0 0 10px rgba(0,0,0,0.5)';
                }}
              />
            </div>
          </div>

          {/* Contraseña */}
          <div style={{ marginBottom: '30px' }}>
            <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#e0f2fe', marginBottom: '8px', textShadow: '0 0 5px rgba(255,255,255,0.3)' }}>
              Contraseña
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="glass-input"
                style={{
                  width: '100%',
                  padding: '12px 45px 12px 16px',
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(139, 233, 253, 0.4)',
                  borderRadius: '10px',
                  fontSize: '15px',
                  color: '#fff',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'all 0.3s ease',
                  boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)',
                  letterSpacing: '2px',
                }}
                onFocus={e => {
                  e.target.style.borderColor = '#8be9fd';
                  e.target.style.boxShadow = '0 0 15px rgba(139, 233, 253, 0.6), inset 0 0 10px rgba(0,0,0,0.5)';
                }}
                onBlur={e => {
                  e.target.style.borderColor = 'rgba(139, 233, 253, 0.4)';
                  e.target.style.boxShadow = 'inset 0 0 10px rgba(0,0,0,0.5)';
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#8be9fd', padding: 0 }}
              >
                {showPassword ? (
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                ) : (
                  <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                )}
              </button>
            </div>
          </div>

          {/* Error message */}
          {error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.2)',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              boxShadow: '0 0 10px rgba(239, 68, 68, 0.4)'
            }}>
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="#fca5a5" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" /></svg>
              <span style={{ fontSize: '14px', color: '#fca5a5', fontWeight: 600 }}>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px',
              background: loading ? 'rgba(56, 189, 248, 0.5)' : 'linear-gradient(90deg, rgba(14,165,233,0.8) 0%, rgba(56,189,248,0.8) 100%)',
              color: '#fff',
              border: '1px solid rgba(125, 211, 252, 0.8)',
              borderRadius: '30px', /* Borde muy redondeado como en la imagen */
              fontSize: '16px',
              fontWeight: 800,
              letterSpacing: '2px',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.3s',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              boxShadow: '0 0 20px rgba(56, 189, 248, 0.6)',
              textShadow: '0 0 5px rgba(255,255,255,0.8)',
            }}
            onMouseOver={e => {
              if (!loading) {
                e.currentTarget.style.boxShadow = '0 0 30px rgba(56, 189, 248, 0.9)';
                e.currentTarget.style.transform = 'scale(1.02)';
              }
            }}
            onMouseOut={e => {
              if (!loading) {
                e.currentTarget.style.boxShadow = '0 0 20px rgba(56, 189, 248, 0.6)';
                e.currentTarget.style.transform = 'scale(1)';
              }
            }}
          >
            {loading && (
              <svg style={{ animation: 'spin 1s linear infinite' }} width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
            )}
            {loading ? 'INGRESANDO...' : 'ENTRAR'}
          </button>
        </form>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
          
          /* Placeholder color correction para verse bien en fondo oscuro */
          .glass-input::placeholder {
            color: rgba(255, 255, 255, 0.5);
          }
        `}</style>
      </div>
    </div>
  );
};

