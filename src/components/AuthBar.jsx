// src/components/AuthBar.jsx
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  apiLogin,
  apiMe,
  apiAdminAcceptInvite,
  apiStaffAcceptInvite,
} from '../lib/api.js';

export default function AuthBar() {
  const { user, loading, setUser, logout } = useAuth();

  // Hızlı giriş için identifier + password
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [msg, setMsg] = useState('');

  if (loading) {
    return (
      <div style={bar}>
        <span>🔄 Oturum kontrol ediliyor…</span>
      </div>
    );
  }

  async function onLogin() {
    try {
      setMsg('Giriş yapılıyor…');
      await apiLogin({ identifier, password }); // token set edilir
      const { user: me } = await apiMe();      // kullanıcıyı çek
      setUser(me);
      setMsg('✅ Giriş başarılı');
      setIdentifier('');
      setPassword('');
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    }
  }

  function onLogout() {
    logout();
    setMsg('🔒 Çıkış yapıldı');
  }

  async function onAcceptInvite() {
    try {
      setMsg('🔐 Admin davet kodu kontrol ediliyor…');
      const updated = await apiAdminAcceptInvite(invite.trim());
      // /api/auth/admin/accept-invite json dönerse email olabilir; değilse /me çağırıp güncelle
      try {
        const { user: me } = await apiMe();
        setUser(me);
        setMsg('✅ Artık admin oldunuz.');
      } catch {
        setMsg(`✅ Admin yetkisi tanımlandı.`);
      }
      setInvite('');
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    }
  }

  async function onAcceptStaffInvite() {
    try {
      setMsg('🔐 Staff davet kodu kontrol ediliyor…');
      const updated = await apiStaffAcceptInvite(invite.trim());
      try {
        const { user: me } = await apiMe();
        setUser(me);
        setMsg('✅ Artık staff oldunuz.');
      } catch {
        setMsg(`✅ Staff yetkisi tanımlandı.`);
      }
      setInvite('');
    } catch (e) {
      setMsg(`❌ ${e.message}`);
    }
  }

  return (
    <div style={bar}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <StatusBadge loggedIn={!!user} />

        {user ? (
          <>
            <b>Hoş geldin:</b> <span>{user.name || user.email}</span>

            {/* Rol rozetleri */}
            {user.role === 'admin' && (
              <span style={badgeStyle('#eef2ff', '#3730a3')}>admin</span>
            )}
            {user.role === 'staff' && (
              <span style={badgeStyle('#ecfdf5', '#065f46')}>staff</span>
            )}
            {user.role === 'user' && (
              <span style={badgeStyle('#f1f5f9', '#334155')}>user</span>
            )}

            <button onClick={onLogout} style={btn}>Çıkış</button>

            {/* girişli ama admin/staff değilse davet alanı */}
            {user.role === 'user' && (
              <>
                <input
                  placeholder="Davet kodu"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  style={inp}
                />
                <button onClick={onAcceptInvite} style={btn}>Admin ol</button>
                <button onClick={onAcceptStaffInvite} style={btn}>Staff ol</button>
              </>
            )}
          </>
        ) : (
          <>
            <input
              placeholder="TC / Telefon / E-posta"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              style={inp}
              autoComplete="username"
            />
            <input
              placeholder="Parola"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={inp}
              minLength={6}
              autoComplete="current-password"
            />
            <button onClick={onLogin} style={btn}>Giriş</button>
            <a href="/auth" style={linkBtn}>Kayıt Ol</a>
          </>
        )}
      </div>

      <div
        style={{
          fontSize: 12,
          marginTop: 6,
          color: msg.startsWith('❌') ? '#b00020' : '#555',
        }}
      >
        {msg}
      </div>
    </div>
  );
}

function StatusBadge({ loggedIn }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 999,
        background: loggedIn ? '#e6f7ed' : '#fdeaea',
        color: loggedIn ? '#0a7a3d' : '#a30c0c',
        fontWeight: 600,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: loggedIn ? '#16a34a' : '#dc2626',
        }}
      />
      {loggedIn ? 'Girişli' : 'Girişsiz'}
    </span>
  );
}

/* rozet stili */
function badgeStyle(bg, color) {
  return {
    padding: '2px 8px',
    borderRadius: 999,
    background: bg,
    color,
    fontWeight: 600,
  };
}

/* basit stiller */
const bar = {
  padding: '10px 12px',
  borderBottom: '1px solid #eee',
  background: '#fafafa',
  position: 'sticky',
  top: 0,
  zIndex: 10,
};
const inp = { padding: '6px 8px', border: '1px solid #ddd', borderRadius: 8 };
const btn = {
  padding: '6px 10px',
  border: '1px solid #ddd',
  borderRadius: 8,
  background: '#fff',
  cursor: 'pointer',
};
const linkBtn = {
  ...btn,
  textDecoration: 'none',
  background: '#0ea5e9',
  color: '#fff',
  border: '1px solid #0ea5e9',
};
