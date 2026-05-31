// scripts/test-graph-auth.mjs
// Descobre qual GUID é o client_id válido e confirma as permissões (roles)
// concedidas ao app — testando o fluxo client-credentials do Microsoft Graph.
//
// Uso:
//   export GRAPH_CLIENT_SECRET="$(gcloud secrets versions access latest \
//       --secret=graph-client-secret --project=consultorfiscalapp)"
//   node scripts/test-graph-auth.mjs

const TENANT = '8b8254a4-9a63-4c2d-81a2-577942081943'; // resolvido via OpenID
const SECRET = process.env.GRAPH_CLIENT_SECRET || '';
const CANDIDATOS = [
    '59fd4ec9-37bd-472c-9fa7-373461dffd50',
    '4b0afe67-70a8-4c9f-b09a-0c2faed9d787',
];

if (!SECRET) {
    console.error('✗ Faltou GRAPH_CLIENT_SECRET no env. Rode:');
    console.error('  export GRAPH_CLIENT_SECRET="$(gcloud secrets versions access latest --secret=graph-client-secret --project=consultorfiscalapp)"');
    process.exit(1);
}

function decodeJwt(token) {
    try {
        const payload = token.split('.')[1];
        const json = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
        return JSON.parse(json);
    } catch { return null; }
}

for (const clientId of CANDIDATOS) {
    const url = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
    });
    process.stdout.write(`\n── client_id ${clientId} … `);
    try {
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (resp.ok) {
            const data = await resp.json();
            const jwt = decodeJwt(data.access_token);
            const roles = jwt?.roles || [];
            const temMailSend = roles.includes('Mail.Send');
            console.log('✅ TOKEN OK');
            console.log(`   appid=${jwt?.appid} app=${jwt?.app_displayname || '?'}`);
            console.log(`   roles=${JSON.stringify(roles)}`);
            console.log(temMailSend
                ? '   ✅ Mail.Send PRESENTE — envio de email vai funcionar'
                : '   ⚠️  Mail.Send AUSENTE — sendMail vai dar 403. Adicione Mail.Send (Application) + admin consent.');
            console.log(`\n>>> USE ESTE: GRAPH_CLIENT_ID=${clientId}  GRAPH_TENANT_ID=${TENANT}`);
        } else {
            const txt = await resp.text();
            const j = (() => { try { return JSON.parse(txt); } catch { return {}; } })();
            console.log(`✗ ${resp.status} ${j.error || ''} — ${(j.error_description || txt).slice(0, 120)}`);
        }
    } catch (e) {
        console.log(`✗ erro de rede: ${e.message}`);
    }
}
process.exit(0);
