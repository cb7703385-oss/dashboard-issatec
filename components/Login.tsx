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
  const [showSessionModal, setShowSessionModal] = useState(false);
  const [sessionMessage, setSessionMessage] = useState('');

  const handleSubmit = async (e?: React.FormEvent, force = false) => {
    if (e) e.preventDefault();
    setError('');
    setLoading(true);
    setShowSessionModal(false);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, force }),
      });
      const data = await res.json();

      if (res.status === 409 && data.error === 'ALREADY_LOGGED_IN') {
        setSessionMessage(data.message);
        setShowSessionModal(true);
        setLoading(false);
        return;
      }

      if (!res.ok) {
        setError(data.error || 'Error al iniciar sesion');
      } else {
        localStorage.setItem('auth_token', data.token);
        localStorage.setItem('auth_user', JSON.stringify(data.user));
        onLoginSuccess(data.user);
      }
    } catch {
      setError('No se pudo conectar con el servidor.');
    } finally {
      if (!force) setLoading(false);
    }
  };

  const inputBase: React.CSSProperties = {
    width: '100%',
    height: '66px',
    border: '1px solid #d7e5f5',
    background: '#e9f2ff',
    color: '#0f1b2f',
    fontSize: '15px',
    fontWeight: 800,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <main
      style={{
        minHeight: '100dvh',
        fontFamily: "'Inter', 'Segoe UI', sans-serif",
        color: '#10284a',
        background: '#edf3f9',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <header
        style={{
          height: '114px',
          background: '#ffffff',
          borderBottom: '1px solid #dbe4ee',
          display: 'flex',
          alignItems: 'center',
          padding: '0 clamp(28px, 4.5vw, 84px)',
          gap: '42px',
          boxShadow: '0 1px 3px rgba(15, 23, 42, 0.06)',
          flexShrink: 0,
        }}
      >
        <img
          src="/logo_issatec.png"
          alt="issatec"
          style={{ height: '44px', width: 'auto', objectFit: 'contain' }}
        />
        <h1
          style={{
            margin: 0,
            color: '#092653',
            fontSize: '30px',
            fontWeight: 900,
            letterSpacing: 0,
          }}
        >
          Dashboard Issatec
        </h1>
      </header>

      <section
        style={{
          flex: 1,
          position: 'relative',
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(420px, 576px)',
          alignItems: 'center',
          gap: '72px',
          padding: '56px clamp(32px, 7vw, 156px)',
          backgroundImage: 'linear-gradient(90deg, rgba(246,249,253,0.98) 0%, rgba(235,242,250,0.9) 43%, rgba(178,196,219,0.88) 100%), url("/login_bg.png")',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(120deg, rgba(255,255,255,0.52), rgba(255,255,255,0.08)), radial-gradient(circle at 76% 22%, rgba(64,137,192,0.18), transparent 22%)',
            pointerEvents: 'none',
          }}
        />

        <div style={{ position: 'relative', maxWidth: '830px' }}>
          <p
            style={{
              margin: '0 0 28px',
              color: '#2f83bd',
              fontSize: '19px',
              fontWeight: 900,
              letterSpacing: '0.38em',
              textTransform: 'uppercase',
            }}
          >
            Analítica operacional
          </p>
          <h2
            style={{
              margin: '0 0 30px',
              color: '#122b50',
              fontSize: '70px',
              lineHeight: 1.06,
              fontWeight: 950,
              letterSpacing: 0,
            }}
          >
            Datos en vivo
          </h2>
          <p
            style={{
              margin: 0,
              maxWidth: '650px',
              color: '#334967',
              fontSize: '25px',
              lineHeight: 1.55,
              fontWeight: 650,
            }}
          >
            Consulta el comportamiento de sedes, servicios, agentes, tiempos de espera y atención desde una vista ejecutiva.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(150px, 1fr))',
              gap: '64px',
              maxWidth: '520px',
              marginTop: '46px',
            }}
          >
            <div>
              <strong style={{ display: 'block', color: '#2e87c2', fontSize: '30px', fontWeight: 950 }}>Sedes</strong>
              <span style={{ color: '#5d6f89', fontSize: '15px', fontWeight: 900 }}>Seguimiento operativo</span>
            </div>
            <div>
              <strong style={{ display: 'block', color: '#2e87c2', fontSize: '30px', fontWeight: 950 }}>Agentes</strong>
              <span style={{ color: '#5d6f89', fontSize: '15px', fontWeight: 900 }}>Análisis de atención</span>
            </div>
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          autoComplete="off"
          style={{
            position: 'relative',
            background: 'rgba(248, 251, 255, 0.92)',
            border: '1px solid rgba(255,255,255,0.85)',
            borderRadius: '30px',
            padding: '46px 42px 40px',
            boxShadow: '0 34px 80px rgba(27, 61, 98, 0.25)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '30px' }}>
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '16px',
                background: '#2f88bf',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '26px',
                fontWeight: 950,
              }}
            >
              A
            </div>
            <div>
              <h3 style={{ margin: 0, color: '#101a30', fontSize: '36px', fontWeight: 950, lineHeight: 1 }}>
                Bienvenido
              </h3>
              <p style={{ margin: '12px 0 0', color: '#667894', fontSize: '15px', fontWeight: 800 }}>
                Ingresa tus credenciales para continuar
              </p>
            </div>
          </div>

          <label style={{ display: 'block', color: '#283852', fontSize: '15px', fontWeight: 900, marginBottom: '8px' }}>
            Usuario
          </label>
          <div style={{ display: 'flex', marginBottom: '26px' }}>
            <div className="login-icon-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M20 21a8 8 0 0 0-16 0" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
              placeholder="Usuario"
              style={{ ...inputBase, borderRadius: '0 15px 15px 0', padding: '0 18px' }}
            />
          </div>

          <label style={{ display: 'block', color: '#283852', fontSize: '15px', fontWeight: 900, marginBottom: '8px' }}>
            Contraseña
          </label>
          <div style={{ display: 'flex', marginBottom: '20px' }}>
            <div className="login-icon-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="4" y="10" width="16" height="10" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </div>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPassword ? 'text' : 'password'}
              name="manual-access-key"
              autoComplete="new-password"
              required
              placeholder="Ingresa tu clave de acceso"
              style={{ ...inputBase, borderRadius: 0, borderRight: 0, padding: '0 18px' }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              style={{
                width: '82px',
                border: '1px solid #d7e5f5',
                borderRadius: '0 15px 15px 0',
                background: '#eef6ff',
                color: '#2d88c2',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </button>
          </div>

          <div style={{ minHeight: '40px', marginBottom: '8px' }}>
            {error && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  color: '#b91c1c',
                  borderRadius: '12px',
                  padding: '10px 12px',
                  fontSize: '13px',
                  fontWeight: 800,
                }}
              >
                {error}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '26px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#657792', fontSize: '13px', fontWeight: 900 }}>
              <input type="checkbox" defaultChecked style={{ accentColor: '#2f88bf' }} />
              Recordar acceso
            </label>
            <a
              href="https://wa.me/573183764780"
              target="_blank"
              rel="noreferrer"
              style={{
                color: '#657792',
                fontSize: '13px',
                fontWeight: 900,
                textDecoration: 'none',
              }}
            >
              Soporte ISSATEC
            </a>
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              height: '64px',
              border: 0,
              borderRadius: '15px',
              background: loading ? '#75add0' : '#318bc0',
              color: '#fff',
              fontSize: '20px',
              fontWeight: 950,
              cursor: loading ? 'not-allowed' : 'pointer',
              boxShadow: '0 18px 34px rgba(49, 139, 192, 0.28)',
            }}
          >
            {loading ? 'Ingresando...' : 'Entrar al dashboard'}
          </button>
        </form>
      </section>

      {showSessionModal && (
        <div className="login-modal-backdrop">
          <div className="login-modal">
            <h3>Sesion activa</h3>
            <p>{sessionMessage}</p>
            <button onClick={() => handleSubmit(undefined, true)}>Cerrar otra sesion y entrar</button>
            <button onClick={() => setShowSessionModal(false)} className="secondary">Regresar</button>
          </div>
        </div>
      )}

      <style>{`
        .login-icon-box {
          width: 56px;
          height: 66px;
          border: 1px solid #d7e5f5;
          border-right: 0;
          border-radius: 15px 0 0 15px;
          background: #f7fbff;
          color: #8aa2c0;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        input::placeholder {
          color: #7b8da7;
          font-weight: 700;
        }

        input:focus {
          border-color: #2f88bf !important;
          box-shadow: 0 0 0 3px rgba(47, 136, 191, 0.13);
          position: relative;
          z-index: 1;
        }

        .login-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 50;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(15, 23, 42, 0.62);
          backdrop-filter: blur(6px);
        }

        .login-modal {
          width: min(420px, calc(100vw - 32px));
          background: #fff;
          border-radius: 20px;
          padding: 28px;
          box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
          color: #14233b;
        }

        .login-modal h3 {
          margin: 0 0 10px;
          font-size: 22px;
          font-weight: 950;
        }

        .login-modal p {
          margin: 0 0 18px;
          color: #5d6f89;
          font-weight: 700;
          line-height: 1.5;
        }

        .login-modal button {
          width: 100%;
          border: 0;
          border-radius: 12px;
          padding: 12px;
          background: #318bc0;
          color: #fff;
          font-weight: 900;
          cursor: pointer;
          margin-top: 8px;
        }

        .login-modal button.secondary {
          background: #eef4fb;
          color: #36506f;
        }

        @media (max-width: 1050px) {
          section {
            grid-template-columns: 1fr !important;
            gap: 32px !important;
            overflow-y: auto;
          }

          header {
            height: auto !important;
            min-height: 92px;
            gap: 20px !important;
            flex-wrap: wrap;
          }
        }

        @media (max-width: 720px) {
          h2 {
            font-size: 46px !important;
          }
        }
      `}</style>
    </main>
  );
};

export default Login;
