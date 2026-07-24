// ============================================================================
// sefaz-backend/nfse-nacional-dfe-eligibility.js
// ----------------------------------------------------------------------------
// Elegibilidade REAL para captura NFSe Nacional ADN (DFe).
//
// Diferente da NFe DistDFe, a ADN rejeita consulta em massa com certificado do
// escritorio quando o CNPJ consultado nao tem a mesma raiz do certificado
// (erro E2243). Portanto, "nfseNacionalDfeAtivo=true" sozinho nao basta.
// ============================================================================

import admin from 'firebase-admin';
import { caminhoNfseRecomendado, CAMINHO_NFSE } from './municipio-nfse-caminho.js';

const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

function toMillis(v) {
    if (v == null) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.toDate === 'function') return v.toDate().getTime();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const ms = Date.parse(v);
        return Number.isNaN(ms) ? null : ms;
    }
    return null;
}

export function classificarElegibilidadeAdn({ empresa, cert, nowMs = Date.now() }) {
    const cnpj = String(empresa?.cnpj || '').replace(/\D/g, '');
    const ehEscritorio = cnpj === CNPJ_ESCRITORIO;

    if (cnpj.length !== 14) {
        return { elegivel: false, motivo: 'CNPJ invalido para captura ADN' };
    }
    if (empresa?.nfseNacionalDfeAtivo !== true) {
        return { elegivel: false, motivo: 'NFSe Nacional ADN desativada' };
    }

    // Município que usa sistema PRÓPRIO (ex.: SP capital, portal CSV) não tem
    // movimento no ADN — consultar é "sucesso vazio" eterno. 22/07: 89
    // "elegíveis" com 0 docs capturados NA HISTÓRIA inteira; a NFS-e desses
    // clientes chega pelo trilho municipal. Só conta como elegível ADN quem
    // está em município aderente (ou sem codMun cadastrado — aí não dá pra
    // afirmar e mantemos, com o motivo aparecendo no card quando bloquear).
    const codMun = String(empresa?.codMunIBGE || '').replace(/\D/g, '');
    // BUG HISTÓRICO (achado 24/07 pelo card "0 elegíveis / 369 bloqueadas /
    // 0 docs NA HISTÓRIA"): caminhoNfseRecomendado devolve um OBJETO — a
    // comparação antiga `!== CAMINHO_NFSE.ADN` era sempre true e bloqueava
    // TODA empresa com município preenchido como "sistema próprio". O trilho
    // ADN (que é o padrão nacional 2026 e cobre os municípios fora da capital)
    // nunca consultou ninguém. O certo é comparar o CAMPO .caminho.
    if (codMun && caminhoNfseRecomendado(codMun).caminho !== CAMINHO_NFSE.ADN) {
        return {
            elegivel: false,
            motivo: 'Município usa sistema próprio de NFS-e (ex.: SP capital = portal CSV) — sem movimento no ADN Nacional.',
        };
    }

    // A propria S&P usa o certificado global do Secret Manager, que tem a mesma
    // raiz do CNPJ consultado. Clientes nao podem usar esse fallback na ADN.
    if (ehEscritorio) {
        return { elegivel: true, motivo: null, tipoCert: 'escritorio' };
    }

    if (!cert) {
        return {
            elegivel: false,
            motivo: 'NFSe Nacional ADN exige certificado A1 proprio da empresa; certificado do escritorio retorna E2243 (CNPJ base divergente).',
        };
    }

    const tipoCert = cert.tipoCert || 'A1';
    if (tipoCert === 'A3') {
        return {
            elegivel: false,
            motivo: 'NFSe Nacional ADN no Cloud Run exige A1 proprio; certificado A3 precisa fluxo/agente local especifico.',
            tipoCert,
        };
    }
    if (tipoCert !== 'A1') {
        return { elegivel: false, motivo: `Tipo de certificado ${tipoCert} nao suportado para ADN.`, tipoCert };
    }

    if (!cert.storagePath || !cert.passwordEnc) {
        return {
            elegivel: false,
            motivo: 'Certificado A1 marcado no cadastro, mas sem PFX/senha armazenados. Reenvie o .pfx pela coluna Certificado.',
            tipoCert,
        };
    }

    const notAfterMs = toMillis(cert.notAfter);
    if (!notAfterMs || notAfterMs <= nowMs) {
        return {
            elegivel: false,
            motivo: 'Certificado A1 proprio vencido ou sem validade cadastrada. Reenvie/renove o .pfx.',
            tipoCert,
        };
    }

    const cnpjCert = String(cert.cnpj || '').replace(/\D/g, '');
    if (!cnpjCert || cnpjCert.slice(0, 8) !== cnpj.slice(0, 8)) {
        return {
            elegivel: false,
            motivo: 'Certificado A1 proprio tem CNPJ-base diferente da empresa; a ADN rejeita com E2243.',
            tipoCert,
        };
    }

    return { elegivel: true, motivo: null, tipoCert };
}

export async function listarElegibilidadeNfseNacionalDfe() {
    const db = fa().firestore();
    const colNames = [
        process.env.SIMPLES_COLLECTION || 'simples_empresas',
        process.env.LUCRO_COLLECTION || 'lucro_empresas',
    ];

    const empresasPorCnpj = new Map();
    for (const colName of colNames) {
        try {
            const snap = await db.collection(colName).get();
            snap.forEach((doc) => {
                const d = doc.data();
                if (d._merged_into || d._deleted) return;
                if (d.nfseNacionalDfeAtivo !== true) return;
                const cnpj = String(d.cnpj || '').replace(/\D/g, '');
                if (cnpj.length !== 14 || empresasPorCnpj.has(cnpj)) return;
                empresasPorCnpj.set(cnpj, {
                    id: doc.id,
                    cnpj,
                    nome: d.razaoSocial || d.nome || '',
                    fonte: colName,
                    nfseNacionalDfeAtivo: true,
                    codMunIBGE: d.dadosFiscais?.codMunIBGE || d.codMunIBGE || null,
                });
            });
        } catch (e) {
            console.warn(`[nfse-nac-dfe/elegibilidade] colecao ${colName} indisponivel:`, e.message);
        }
    }

    const certsPorId = new Map();
    try {
        const certsSnap = await db.collection('empresas_certificados').get();
        certsSnap.forEach((doc) => certsPorId.set(doc.id, doc.data()));
    } catch (e) {
        console.warn('[nfse-nac-dfe/elegibilidade] erro lendo empresas_certificados:', e.message);
    }

    const todos = [];
    const bloqueiosPorMotivo = {};
    for (const emp of empresasPorCnpj.values()) {
        const classif = classificarElegibilidadeAdn({
            empresa: emp,
            cert: certsPorId.get(emp.id),
        });
        const item = { ...emp, ...classif };
        todos.push(item);
        if (!item.elegivel) {
            bloqueiosPorMotivo[item.motivo] = (bloqueiosPorMotivo[item.motivo] || 0) + 1;
        }
    }

    const empresas = todos
        .filter((e) => e.elegivel)
        .map(({ elegivel, motivo, tipoCert, nfseNacionalDfeAtivo, ...emp }) => emp);

    return {
        empresas,
        todos,
        resumo: {
            totalAtivas: todos.length,
            elegiveis: empresas.length,
            bloqueadas: todos.length - empresas.length,
            bloqueiosPorMotivo,
        },
    };
}
