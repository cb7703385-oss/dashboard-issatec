import React, { useState, useEffect } from 'react';

interface User {
  id: string;
  username: string;
  nombre: string;
  rol: string;
  activo: boolean;
  created_at: string;
  is_online?: boolean;
}

interface AdminPanelProps {
  currentUser: { userId: string; username: string; rol: string; nombre: string };
  onClose: () => void;
}

const getToken = () => localStorage.getItem('auth_token') || '';

const authHeaders = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${getToken()}`,
});

export const AdminPanel: React.FC<AdminPanelProps> = ({ currentUser, onClose }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState({ username: '', password: '', nombre: '', rol: 'viewer', activo: true });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/users', { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) {
        if (data.error === 'SESSION_INVALIDATED') {
          window.location.reload();
          return;
        }
        setError(data.error || 'Error cargando usuarios');
      } else setUsers(data);
    } catch { setError('Error de conexión'); }
    finally { setLoading(false); }
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm({ username: '', password: '', nombre: '', rol: 'viewer', activo: true });
    setFormError('');
    setShowModal(true);
  };

  const openEdit = (u: User) => {
    setEditingUser(u);
    setForm({ username: u.username, password: '', nombre: u.nombre, rol: u.rol, activo: Boolean(u.activo) });
    setFormError('');
    setShowModal(true);
  };

  const handleSave = async () => {
    setFormError('');
    setSaving(true);
    try {
      if (editingUser) {
        const body: Record<string, unknown> = { nombre: form.nombre, rol: form.rol, activo: form.activo };
        if (form.password) body.password = form.password;
        const res = await fetch(`/api/admin/users/${editingUser.id}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) { setFormError(data.error || 'Error editando usuario'); return; }
      } else {
        if (!form.username || !form.password) { setFormError('Usuario y contraseña son requeridos'); return; }
        const res = await fetch('/api/admin/users', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(form),
        });
        const data = await res.json();
        if (!res.ok) { setFormError(data.error || 'Error creando usuario'); return; }
      }
      setShowModal(false);
      await fetchUsers();
    } catch { setFormError('Error de conexión'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE', headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Error eliminando'); return; }
      setDeleteConfirm(null);
      await fetchUsers();
    } catch { setError('Error de conexión'); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ background: '#fff', borderRadius: '20px', boxShadow: '0 24px 80px rgba(0,0,0,0.20)', width: '100%', maxWidth: '700px', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(135deg,#1B6DB5 0%,#2563eb 100%)', borderRadius: '20px 20px 0 0' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 800, color: '#fff' }}>⚙️ Panel de Administración</h2>
            <p style={{ margin: 0, fontSize: '12px', color: 'rgba(255,255,255,0.75)', marginTop: '2px' }}>Gestión de usuarios del sistema</p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={openCreate} style={{ padding: '8px 16px', background: '#fff', color: '#1B6DB5', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: 800, cursor: 'pointer' }}>
              + Nuevo Usuario
            </button>
            <button onClick={onClose} style={{ width: '32px', height: '32px', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '8px', color: '#fff', cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>
          {error && <div style={{ background: '#fff1f0', border: '1px solid #fca5a5', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', color: '#dc2626', fontSize: '13px' }}>{error}</div>}
          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Cargando usuarios...</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #f1f5f9' }}>
                  {['Nombre', 'Usuario', 'Rol', 'Estado', 'Creado', 'Acciones'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom: '1px solid #f8fafc', transition: 'background 0.15s' }} onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '10px', fontWeight: 600, color: '#1e293b' }}>{u.nombre}</td>
                    <td style={{ padding: '10px', color: '#475569', fontFamily: 'monospace', fontSize: '12px' }}>{u.username}</td>
                    <td style={{ padding: '10px' }}>
                      <span style={{ padding: '2px 10px', borderRadius: '20px', fontWeight: 700, fontSize: '11px', background: u.rol === 'admin' ? '#eff6ff' : '#f0fdf4', color: u.rol === 'admin' ? '#1d4ed8' : '#15803d' }}>{u.rol}</span>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ padding: '2px 10px', borderRadius: '20px', fontWeight: 700, fontSize: '11px', background: u.activo ? '#f0fdf4' : '#fff1f0', color: u.activo ? '#15803d' : '#dc2626', textAlign: 'center' }}>
                          {u.activo ? 'Activo' : 'Inactivo'}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingLeft: '8px' }}>
                          <div style={{ width: '6px', height: '6px', borderRadius: 'full', background: u.is_online ? '#22c55e' : '#94a3b8' }}></div>
                          <span style={{ fontSize: '10px', color: u.is_online ? '#15803d' : '#64748b', fontWeight: 600 }}>
                            {u.is_online ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '10px', color: '#94a3b8', fontSize: '11px' }}>{u.created_at}</td>
                    <td style={{ padding: '10px', display: 'flex', gap: '6px' }}>
                      <button onClick={() => openEdit(u)} style={{ padding: '4px 10px', background: '#eff6ff', color: '#1d4ed8', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Editar</button>
                      {u.id !== currentUser.userId && (
                        deleteConfirm === u.id ? (
                          <>
                            <button onClick={() => handleDelete(u.id)} style={{ padding: '4px 10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>¿Confirmar?</button>
                            <button onClick={() => setDeleteConfirm(null)} style={{ padding: '4px 8px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', fontSize: '11px', cursor: 'pointer' }}>No</button>
                          </>
                        ) : (
                          <button onClick={() => setDeleteConfirm(u.id)} style={{ padding: '4px 10px', background: '#fff1f0', color: '#dc2626', border: 'none', borderRadius: '6px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}>Eliminar</button>
                        )
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create/Edit Modal */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div style={{ background: '#fff', borderRadius: '16px', boxShadow: '0 24px 80px rgba(0,0,0,0.25)', width: '100%', maxWidth: '400px', padding: '28px' }}>
            <h3 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: 800, color: '#1e293b' }}>
              {editingUser ? '✏️ Editar Usuario' : '➕ Nuevo Usuario'}
            </h3>

            {['nombre', ...(!editingUser ? ['username'] : []), 'password'].map(field => (
              <div key={field} style={{ marginBottom: '14px' }}>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '4px' }}>
                  {field === 'nombre' ? 'Nombre completo' : field === 'username' ? 'Usuario' : editingUser ? 'Nueva contraseña (opcional)' : 'Contraseña'}
                </label>
                <input
                  type={field === 'password' ? 'password' : 'text'}
                  value={(form as Record<string, string | boolean>)[field] as string}
                  onChange={e => setForm(prev => ({ ...prev, [field]: e.target.value }))}
                  placeholder={field === 'password' && editingUser ? 'Dejar en blanco para no cambiar' : ''}
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e5e7eb', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }}
                />
              </div>
            ))}

            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#374151', marginBottom: '4px' }}>Rol</label>
              <select value={form.rol} onChange={e => setForm(prev => ({ ...prev, rol: e.target.value }))} style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e5e7eb', borderRadius: '8px', fontSize: '13px', outline: 'none' }}>
                <option value="viewer">Viewer</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            {editingUser && (
              <div style={{ marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input type="checkbox" id="activo" checked={Boolean(form.activo)} onChange={e => setForm(prev => ({ ...prev, activo: e.target.checked }))} />
                <label htmlFor="activo" style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>Usuario activo</label>
              </div>
            )}

            {formError && <div style={{ background: '#fff1f0', border: '1px solid #fca5a5', borderRadius: '8px', padding: '8px 12px', marginBottom: '14px', color: '#dc2626', fontSize: '12px' }}>{formError}</div>}

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowModal(false)} style={{ padding: '9px 18px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={handleSave} disabled={saving} style={{ padding: '9px 18px', background: saving ? '#93c5fd' : '#1B6DB5', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 800, cursor: saving ? 'not-allowed' : 'pointer' }}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
