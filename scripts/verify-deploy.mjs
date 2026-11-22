// Dağıtım doğrulaması: ön yüz ve sunucu aynı commit mi, sunucu doğru veritabanına mı bağlı,
// güvence dizinleri tam mı. Oturum ya da sır gerektirmez.
//   node scripts/verify-deploy.mjs staging [beklenenCommit]
//   node scripts/verify-deploy.mjs local
// Çıkış kodu: 0 = tamam, 1 = uyuşmazlık / eksik (CI ve elle doğrulamada kullanılır).
const TARGETS = {
  staging: { web: 'https://nobet-staging.onrender.com', api: 'https://nobet-staging-api.onrender.com' },
  local: { web: null, api: 'http://localhost:3100' },
};
const name = process.argv[2] || 'staging';
const expected = (process.argv[3] || '').slice(0, 12) || null;
const t = TARGETS[name];
if (!t) { console.error(`hedef: ${Object.keys(TARGETS).join(' | ')}`); process.exit(2); }

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i += 1) {
    try {
      const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
      const body = await r.json().catch(() => null);
      return { status: r.status, body };
    } catch (e) {
      if (i === tries - 1) return { status: 0, body: null, error: e.message };
      await new Promise((r) => setTimeout(r, 5000)); // ücretsiz sunucu uyanıyor
    }
  }
}

const rows = [];
const add = (k, ok, v) => { rows.push({ k, ok, v }); console.log(`${ok ? '✅' : '❌'} ${k}: ${v}`); };

const api = await getJson(`${t.api}/api/version`);
const apiCommit = api.body?.commit || null;
add('Sunucu sürüm uç noktası', api.status === 200 && !!apiCommit, api.status === 200 ? `commit ${apiCommit}, NODE_ENV ${api.body?.nodeEnv}${api.body?.branch ? ', dal ' + api.body.branch : ''}` : `HTTP ${api.status} ${api.error || ''}`);
add('Veritabanı ortam işareti', api.body?.db?.environment === name, `${api.body?.db?.environment || 'YOK'} (beklenen ${name}; veritabanı ${api.body?.db?.name || '?'})`);
const ready = api.body?.ready;
add('Güvence dizinleri', ready?.ok === true, ready?.ok ? Object.entries(ready.guarantees || {}).map(([k, v]) => `${k}=${v}`).join(', ') : `eksik: ${(ready?.missing || []).map((m) => m.label || m).join('; ') || ready?.error || '?'}`);
if (t.web) {
  const web = await getJson(`${t.web}/version.json`);
  const webCommit = web.body?.commit || null;
  add('Ön yüz sürümü (version.json)', web.status === 200 && !!webCommit, web.status === 200 ? `commit ${webCommit}, API ${web.body?.apiBase || '?'}` : `HTTP ${web.status}`);
  add('Ön yüzün bağlandığı API', (web.body?.apiBase || '').replace(/\/$/, '') === t.api, `${web.body?.apiBase || '?'} (beklenen ${t.api})`);
  add('Ön yüz ve sunucu aynı commit', !!webCommit && webCommit === apiCommit, `${webCommit} / ${apiCommit}`);
}
if (expected) add('Beklenen commit', apiCommit === expected, `${apiCommit} (beklenen ${expected})`);
const failed = rows.filter((r) => !r.ok).length;
console.log(failed ? `\nDOĞRULAMA BAŞARISIZ (${failed})` : '\nDOĞRULAMA TAMAM');
process.exit(failed ? 1 : 0);
