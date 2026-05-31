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

process.exit(0);
