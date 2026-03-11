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
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      paddingLeft: '20px',
      paddingRight: '5%',
      paddingTop: '20px',
      paddingBottom: '20px',
      position: 'relative',
    }}>
      {/* Fondo con brillo aumentado — aclaramos toda la imagen sin tocar la tarjeta */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundImage: 'url("/login_bg.png")',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        filter: 'brightness(1.35)',
        zIndex: 0,
      }}></div>

      {/* Overlay mínimo */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(10, 80, 160, 0.06)',
        zIndex: 1
      }}></div>

      {/* CONTENEDOR EXTERIOR — Borde neon cyan grueso + gran glow difuso */}
      <div style={{
        position: 'relative',
        zIndex: 2,
        border: '3px solid rgba(0, 220, 255, 1)',
        borderRadius: '16px',
        padding: '6px', /* Hueco visible entre borde externo e interno */
        background: 'transparent',
        /* Glow exterior más suave — no distrae, se ve elegante */
        boxShadow: '0 0 18px rgba(0, 220, 255, 0.7), 0 0 40px rgba(0, 180, 255, 0.3)',
        /* Sin rotación 3D — ambos lados de la tarjeta tienen la misma altura */
        width: '100%',
        maxWidth: '480px',
      }}>
        {/* CONTENEDOR INTERIOR — borde blanco fino, cristal azul translúcido */}
        <div style={{
          border: '1.5px solid rgba(255, 255, 255, 0.85)',
          borderRadius: '10px',
          padding: '36px 30px',
          /* Azul translúcido exacto del mockup — ni muy oscuro ni muy claro */
          background: 'rgba(100, 180, 225, 0.48)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          boxShadow: 'inset 0 0 30px rgba(120, 210, 255, 0.25)',
        }}>

          {/* CABECERA — Logo centrado arriba, luego textos */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '28px', gap: '8px' }}>
            <img
              src="/logo_sin_fondo.png"
              alt="issatec logo"
              style={{
                height: '44px',
                objectFit: 'contain',
                /* Filtros para volver el logo completamente blanco y que resalte sobre el azul */
                filter: 'brightness(0) invert(1)',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: '#c8e8ff', fontWeight: 500, letterSpacing: '0.5px' }}>
                Bienvenido
              </span>
              <span style={{ fontSize: '17px', color: '#d0efff', fontWeight: 800, letterSpacing: '0.5px', textShadow: '0 0 10px rgba(0,220,255,0.6)' }}>
                INICIAR SESIÓN
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Campo Usuario */}
            <div style={{ marginBottom: '18px' }}>
              <label style={{
                display: 'block', fontSize: '14px', fontWeight: 700,
                color: '#ffffff',
                marginBottom: '6px',
              }}>
                Usuario
              </label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="ingrese su usuario"
                required
                autoComplete="username"
                className="mockup-input"
                style={{
                  width: '100%',
                  padding: '11px 14px',
                  /* Fondo claro azul-agua como en el mockup (los inputs son más claros que la tarjeta) */
                  background: 'rgba(190, 230, 250, 0.65)',
                  border: '1.5px solid rgba(255, 255, 255, 0.80)',
                  borderRadius: '6px',
                  fontSize: '14px',
                  /* Texto oscuro en los inputs como en el mockup */
                  color: '#0a2a5a',
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'all 0.3s ease',
                }}
              />
            </div>

            {/* Campo Contraseña */}
            <div style={{ marginBottom: '35px' }}>
              <label style={{
                display: 'block', fontSize: '14px', fontWeight: 700,
                color: '#ffffff',
                marginBottom: '6px',
              }}>
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
                  className="mockup-input"
                  style={{
                    width: '100%',
                    padding: '11px 40px 11px 14px',
                    background: 'rgba(190, 230, 250, 0.65)',
                    border: '1.5px solid rgba(255, 255, 255, 0.80)',
                    borderRadius: '6px',
                    fontSize: '14px',
                    color: '#0a2a5a',
                    outline: 'none',
                    boxSizing: 'border-box',
                    letterSpacing: '3px',
                    transition: 'all 0.3s ease',
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#1a5080', padding: 0 }}
                >
                  {showPassword ? (
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 0 0 1.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0 1 12 4.5c4.756 0 8.773 3.162 10.065 7.498a10.522 10.522 0 0 1-4.293 5.774M6.228 6.228 3 3m3.228 3.228 3.65 3.65m7.894 7.894L21 21m-3.228-3.228-3.65-3.65m0 0a3 3 0 1 0-4.243-4.243m4.242 4.242L9.88 9.88" /></svg>
                  ) : (
                    <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" /></svg>
                  )}
                </button>
              </div>
            </div>

            {/* Espacio RESERVADO para error — altura fija para no mover el layout */}
            <div style={{ minHeight: '36px', marginBottom: '8px' }}>
              {error && (
                <div style={{
                  background: 'rgba(220, 50, 50, 0.75)',
                  border: '1px solid #fca5a5',
                  borderRadius: '6px',
                  padding: '8px 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}>
                  <span style={{ fontSize: '13px', color: '#fff', fontWeight: 500 }}>{error}</span>
                </div>
              )}
            </div>

            {/* Botón ENTRAR — Relleno cyan brillante con borde neon, igual al mockup */}
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <button
                type="submit"
                disabled={loading}
                className="mockup-btn"
                style={{
                  padding: '12px 60px',
                  /* Relleno cyan sólido (no translúcido) como en la captura */
                  background: loading
                    ? 'rgba(0, 170, 210, 0.7)'
                    : 'rgba(0, 195, 235, 0.75)',
                  color: '#fff',
                  border: '2px solid rgba(100, 240, 255, 1)',
                  /* Mismo border-radius que los inputs (6px) para armonía visual */
                  borderRadius: '6px',
                  fontSize: '15px',
                  fontWeight: 700,
                  letterSpacing: '2px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.3s',
                  boxShadow: '0 0 20px rgba(0, 220, 255, 0.8), inset 0 0 10px rgba(255,255,255,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  textShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }}
              >
                {loading && (
                  <svg style={{ animation: 'spin 1s linear infinite' }} width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
                  </svg>
                )}
                {loading ? 'INGRESANDO...' : 'ENTRAR'}
              </button>
            </div>
          </form>
        </div>

        <style>{`
          @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

          /* Placeholder — texto oscuro (igual que en el mockup) */
          .mockup-input::placeholder {
            color: rgba(10, 40, 90, 0.6) !important;
            font-weight: 400;
          }
          /* Focus: resalta el campo seleccionado */
          .mockup-input:focus {
            box-shadow: 0 0 12px rgba(0, 220, 255, 0.7) !important;
            border-color: rgba(0, 220, 255, 1) !important;
            background: rgba(210, 240, 255, 0.75) !important;
          }

          /* PREVENIR FONDO BLANCO DE AUTOCOMPLETADO DE CHROME */
          .mockup-input:-webkit-autofill,
          .mockup-input:-webkit-autofill:hover,
          .mockup-input:-webkit-autofill:focus,
          .mockup-input:-webkit-autofill:active {
              -webkit-box-shadow: 0 0 0 30px rgba(190, 230, 250, 0.9) inset !important;
              -webkit-text-fill-color: #0a2a5a !important;
              transition: background-color 5000s ease-in-out 0s;
          }

          /* Hover del Botón */
          .mockup-btn:hover {
            background: rgba(0, 210, 250, 0.9) !important;
            box-shadow: 0 0 30px rgba(0, 230, 255, 1), inset 0 0 15px rgba(255,255,255,0.3) !important;
            transform: scale(1.02);
          }
        `}</style>
      </div>
    </div>
  );
};

export default Login;

