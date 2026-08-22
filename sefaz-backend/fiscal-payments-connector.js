// Conector unificado de pagamentos tributarios para consumidores internos (CCI).
//
// Regra central: status local "pago" nao e comprovante de arrecadacao. O valor
// so entra como contabilizavel quando existe evidencia oficial, explicitamente
// marcada e proveniente de uma fonte permitida. Falha/ausencia de consulta
// permanece visivel como cobertura incompleta; nunca vira zero ou "nao pago".

import admin from 'firebase-admin';
import { fetchAllDocs } from './firestore-paginate.js';
import { acharEmpresaCadastrada, soDigitos } from './empresa-cadastro-lookup.js';
import { getCertInfoEmpresa } from './cert-storage.js';

const FONTES_OFICIAIS = new Set([
    'ECAC', 'RECEITA_ECAC', 'SERPRO', 'PGDASD', 'SICALC', 'DCTFWEB',
    'FGTS_DIGITAL', 'SEFAZ', 'GNRE', 'PREFEITURA', 'PORTAL_MUNICIPAL',
]);

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

function numero(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

function isoData(v) {
    if (!v) return '';
    if (typeof v.toDate === 'function') return v.toDate().toISOString().slice(0, 10);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v).slice(0, 10);
}

function texto(v) { return String(v == null ? '' : v).trim(); }
function fonteNormalizada(v) { return texto(v).toUpperCase().replace(/[^A-Z0-9_]/g, '_'); }

function certValido(info, nowMs = Date.now()) {
    if (!info) return false;
    const fim = Date.parse(info.notAfter || info.validade?.fim || '');
    return Number.isFinite(fim) && fim > nowMs;
}

function comprovanteOficial(d, cnpj) {
    const fonte = fonteNormalizada(d.fonte || d.origem);
    const cnpjDoc = soDigitos(d.empresaCnpj || d.cnpj);
    const valor = numero(d.valorPago ?? d.valor_pago ?? d.valor);
    return d.confirmacaoOficial === true
        && FONTES_OFICIAIS.has(fonte)
        && cnpjDoc === cnpj
        && valor > 0
        && !!texto(d.identificador || d.numeroDocumento || d.numero_documento || d.comprovanteId);
}

function chaveDocumento(v) {
    return texto(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatarCnpj(cnpj) {
    return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

async function buscarDocsCnpj(db, colecao, cnpj, competencia) {
    const variantes = [cnpj, formatarCnpj(cnpj)];
    const lotes = await Promise.all(variantes.map(async (valorCnpj) => {
        const q = db.collection(colecao).where('empresaCnpj', '==', valorCnpj);
        return fetchAllDocs(q, { label: `fiscal_connector/${colecao}` });
    }));
    const unicos = new Map();
    for (const doc of lotes.flat()) {
        const data = doc.data() || {};
        if (soDigitos(data.empresaCnpj) !== cnpj) continue;
        const competenciaDoc = texto(data.competencia || data.periodoApuracao || (
            data.anoPA && data.mesPA ? `${data.anoPA}-${String(data.mesPA).padStart(2, '0')}` : ''
        ));
        if (competencia && competenciaDoc !== competencia) continue;
        unicos.set(doc.id, doc);
    }
    return [...unicos.values()];
}

function normalizarComprovante(doc, cnpj) {
    const d = doc.data ? doc.data() : doc;
    if (!comprovanteOficial(d, cnpj)) return null;
    const fonte = fonteNormalizada(d.fonte || d.origem);
    const valorPago = numero(d.valorPago ?? d.valor_pago ?? d.valor);
    const numeroDocumento = texto(d.numeroDocumento || d.numero_documento || d.identificador || d.comprovanteId);
    return {
        id: `OFICIAL_${doc.id || chaveDocumento(numeroDocumento)}`,
        competencia: texto(d.competencia || d.periodoApuracao),
        tributo: texto(d.tributo || d.tipoDocumento || 'OUTROS').toUpperCase(),
        codigo_receita: texto(d.codigoReceita || d.codigo_receita),
        valor_apurado: numero(d.valorApurado ?? d.valor_apurado ?? valorPago),
        valor_pago: valorPago,
        vencimento: isoData(d.vencimento),
        data_pagamento: isoData(d.dataPagamento || d.data_pagamento || d.dataArrecadacao),
        numero_documento: numeroDocumento,
        origem: fonte,
        status: 'PAGO',
        pendencia_ecac: '',
        anexo_url: texto(d.comprovanteUrl || d.anexo_url),
        observacoes: texto(d.observacoes || `Pagamento confirmado por ${fonte}.`).slice(0, 1200),
        contabilizavel: true,
        evidencia_pagamento: {
            nivel: 'oficial',
            fonte,
            identificador: texto(d.identificador || d.comprovanteId || numeroDocumento),
            consultado_em: isoData(d.consultadoEm || d.consultado_em || d.atualizadoEm),
        },
    };
}

function normalizarEmissao(tipo, doc, comprovantePorNumero) {
    const d = doc.data ? doc.data() : doc;
    const numeroDocumento = texto(d.numeroDocumento || d.numeroDas || d.id || doc.id);
    const comprovante = comprovantePorNumero.get(chaveDocumento(numeroDocumento));
    if (comprovante) return { ...comprovante, id: `${tipo}_${doc.id || chaveDocumento(numeroDocumento)}` };

    const marcadoPago = texto(d.statusPagamento).toLowerCase() === 'pago';
    const valor = numero(d.valor ?? d.valorTotal ?? d.valorPrincipal);
    return {
        id: `${tipo}_${doc.id || chaveDocumento(numeroDocumento)}`,
        competencia: texto(d.competencia || (d.anoPA && d.mesPA ? `${d.anoPA}-${String(d.mesPA).padStart(2, '0')}` : '')),
        tributo: tipo === 'DAS' ? 'DAS' : texto(d.tributo || 'DARF').toUpperCase(),
        codigo_receita: texto(d.codigoReceita || d.codigo_receita),
        valor_apurado: valor,
        valor_pago: 0,
        valor_informado_pago: marcadoPago ? valor : 0,
        vencimento: isoData(d.vencimento || d.dataVencimento),
        data_pagamento: marcadoPago ? isoData(d.dataPagamento) : '',
        numero_documento: numeroDocumento,
        origem: tipo === 'DAS' ? 'CFI_DAS' : 'CFI_DARF',
        status: marcadoPago ? 'EM_ANALISE' : (texto(d.statusPagamento).toLowerCase() === 'vencido' ? 'VENCIDO' : 'EM_ABERTO'),
        pendencia_ecac: marcadoPago ? 'Pagamento informado no CFI, ainda sem comprovante oficial vinculado.' : '',
        anexo_url: '',
        observacoes: marcadoPago
            ? 'Marcacao local de pagamento. Nao contabilizar ate vincular comprovante oficial.'
            : 'Guia emitida no CFI; pagamento oficial ainda nao confirmado.',
        contabilizavel: false,
        evidencia_pagamento: {
            nivel: marcadoPago ? 'declarado_cfi' : 'ausente',
            fonte: tipo === 'DAS' ? 'CFI_DAS' : 'CFI_DARF',
            identificador: numeroDocumento,
            consultado_em: '',
        },
    };
}

async function resolverCredencial(db, cnpj, deps, nowMs) {
    const cadastro = await (deps.acharEmpresa || acharEmpresaCadastrada)(db, cnpj);
    if (!cadastro) return { tipo: 'indisponivel', pronta: false, motivo: 'Empresa nao encontrada no cadastro fiscal do CFI.' };

    const infoEmpresa = await (deps.getCertInfo || getCertInfoEmpresa)(cadastro.empresaId);
    if (certValido(infoEmpresa, nowMs) && soDigitos(infoEmpresa.cnpj).slice(0, 8) === cnpj.slice(0, 8)) {
        return { tipo: 'certificado_cliente', pronta: true, empresa_id: cadastro.empresaId, validade: infoEmpresa.notAfter };
    }

    const cadastroSnap = await db.collection(cadastro.colecao).doc(cadastro.empresaId).get();
    const empresa = cadastroSnap.exists ? cadastroSnap.data() || {} : {};
    const globalSnap = await db.collection('sefaz_certificados').doc('atual').get();
    const global = globalSnap.exists ? globalSnap.data() || {} : {};
    if (empresa.procuracaoEcacAtiva === true && certValido(global, nowMs)) {
        return {
            tipo: 'certificado_escritorio_procuracao', pronta: true,
            empresa_id: cadastro.empresaId, validade: global.validade?.fim || '',
        };
    }
    return {
        tipo: 'indisponivel', pronta: false, empresa_id: cadastro.empresaId,
        motivo: empresa.procuracaoEcacAtiva === true
            ? 'Certificado do escritorio ausente ou vencido.'
            : 'Sem certificado valido do cliente e sem procuracao e-CAC ativa.',
    };
}

export async function consultarPagamentosTributarios(cnpjEntrada, options = {}) {
    const cnpj = soDigitos(cnpjEntrada);
    if (cnpj.length !== 14) throw new Error('cnpj invalido');
    const db = options.db || fa().firestore();
    const nowMs = options.nowMs ?? Date.now();
    const competencia = texto(options.competencia);
    const [dasDocs, darfDocs, dctfDocs, comprovanteDocs, credencial] = await Promise.all([
        buscarDocsCnpj(db, 'das_emitidos', cnpj, competencia),
        buscarDocsCnpj(db, 'darfs_emitidos', cnpj, competencia),
        buscarDocsCnpj(db, 'dctfweb_declaracoes', cnpj, competencia),
        buscarDocsCnpj(db, 'fiscal_pagamentos_oficiais', cnpj, competencia),
        resolverCredencial(db, cnpj, options.deps || {}, nowMs),
    ]);

    const comprovantes = comprovanteDocs.map(d => normalizarComprovante(d, cnpj)).filter(Boolean);
    const porNumero = new Map(comprovantes.map(c => [chaveDocumento(c.numero_documento), c]));
    const emissoes = [
        ...dasDocs.map(d => normalizarEmissao('DAS', d, porNumero)),
        ...darfDocs.map(d => normalizarEmissao('DARF', d, porNumero)),
    ];
    const documentosComprovados = new Set(emissoes.filter(i => i.contabilizavel).map(i => chaveDocumento(i.numero_documento)));
    const itens = [...emissoes, ...comprovantes.filter(c => !documentosComprovados.has(chaveDocumento(c.numero_documento)))]
        .sort((a, b) => `${b.data_pagamento || ''}${b.competencia || ''}`.localeCompare(`${a.data_pagamento || ''}${a.competencia || ''}`));

    const resumo = itens.reduce((acc, item) => {
        acc.total++;
        acc.valor_apurado += numero(item.valor_apurado);
        if (item.contabilizavel) {
            acc.confirmados++;
            acc.valor_pago_confirmado += numero(item.valor_pago);
        } else if (item.evidencia_pagamento?.nivel === 'declarado_cfi') {
            acc.aguardando_comprovante++;
            acc.valor_informado_nao_confirmado += numero(item.valor_informado_pago);
        }
        return acc;
    }, { total: 0, confirmados: 0, aguardando_comprovante: 0, valor_apurado: 0, valor_pago_confirmado: 0, valor_informado_nao_confirmado: 0 });
    Object.keys(resumo).forEach(k => { if (typeof resumo[k] === 'number' && k.startsWith('valor_')) resumo[k] = +resumo[k].toFixed(2); });

    const avisos = [];
    if (!credencial.pronta) avisos.push(credencial.motivo);
    if (resumo.aguardando_comprovante) avisos.push(`${resumo.aguardando_comprovante} pagamento(s) marcado(s) no CFI aguardam comprovante oficial.`);

    return {
        ok: true,
        contrato: 'fiscal_pagamentos_v1',
        cnpj,
        competencia: competencia || null,
        credencial,
        resumo,
        itens,
        cobertura: {
            cfi_emissoes: { status: 'consultado', das: dasDocs.length, darfs: darfDocs.length },
            receita_ecac: { status: comprovantes.length ? 'comprovantes_importados' : (credencial.pronta ? 'credencial_pronta_sem_consulta_automatica' : 'sem_credencial'), comprovantes: comprovantes.length },
            dctfweb: { status: 'consultado', declaracoes: dctfDocs.length },
            fgts_digital: { status: 'adaptador_nao_configurado' },
            estadual: { status: 'adaptador_nao_configurado' },
            municipal: { status: 'adaptador_nao_configurado' },
        },
        avisos,
    };
}

export const _test = { normalizarComprovante, normalizarEmissao, comprovanteOficial, certValido };
