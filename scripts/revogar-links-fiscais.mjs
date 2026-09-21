import { Storage } from '@google-cloud/storage';

// Revoga somente tokens publicos; conserva arquivos, hashes e metadados fiscais.
const apply = process.argv.includes('--apply');
const bucket = new Storage({ projectId: 'consultorfiscalapp' }).bucket('consultorfiscalapp.firebasestorage.app');
let examinados = 0, comToken = 0, revogados = 0;
const pending = new Set();
let falhas = 0;
for (const prefix of ['xmls/', 'nfse_pdfs/']) {
    for await (const file of bucket.getFilesStream({ prefix })) {
        examinados++;
        if (!file.metadata.metadata?.firebaseStorageDownloadTokens) continue;
        comToken++;
        if (apply) {
            const job = file.setMetadata({ metadata: { firebaseStorageDownloadTokens: null } }, { ifMetagenerationMatch: file.metadata.metageneration })
                .then(() => { revogados++; })
                .catch(err => { falhas++; console.error(`Falha de revogacao: ${err.code || 'desconhecida'}`); })
                .finally(() => pending.delete(job));
            pending.add(job);
            if (pending.size >= 8) await Promise.race(pending);
        }
    }
}
await Promise.all(pending);
console.log(JSON.stringify({ apply, examinados, comToken, revogados, falhas }));
if (falhas) process.exitCode = 1;
