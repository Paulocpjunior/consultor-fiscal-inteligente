// scripts/dump-venc-log.mjs
// Diagnóstico: imprime o último log gravado em `vencimentos_cron_logs`.
// Mostra alertadas, emailsFalhados, erros[] — pra entender por que alertadas=0.
//
// Uso (com ADC do gcloud):
//   GOOGLE_CLOUD_PROJECT=consultorfiscalapp node scripts/dump-venc-log.mjs

import admin from 'firebase-admin';

if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
}
const db = admin.firestore();

const snap = await db.collection('vencimentos_cron_logs')
    .orderBy('executadoEm', 'desc')
    .limit(3)
    .get();

if (snap.empty) {
    console.log('Nenhum log em vencimentos_cron_logs.');
    process.exit(0);
}

snap.forEach((d, i) => {
    const x = d.data();
    console.log(`\n═══ log #${i} (${d.id}) ═══`);
    console.log(JSON.stringify({
        executadoEm: x.executadoEm?.toDate?.()?.toISOString?.(),
        disparadoPor: x.disparadoPor,
        totalAtivas: x.totalAtivas,
        examinadas: x.examinadas,
        foraJanela: x.foraJanela,
        semVencimento: x.semVencimento,
        alertadas: x.alertadas,
        emailsEnviados: x.emailsEnviados,
        emailsFalhados: x.emailsFalhados,
        notificacoesIn: x.notificacoesIn,
        adminsNotificados: x.adminsNotificados,
        atrasadasNoDigest: x.atrasadasNoDigest,
        porCategoria: x.porCategoria,
        erroFatal: x.erroFatal,
        duracaoMs: x.duracaoMs,
        erros: x.erros,
    }, null, 2));
});

// ─── Diagnóstico LIVE: roda a lógica nova sobre os dados reais ──────────────
// Independe do que está deployado — usa o código local (deveAlertar <= 7).
console.log('\n\n════════ DIAGNÓSTICO LIVE (lógica deveAlertar<=7 local) ════════');

const TZ_OFFSET_BRT = -3;
function hojeBrt() {
    const agora = new Date();
    const brt = new Date(agora.getTime() + (TZ_OFFSET_BRT * 60 * 60 * 1000) - (agora.getTimezoneOffset() * 60 * 1000));
    brt.setHours(0, 0, 0, 0);
    return brt;
}
function diffDiasBrt(v, hoje) {
    let ms = null;
    if (v && typeof v.toDate === 'function') ms = v.toDate().getTime();
    else if (v && typeof v.seconds === 'number') ms = v.seconds * 1000;
    else if (v) { const p = new Date(v).getTime(); if (!Number.isNaN(p)) ms = p; }
    if (ms === null) return null;
    const dv = new Date(ms); dv.setHours(0, 0, 0, 0);
    return Math.round((dv.getTime() - hoje.getTime()) / 86400000);
}

const hoje = hojeBrt();
const hojeIso = hoje.toISOString().slice(0, 10);
const inicioJanela = hoje.getTime() - 90 * 86400000;
const fimJanela = hoje.getTime() + 5 * 86400000;

const [sAf, sAnd] = await Promise.all([
    db.collection('tarefas').where('status', '==', 'a_fazer').limit(5000).get(),
    db.collection('tarefas').where('status', '==', 'em_andamento').limit(5000).get(),
]);
const docs = [...sAf.docs, ...sAnd.docs];

let naJanela = 0, passariaDeveAlertar = 0, comUltimoEmailHoje = 0, comResponsavel = 0;
const amostras = [];
for (const d of docs) {
    const t = d.data();
    const dias = diffDiasBrt(t.vencimento, hoje);
    if (dias === null) continue;
    const ms = (t.vencimento?.toDate?.()?.getTime?.()) ?? (t.vencimento?.seconds ? t.vencimento.seconds * 1000 : NaN);
    if (Number.isNaN(ms) || ms < inicioJanela || ms > fimJanela) continue;
    naJanela++;
    const deveAlertar = dias <= 7; // status já garantido pela query
    if (deveAlertar) passariaDeveAlertar++;
    const ultimoEmail = t.ultimoEmailEm?.toDate?.()?.toISOString?.()?.slice(0, 10);
    if (ultimoEmail === hojeIso) comUltimoEmailHoje++;
    if (t.responsavel) comResponsavel++;
    if (amostras.length < 8) {
        amostras.push({ id: d.id, status: t.status, dias, deveAlertar, ultimoEmail: ultimoEmail || null, responsavel: t.responsavel || null });
    }
}

console.log(JSON.stringify({
    hojeBrt: hojeIso,
    totalAtivas: docs.length,
    naJanela,
    passariaDeveAlertar,          // quantas a lógica NOVA alertaria
    comUltimoEmailHoje,           // quantas a idempotência pularia
    comResponsavel,               // quantas têm email-alvo
    deveriaAlertarHoje: passariaDeveAlertar - comUltimoEmailHoje,
}, null, 2));
console.log('amostras:', JSON.stringify(amostras, null, 2));

process.exit(0);
