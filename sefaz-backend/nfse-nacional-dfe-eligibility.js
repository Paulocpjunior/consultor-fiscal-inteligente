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
import { selecionarCertA1PorBase } from './cert-base-helper.js';

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

/**
 * @param {object} p
 * @param {object} p.empresa
 * @param {object|null} p.cert       certificado DA PRÓPRIA empresa (se houver)
 * @param {Array}  [p.certsMeta]     metadados de TODOS os certs — habilita o
 *   fallback de RAIZ (matriz ↔ filial). Paulo, 27/07: filial sem cert próprio
 *   usa o da matriz (mesma raiz de CNPJ) até subir o seu; é o mesmo critério
 *   que o NFe DistDFe já aplica ("A1 raiz" no Status). O E2243 do ADN barra
 *   raiz DIVERGENTE — mesma raiz é aceita.
 */
export function classificarElegibilidadeAdn({ empresa, cert, certsMeta = null, nowMs = Date.now() }) {
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

    // Fallback de RAIZ (matriz ↔ filial): vale quando a empresa não tem cert
    // próprio E quando o próprio é A3/inválido — a filial só depende do A1 da
    // matriz até subir o seu. Procurado pela raiz de 8 dígitos, ignorando o
    // doc da própria empresa.
    const certRaiz = certsMeta ? selecionarCertA1PorBase(certsMeta, cnpj, nowMs, empresa?.id) : null;

    if (!cert) {
        if (certRaiz) return { elegivel: true, motivo: null, tipoCert: 'A1-raiz', certEmpresaId: certRaiz.empresaId };
        return {
            elegivel: false,
            motivo: 'NFSe Nacional ADN exige certificado A1 proprio da empresa (ou da matriz, mesma raiz de CNPJ); certificado do escritorio retorna E2243 (CNPJ base divergente).',
        };
    }

    const tipoCert = cert.tipoCert || 'A1';
    if (tipoCert === 'A3') {
        // A3 da própria empresa não roda em nuvem, mas se a MATRIZ tem A1
        // válido a filial captura por ele (não precisa do agente local).
        if (certRaiz) return { elegivel: true, motivo: null, tipoCert: 'A1-raiz', certEmpresaId: certRaiz.empresaId };
        return {
            elegivel: false,
            motivo: 'NFSe Nacional ADN no Cloud Run exige A1 proprio; certificado A3 precisa fluxo/agente local especifico.',
            tipoCert,
        };
    }
    if (tipoCert !== 'A1') {
        return { elegivel: false, motivo: `Tipo de certificado ${tipoCert} nao suportado para ADN.`, tipoCert };
    }

    // Daqui pra baixo, cert próprio COM defeito: se a matriz (mesma raiz) tem
    // A1 válido, a captura segue por ele — o defeito do cert da filial vira
    // pendência de cadastro, não bloqueio de captura.
    if (!cert.storagePath || !cert.passwordEnc) {
        if (certRaiz) return { elegivel: true, motivo: null, tipoCert: 'A1-raiz', certEmpresaId: certRaiz.empresaId };
        return {
            elegivel: false,
            motivo: 'Certificado A1 marcado no cadastro, mas sem PFX/senha armazenados. Reenvie o .pfx pela coluna Certificado.',
            tipoCert,
        };
    }

    const notAfterMs = toMillis(cert.notAfter);
    if (!notAfterMs || notAfterMs <= nowMs) {
        if (certRaiz) return { elegivel: true, motivo: null, tipoCert: 'A1-raiz', certEmpresaId: certRaiz.empresaId };
        return {
            elegivel: false,
            motivo: 'Certificado A1 proprio vencido ou sem validade cadastrada. Reenvie/renove o .pfx.',
            tipoCert,
        };
    }

    const cnpjCert = String(cert.cnpj || '').replace(/\D/g, '');
    if (!cnpjCert || cnpjCert.slice(0, 8) !== cnpj.slice(0, 8)) {
        if (certRaiz) return { elegivel: true, motivo: null, tipoCert: 'A1-raiz', certEmpresaId: certRaiz.empresaId };
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
    // certsMeta: lista com empresaId — base do fallback de RAIZ (matriz ↔ filial).
    const certsMeta = [];
    try {
        const certsSnap = await db.collection('empresas_certificados').get();
        certsSnap.forEach((doc) => {
            const c = doc.data();
            certsPorId.set(doc.id, c);
            certsMeta.push({
                empresaId: doc.id,
                tipoCert: c.tipoCert || 'A1',
                cnpj: c.cnpj,
                notAfter: c.notAfter,
                storagePath: c.storagePath,
                passwordEnc: c.passwordEnc,
            });
        });
    } catch (e) {
        console.warn('[nfse-nac-dfe/elegibilidade] erro lendo empresas_certificados:', e.message);
    }

    const todos = [];
    const bloqueiosPorMotivo = {};
    for (const emp of empresasPorCnpj.values()) {
        const classif = classificarElegibilidadeAdn({
            empresa: emp,
            cert: certsPorId.get(emp.id),
            certsMeta,
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
