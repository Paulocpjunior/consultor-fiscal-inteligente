// ============================================================================
// sefaz-backend/sharepoint-auto-sync.js
//
// Auto-sync: Cloud Scheduler calls POST /api/admin/sharepoint/auto-sync
// and this module syncs all empresas that have sharePointConfig enabled.
//
// For each empresa, it:
//   1. Builds folder paths (SAÍDA + ENTRADA) for the current month
//   2. Downloads XMLs via the proxy-backend
//   3. Parses each XML server-side using @xmldom/xmldom
//   4. Deduplicates by chave de acesso
//   5. Stores new documents in documentos_fiscais collection
//
// Also supports on-demand sync for a single empresa.
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import { DOMParser } from '@xmldom/xmldom';
import crypto from 'crypto';
import { validarXmlSeguro, XmlInseguroError } from './xml-seguranca.js';
import { competenciasAutoSync } from './sharepoint-competencia-helper.js';
import { secretsMatch } from './cron-secret.js';
// 🚨 O corte de 200 caracteres decapitava o nome do app do Azure, que vem
// DEPOIS na resposta da Microsoft — o card acusava "a resposta não nomeou o
// aplicativo" sobre 416 respostas que nomeavam.
import { recortarPreservandoApp } from './sharepoint-erro-credencial.js';
// 🚨 O caminho MUDOU em 02/09: a árvore real não tem nível de GRUPO, a empresa
// vem ANTES do departamento e o mês é por NOME. E o nome da pasta da empresa é
// HUMANO — tem de ser ACHADO pelo código, nunca montado. Ver caminho-sharepoint.js.
import { PASTA_RAIZ, caminhoFiscal } from './caminho-sharepoint.js';
// Dono único de "qual é a pasta desta empresa?" — a frase de cada situação é
// régua, e quatro cópias dela divergiriam no primeiro ajuste.
import { listarPastasDeEmpresas, resolverPastaDaEmpresa, codClienteDoCadastro } from './sharepoint-pastas.js';
// 🚨 "879 erros" e a maioria não era erro — a classificação separa o que pede
// ações OPOSTAS: pasta que ainda não existe, limite do próprio proxy e
// credencial recusada.
import { classificarErroDeLeitura, intervaloEntreChamadasMs, resumoDaRodada } from './sharepoint-erro-leitura.js';

/**
 * O teto publicado pelo proxy (`proxy-backend/server.js`: 60/min por IP).
 *
 * ⚠️ Ele vive numa env com o valor de HOJE como padrão: cravar aqui o número
 * do outro serviço é a família do tenant cravado (28/08) — mudou lá, o app
 * continua batendo rápido demais e ninguém liga uma coisa à outra.
 */
const RESPIRO_PROXY_MS = intervaloEntreChamadasMs(process.env.SHAREPOINT_PROXY_POR_MINUTO || 60);
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const router = express.Router();
router.use(express.json());

const PROXY_URL = process.env.SHAREPOINT_PROXY_URL
    || 'https://consultor-fiscal-proxy-631239634290.us-west1.run.app';
const PROXY_TOKEN = process.env.SHAREPOINT_PROXY_TOKEN || process.env.PROXY_SHARED_TOKEN || '';

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

// ─── XML Parser (server-side, mirrors xmlParserService.ts) ──────────────────

function getTextContent(parent, tagName) {
    if (!parent) return '';
    const els = parent.getElementsByTagName(tagName);
    if (!els || els.length === 0) return '';
    return (els[0].textContent || '').trim();
}

function num(v) { return parseFloat(v) || 0; }
function onlyDigits(s) { return (s || '').replace(/\D/g, ''); }

function extractChaveFromId(id) {
    const m = (id || '').match(/\d{44}/);
    return m ? m[0] : '';
}

function parseXmlServer(xmlText) {
    try {
        validarXmlSeguro(xmlText);
    } catch (e) {
        if (e instanceof XmlInseguroError) {
            console.warn('[sharepoint-auto-sync] XML rejeitado:', e.motivo);
            return null;
        }
        throw e;
    }
    const parser = new DOMParser({
        errorHandler: { warning: () => {}, error: () => {}, fatalError: () => {} },
    });
    const doc = parser.parseFromString(xmlText, 'text/xml');

    // CT-e
    const infCte = doc.getElementsByTagName('infCte')[0];
    if (infCte) return parseCTeServer(doc, infCte);

    const infNFe = doc.getElementsByTagName('infNFe')[0];
    if (!infNFe) return null;

    const ide = doc.getElementsByTagName('ide')[0];
    const emit = doc.getElementsByTagName('emit')[0];
    const dest = doc.getElementsByTagName('dest')[0];
    const total = doc.getElementsByTagName('total')[0];
    const icmsTot = total ? total.getElementsByTagName('ICMSTot')[0] : null;

    const modelo = getTextContent(ide, 'mod');
    const tipo = modelo === '65' ? 'NFCe' : 'NFe';

    const detElements = doc.getElementsByTagName('det');
    const itens = [];
    for (let i = 0; i < detElements.length; i++) {
        const det = detElements[i];
        const prod = det.getElementsByTagName('prod')[0];
        const icms = det.getElementsByTagName('ICMS')[0];
        const ipi = det.getElementsByTagName('IPI')[0];
        const pis = det.getElementsByTagName('PIS')[0];
        const cofins = det.getElementsByTagName('COFINS')[0];

        let cst = '', vICMS = 0, vBC = 0, aliqIcms = 0;
        let vBCST = 0, aliqST = 0, vICMSST = 0, pRedBC = 0, orig = '';
        if (icms && icms.childNodes) {
            for (let j = 0; j < icms.childNodes.length; j++) {
                const inner = icms.childNodes[j];
                if (inner.nodeType === 1) {
                    cst = getTextContent(inner, 'CST') || getTextContent(inner, 'CSOSN');
                    vICMS = num(getTextContent(inner, 'vICMS'));
                    vBC = num(getTextContent(inner, 'vBC'));
                    aliqIcms = num(getTextContent(inner, 'pICMS'));
                    vBCST = num(getTextContent(inner, 'vBCST'));
                    aliqST = num(getTextContent(inner, 'pICMSST'));
                    vICMSST = num(getTextContent(inner, 'vICMSST'));
                    pRedBC = num(getTextContent(inner, 'pRedBC'));
                    orig = getTextContent(inner, 'orig');
                    break;
                }
            }
        }

        let vIPI = 0, aliqIPI = 0;
        if (ipi) {
            const ipiTrib = ipi.getElementsByTagName('IPITrib')[0];
            if (ipiTrib) {
                vIPI = num(getTextContent(ipiTrib, 'vIPI'));
                aliqIPI = num(getTextContent(ipiTrib, 'pIPI'));
            }
        }

        let vPIS = 0, aliqPIS = 0;
        if (pis && pis.childNodes) {
            for (let j = 0; j < pis.childNodes.length; j++) {
                const inner = pis.childNodes[j];
                if (inner.nodeType === 1) {
                    vPIS = num(getTextContent(inner, 'vPIS'));
                    aliqPIS = num(getTextContent(inner, 'pPIS'));
                    break;
                }
            }
        }

        let vCOFINS = 0, aliqCOFINS = 0;
        if (cofins && cofins.childNodes) {
            for (let j = 0; j < cofins.childNodes.length; j++) {
                const inner = cofins.childNodes[j];
                if (inner.nodeType === 1) {
                    vCOFINS = num(getTextContent(inner, 'vCOFINS'));
                    aliqCOFINS = num(getTextContent(inner, 'pCOFINS'));
                    break;
                }
            }
        }

        itens.push({
            nItem: det.getAttribute('nItem') || String(i + 1),
            cProd: getTextContent(prod, 'cProd'),
            xProd: getTextContent(prod, 'xProd'),
            ncm: getTextContent(prod, 'NCM'),
            cest: getTextContent(prod, 'CEST') || undefined,
            cfop: getTextContent(prod, 'CFOP'),
            uCom: getTextContent(prod, 'uCom'),
            qCom: num(getTextContent(prod, 'qCom')),
            vUnCom: num(getTextContent(prod, 'vUnCom')),
            vProd: num(getTextContent(prod, 'vProd')),
            vDesc: num(getTextContent(prod, 'vDesc')) || undefined,
            vBC, aliqIcms, vICMS, vBCST, aliqST, vICMSST, pRedBC,
            vIPI, aliqIPI, vPIS, aliqPIS, vCOFINS, aliqCOFINS, cst, orig,
        });
    }

    const emitEnder = emit ? emit.getElementsByTagName('enderEmit')[0] : null;
    const destEnder = dest ? dest.getElementsByTagName('enderDest')[0] : null;

    const parseParticipante = (el, enderEl) => ({
        cnpjCpf: onlyDigits(getTextContent(el, 'CNPJ') || getTextContent(el, 'CPF')),
        nome: getTextContent(el, 'xNome'),
        fantasia: getTextContent(el, 'xFant') || undefined,
        ie: getTextContent(el, 'IE') || undefined,
        uf: getTextContent(enderEl, 'UF') || undefined,
        municipio: getTextContent(enderEl, 'xMun') || undefined,
        codMunIBGE: getTextContent(enderEl, 'cMun') || undefined,
        logradouro: getTextContent(enderEl, 'xLgr') || undefined,
        numero: getTextContent(enderEl, 'nro') || undefined,
        complemento: getTextContent(enderEl, 'xCpl') || undefined,
        bairro: getTextContent(enderEl, 'xBairro') || undefined,
        cep: onlyDigits(getTextContent(enderEl, 'CEP')) || undefined,
    });

    const cStat = getTextContent(doc.getElementsByTagName('infProt')[0], 'cStat');
    const status = cStat === '100' ? 'autorizado'
        : cStat === '101' ? 'cancelado'
        : cStat === '110' ? 'denegado'
        : cStat === '102' ? 'inutilizado'
        : !cStat ? 'desconhecido' : 'rejeitado';

    return {
        chave: extractChaveFromId(infNFe.getAttribute('Id') || ''),
        tipo, modelo,
        serie: getTextContent(ide, 'serie'),
        numero: getTextContent(ide, 'nNF'),
        natOp: getTextContent(ide, 'natOp'),
        dhEmi: getTextContent(ide, 'dhEmi') || getTextContent(ide, 'dEmi'),
        status,
        emitente: parseParticipante(emit, emitEnder),
        destinatario: parseParticipante(dest, destEnder),
        itens,
        totais: {
            vBC: num(getTextContent(icmsTot, 'vBC')),
            vICMS: num(getTextContent(icmsTot, 'vICMS')),
            vICMSDeson: num(getTextContent(icmsTot, 'vICMSDeson')),
            vFCP: num(getTextContent(icmsTot, 'vFCP')),
            vBCST: num(getTextContent(icmsTot, 'vBCST')),
            vST: num(getTextContent(icmsTot, 'vST')),
            vFCPST: num(getTextContent(icmsTot, 'vFCPST')),
            vProd: num(getTextContent(icmsTot, 'vProd')),
            vFrete: num(getTextContent(icmsTot, 'vFrete')),
            vSeg: num(getTextContent(icmsTot, 'vSeg')),
            vDesc: num(getTextContent(icmsTot, 'vDesc')),
            vII: num(getTextContent(icmsTot, 'vII')),
            vIPI: num(getTextContent(icmsTot, 'vIPI')),
            vIPIDevol: num(getTextContent(icmsTot, 'vIPIDevol')),
            vPIS: num(getTextContent(icmsTot, 'vPIS')),
            vCOFINS: num(getTextContent(icmsTot, 'vCOFINS')),
            vOutro: num(getTextContent(icmsTot, 'vOutro')),
            vNF: num(getTextContent(icmsTot, 'vNF')),
        },
    };
}

function parseCTeServer(doc, infCte) {
    const ide = doc.getElementsByTagName('ide')[0];
    const emit = doc.getElementsByTagName('emit')[0];
    const rem = doc.getElementsByTagName('rem')[0];
    const dest = doc.getElementsByTagName('dest')[0];
    const vPrest = doc.getElementsByTagName('vPrest')[0];
    const imp = doc.getElementsByTagName('imp')[0];
    const icmsEl = imp ? imp.getElementsByTagName('ICMS')[0] : null;

    const chave = extractChaveFromId(infCte.getAttribute('Id') || '');
    const enderEmit = emit ? emit.getElementsByTagName('enderEmit')[0] : null;
    const enderRem = rem ? rem.getElementsByTagName('enderReme')[0] : null;
    const enderDest = dest ? dest.getElementsByTagName('enderDest')[0] : null;

    const pp = (el, enderEl) => ({
        cnpjCpf: onlyDigits(getTextContent(el, 'CNPJ') || getTextContent(el, 'CPF')),
        nome: getTextContent(el, 'xNome'),
        ie: getTextContent(el, 'IE') || undefined,
        uf: getTextContent(enderEl, 'UF') || undefined,
        municipio: getTextContent(enderEl, 'xMun') || undefined,
        codMunIBGE: getTextContent(enderEl, 'cMun') || undefined,
    });

    let vICMS = 0, vBC = 0;
    if (icmsEl && icmsEl.childNodes) {
        for (let j = 0; j < icmsEl.childNodes.length; j++) {
            const inner = icmsEl.childNodes[j];
            if (inner.nodeType === 1) {
                vICMS = num(getTextContent(inner, 'vICMS'));
                vBC = num(getTextContent(inner, 'vBC'));
                break;
            }
        }
    }

    const valorPrest = num(getTextContent(vPrest, 'vTPrest'));
    const valorRec = num(getTextContent(vPrest, 'vRec'));

    const cStat = getTextContent(doc.getElementsByTagName('infProt')[0], 'cStat');
    const status = cStat === '100' ? 'autorizado'
        : cStat === '101' ? 'cancelado'
        : cStat === '110' ? 'denegado'
        : !cStat ? 'desconhecido' : 'rejeitado';

    const remetente = pp(rem, enderRem);
    const destinatario = pp(dest, enderDest);

    return {
        chave, tipo: 'CTe',
        modelo: getTextContent(ide, 'mod') || '57',
        serie: getTextContent(ide, 'serie'),
        numero: getTextContent(ide, 'nCT'),
        natOp: getTextContent(ide, 'natOp'),
        dhEmi: getTextContent(ide, 'dhEmi'),
        status,
        emitente: pp(emit, enderEmit),
        destinatario: remetente.cnpjCpf ? remetente : destinatario,
        itens: [],
        totais: {
            vBC, vICMS, vICMSDeson: 0, vFCP: 0, vBCST: 0, vST: 0, vFCPST: 0,
            vProd: valorPrest, vFrete: valorPrest, vSeg: 0, vDesc: 0, vII: 0,
            vIPI: 0, vIPIDevol: 0, vPIS: 0, vCOFINS: 0, vOutro: 0,
            vNF: valorRec || valorPrest,
        },
    };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sha256Hex(text) {
    return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function competenciaFromIso(isoDate) {
    if (!isoDate) return '';
    const m = isoDate.match(/^(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : '';
}

function classifyDirection(parsed, empresaCnpj) {
    const emp = onlyDigits(empresaCnpj);
    if (!emp) return 'desconhecida';
    if (onlyDigits(parsed.emitente?.cnpjCpf) === emp) return 'saida';
    if (onlyDigits(parsed.destinatario?.cnpjCpf) === emp) return 'entrada';
    return 'desconhecida';
}

function classifyCfop(itens, direcao) {
    const cfops = (itens || []).map(i => i.cfop).filter(Boolean);
    if (cfops.length === 0) return 'outro';
    const first = cfops[0].replace(/\D/g, '');
    if (['5102', '5405', '6102', '6108', '1102', '2102'].some(c => first.startsWith(c.slice(0, 1)))) {
        return direcao === 'entrada' ? 'compras' : 'vendas';
    }
    return 'outro';
}

// 🗑️ `buildFolderPath` foi DELETADO. Ele montava
// `Empresas/{grupo}/DEPARTAMENTO FISCAL/{ano}/{mes}-{ano}/{empresa}/XML {dir}`
// — um caminho que NÃO EXISTE no SharePoint (medido em 02/09). Código morto
// aqui seria a isca para alguém reativar a régua velha.


async function fetchFromProxy(path, body) {
    const resp = await fetch(`${PROXY_URL}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(PROXY_TOKEN ? { Authorization: `Bearer ${PROXY_TOKEN}` } : {}),
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Proxy error ${resp.status}`);
    }
    return resp.json();
}

// Health-check do proxy ANTES de iterar as empresas. Sem isso, um proxy fora
// do ar (ou sem credenciais Graph) vira só um "erros: N" genérico por empresa
// — ou, pior, um run 0/0/0 verde — e ninguém fica sabendo que a captura do
// SharePoint parou. O motivo vai pro log como erroFatal e a UI mostra em
// vermelho.
async function checarProxySharePoint() {
    try {
        const resp = await fetch(`${PROXY_URL}/api/sharepoint/health`, {
            headers: PROXY_TOKEN ? { Authorization: `Bearer ${PROXY_TOKEN}` } : {},
        });
        if (!resp.ok) {
            return { ok: false, motivo: `Proxy SharePoint respondeu HTTP ${resp.status} no /health` };
        }
        const d = await resp.json().catch(() => ({}));
        if (!d.configured) {
            return { ok: false, motivo: 'Proxy SharePoint sem credenciais Graph (GRAPH_CLIENT_ID/TENANT/SECRET)' };
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, motivo: `Proxy SharePoint inacessível: ${e.message}` };
    }
}

// ─── Sync logic ─────────────────────────────────────────────────────────────

async function syncEmpresa(db, empresa, competencias, pastasDeEmpresas) {
    const cfg = empresa.sharePointConfig;
    if (!cfg || !cfg.autoSyncEnabled) return null;
    // Config incompleta NÃO pode ser pulada em silêncio: a empresa aparece na
    // lista de auto-sync, o run termina 0/0/0 verde e ninguém percebe que
    // nada foi sincronizado. Devolve resultado com erro pra contar e exibir.
    // 🚨 A PASTA DA EMPRESA É ACHADA, NÃO MONTADA (02/09). Os nomes são
    // humanos — `0004 – AÇOUGUE YOKOAMA`, `0019 _3D PICTURES` — e montar
    // criaria uma pasta NOVA ao lado da que existe, duplicando o cliente.
    const achado = await resolverPastaDaEmpresa(empresa, pastasDeEmpresas);
    if (!achado.ok) {
        return {
            empresaId: empresa.id,
            empresaNome: empresa.nome,
            erro: achado.motivo,
            configIncompleta: true,
        };
    }

    const cnpj = onlyDigits(empresa.cnpj);
    if (!cnpj) {
        return {
            empresaId: empresa.id,
            empresaNome: empresa.nome,
            erro: 'Empresa sem CNPJ válido no cadastro',
            configIncompleta: true,
        };
    }

    const directions = ['SAÍDA', 'ENTRADA'];
    const summary = {
        empresaId: empresa.id, empresaNome: empresa.nome,
        // 🚨 TRÊS BALDES, não um (02/09): a rodada devolveu "879 erros" e a
        // maioria não era erro. `semPasta` é 404 de LEITURA — a competência
        // ainda não existe no SharePoint, e o auto-sync não cria pasta (quem
        // cria é a gravação). `limite` é o 429 do NOSSO proxy, que não tem
        // nada a ver com a empresa da linha.
        novos: 0, duplicados: 0, erros: 0, semPasta: 0, limite: 0, total: 0,
        competencias: [...competencias],
        // Motivo das primeiras falhas por pasta — sem isso o log só dizia
        // "erros: 2" e era impossível saber se a pasta não existe, o proxy
        // caiu ou um XML veio corrompido.
        errosDetalhe: [],
    };

    for (const competencia of competencias) {
        const [ano, mes] = competencia.split('-');

        for (const dir of directions) {
            const folderPath = caminhoFiscal({ pastaEmpresa: achado.pasta, ano, mes, direcao: dir });
            let syncResult;
            try {
                // ⚠️ RESPIRO: o proxy publica 60/min e a rodada faz 4 chamadas
                // por empresa. Sem isto, 1.664 chamadas viram ~880 recusas do
                // próprio app — é o respiro de 90s da SEFAZ com outra roupa.
                if (RESPIRO_PROXY_MS > 0) await esperar(RESPIRO_PROXY_MS);
                syncResult = await fetchFromProxy('/api/sharepoint/sync', { folderPath });
            } catch (err) {
                const cls = classificarErroDeLeitura(err.message);
                // 🚨 404 de LEITURA não é falha: é "esta competência ainda não
                // existe no SharePoint". Contá-lo como erro pintava a carteira
                // inteira de vermelho todo dia sobre uma situação normal.
                if (cls.causa === 'pasta-inexistente') { summary.semPasta++; continue; }
                if (cls.causa === 'limite-do-proxy') summary.limite++;
                console.warn(`[auto-sync] ${empresa.nome} ${competencia} ${dir}: ${err.message}`);
                summary.erros++;
                if (summary.errosDetalhe.length < 6) {
                    const acao = cls.acao ? ` — ${cls.acao}` : '';
                    summary.errosDetalhe.push(recortarPreservandoApp(`${competencia} ${dir}: ${err.message}${acao}`));
                }
                continue;
            }

            if (!syncResult.files || syncResult.files.length === 0) continue;
            summary.total += syncResult.files.length;

            for (const file of syncResult.files) {
                if (!file.content) { summary.erros++; continue; }

                try {
                    const parsed = parseXmlServer(file.content);
                    if (!parsed || !parsed.chave) { summary.erros++; continue; }

                    const docId = parsed.chave;
                    const existingDoc = await db.collection('documentos_fiscais').doc(docId).get();
                    if (existingDoc.exists) {
                        summary.duplicados++;
                        continue;
                    }

                    const xmlHash = sha256Hex(file.content);
                    const direcao = classifyDirection(parsed, cnpj);

                    const documento = {
                        id: docId,
                        chave: parsed.chave,
                        xmlHash,
                        tipo: parsed.tipo,
                        modelo: parsed.modelo,
                        serie: parsed.serie,
                        numero: parsed.numero,
                        natOp: parsed.natOp,
                        dhEmi: parsed.dhEmi,
                        competencia: competenciaFromIso(parsed.dhEmi),
                        direcao,
                        categoriaOperacao: classifyCfop(parsed.itens, direcao),
                        status: parsed.status,
                        empresaId: empresa.id,
                        empresaCnpj: cnpj,
                        empresaNome: empresa.nome,
                        emitente: parsed.emitente,
                        destinatario: parsed.destinatario,
                        totais: parsed.totais,
                        itens: parsed.itens,
                        fileName: file.name,
                        tamanhoBytes: file.size || Buffer.byteLength(file.content, 'utf8'),
                        origem: 'sharepoint_auto',
                        importadoPor: 'system:auto-sync',
                        importadoPorEmail: 'auto-sync@system',
                        importadoEm: Date.now(),
                        createdBy: 'system:auto-sync',
                        createdByEmail: 'auto-sync@system',
                    };

                    // Remove undefined values (Firestore rejects them)
                    const clean = JSON.parse(JSON.stringify(documento));
                    await db.collection('documentos_fiscais').doc(docId).set(clean);
                    summary.novos++;
                } catch (err) {
                    console.warn(`[auto-sync] erro processando ${file.name}:`, err.message);
                    summary.erros++;
                    if (summary.errosDetalhe.length < 6) {
                        summary.errosDetalhe.push(recortarPreservandoApp(`${file.name}: ${err.message}`));
                    }
                }
            }
        }
    }

    if (summary.errosDetalhe.length === 0) delete summary.errosDetalhe;
    return summary;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/**
 * POST /auto-sync
 * Body: { competencia?: 'YYYY-MM' }
 *
 * Called by Cloud Scheduler or manually by admin.
 * Syncs all empresas with sharePointConfig.autoSyncEnabled = true.
 *
 * Auth: either Bearer (admin token) or X-CloudScheduler-JobName header.
 */
router.post('/auto-sync', async (req, res) => {
    try {
        // Auth: admin Bearer (token Firebase + role admin) OU x-cron-secret.
        // Antes aceitava QUALQUER request com header x-cloudscheduler-jobname,
        // que e trivialmente spoofavel via curl. Agora exige o cron-secret
        // (alinhado a /sync-cron e demais crons) ou um admin autenticado.
        const authHeader = req.headers.authorization || '';
        const cronSecret = req.headers['x-cron-secret'] || req.headers['x-sefaz-cron-secret'] || '';
        const CRON_SECRET = process.env.SEFAZ_CRON_SECRET || '';

        const isCron = secretsMatch(cronSecret, CRON_SECRET);
        let isAdmin = false;
        if (!isCron && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split(' ')[1];
            const decoded = await fa().auth().verifyIdToken(token);
            const userDoc = await fa().firestore().collection('users').doc(decoded.uid).get();
            isAdmin = userDoc.exists && userDoc.data().role === 'admin';
        }
        if (!isCron && !isAdmin) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const db = fa().firestore();
        // Janela de competências: anterior + atual por padrão. Varredura só do
        // mês corrente perdia os XMLs da competência anterior depositados após
        // a virada (fechamento fiscal acontece nos primeiros dias do mês
        // seguinte — caso J.N. VINATEX 06/2026 vazio em 07/07/2026). Dedup por
        // chave torna a re-varredura idempotente. Competência explícita no
        // body continua valendo sozinha.
        const competencias = competenciasAutoSync(Date.now(), {
            explicita: req.body?.competencia,
            janelas: parseInt(process.env.SHAREPOINT_SYNC_JANELAS || '2', 10),
        });
        const competencia = competencias.join(' + '); // exibição/log (UI mostra string)

        // Read all empresas with auto-sync enabled
        const empresas = [];
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            for (const doc of snap.docs) {
                const data = { id: doc.id, ...doc.data() };
                if (data.sharePointConfig?.autoSyncEnabled) {
                    empresas.push(data);
                }
            }
        }

        if (empresas.length === 0) {
            return res.json({
                message: 'Nenhuma empresa com auto-sync habilitado.',
                competencia,
                competencias,
                results: [],
            });
        }

        // Proxy fora do ar / sem credenciais → registra a falha no log (a UI
        // mostra em vermelho) em vez de produzir um run 0/0/0 aparentemente ok.
        const saude = await checarProxySharePoint();
        if (!saude.ok) {
            console.error(`[auto-sync] abortado: ${saude.motivo}`);
            await db.collection('sharepoint_sync_log').add({
                competencia,
                competencias,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                empresasProcessadas: 0,
                totalNovos: 0, totalDup: 0, totalErros: empresas.length,
                erroFatal: saude.motivo,
                results: [],
            }).catch(() => {});
            return res.status(502).json({ error: saude.motivo, competencia, competencias });
        }

        // 🚨 AS PASTAS DAS EMPRESAS SÃO LIDAS UMA VEZ POR RODADA. O nome é
        // humano e tem de ser ACHADO pelo código; ler por empresa seriam ~400
        // idas ao Graph (o HTTP 429 de 27/08 com outra roupa).
        // ⚠️ Falhar aqui é FATAL e vai DITO: sem a lista, NENHUMA empresa
        // resolve o caminho, e 416 linhas de "pasta não encontrada" mandariam
        // criar 416 pastas que talvez já existam.
        let pastasDeEmpresas;
        try {
            pastasDeEmpresas = await listarPastasDeEmpresas();
        } catch (e) {
            const motivo = `Não foi possível listar as pastas de ${PASTA_RAIZ} no SharePoint: ${e.message}`;
            console.error(`[auto-sync] abortado: ${motivo}`);
            await db.collection('sharepoint_sync_log').add({
                competencia,
                competencias,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                empresasProcessadas: 0,
                totalNovos: 0, totalDup: 0, totalErros: empresas.length,
                erroFatal: motivo,
                results: [],
            }).catch(() => {});
            return res.status(502).json({ error: motivo, competencia, competencias });
        }

        console.log(`[auto-sync] Iniciando sync de ${empresas.length} empresa(s), `
            + `${pastasDeEmpresas.length} pasta(s) em ${PASTA_RAIZ}, competencia(s) ${competencia}`);

        const results = [];
        for (const empresa of empresas) {
            try {
                const result = await syncEmpresa(db, empresa, competencias, pastasDeEmpresas);
                if (result) results.push(result);
            } catch (err) {
                console.error(`[auto-sync] erro em ${empresa.nome}:`, err.message);
                results.push({
                    empresaId: empresa.id,
                    empresaNome: empresa.nome,
                    erro: err.message,
                });
            }
        }

        const totalNovos = results.reduce((s, r) => s + (r.novos || 0), 0);
        const totalDup = results.reduce((s, r) => s + (r.duplicados || 0), 0);
        // Empresa que falhou inteira (erro/config incompleta) também conta como
        // erro — antes só os erros por arquivo entravam e a falha sumia do total.
        const totalErros = results.reduce((s, r) => s + (r.erros || 0) + (r.erro ? 1 : 0), 0);
        // 🚨 OS DOIS NÚMEROS QUE SAÍRAM DO BALDE DE "ERRO" (02/09) — porque
        // pedem ações diferentes, e uma delas é NENHUMA.
        const totalSemPasta = results.reduce((s, r) => s + (r.semPasta || 0), 0);
        const totalLimite = results.reduce((s, r) => s + (r.limite || 0), 0);
        const empresasComConfigIncompleta = results.filter(r => r.configIncompleta).length;

        console.log(`[auto-sync] Concluido: ${resumoDaRodada({
            novos: totalNovos, duplicados: totalDup, erros: totalErros,
            semPasta: totalSemPasta, limite: totalLimite,
        })}`);

        // Log the sync run
        await db.collection('sharepoint_sync_log').add({
            competencia,
            competencias,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            empresasProcessadas: empresas.length,
            totalNovos, totalDup, totalErros,
            totalSemPasta, totalLimite,
            empresasComConfigIncompleta,
            erroFatal: null,
            results,
        });

        return res.json({
            competencia,
            competencias,
            empresasProcessadas: empresas.length,
            totalNovos,
            totalDup,
            totalErros,
            totalSemPasta,
            totalLimite,
            // A frase COM a causa sai daqui — a tela não a reescreve.
            resumo: resumoDaRodada({
                novos: totalNovos, duplicados: totalDup, erros: totalErros,
                semPasta: totalSemPasta, limite: totalLimite,
            }),
            empresasComConfigIncompleta,
            results,
        });
    } catch (err) {
        console.error('[auto-sync] fatal:', err);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * POST /config
 * Body: { empresaId, collection, sharePointConfig: { grupo, empresaPasta, autoSyncEnabled } }
 *
 * Admin-only endpoint to save SharePoint auto-sync config for an empresa.
 */
router.post('/config', async (req, res) => {
    try {
        const authHeader = req.headers.authorization || '';
        const m = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });

        const decoded = await fa().auth().verifyIdToken(m[1]);
        const userDoc = await fa().firestore().collection('users').doc(decoded.uid).get();
        if (!userDoc.exists || userDoc.data().role !== 'admin') {
            return res.status(403).json({ error: 'Admin only' });
        }

        const { empresaId, collection, sharePointConfig } = req.body;
        if (!empresaId || !collection || !sharePointConfig) {
            return res.status(400).json({ error: 'empresaId, collection e sharePointConfig sao obrigatorios' });
        }

        if (!['simples_empresas', 'lucro_empresas'].includes(collection)) {
            return res.status(400).json({ error: 'collection invalida' });
        }

        // 🚨 A TRAVA MUDOU DE CAMPO EM 02/09, e ela era a pior das duas: ela
        // RECUSAVA ligar o auto-sync sem `grupo` + `empresaPasta` — cadastro
        // do caminho MORTO. Ou seja, hoje era impossível ligar a captura sem
        // preencher um campo que não faz mais nada (o achado 18, 21/08, na
        // forma mais cara: não é aviso que aponta o lugar errado, é BLOQUEIO).
        //
        // O que a régua nova precisa é o **Cod.Cliente**: é por ele que a
        // pasta REAL da empresa é achada em `Empresas`. Sem ele, o auto-sync
        // sincroniza nada em silêncio, que era o run 0/0/0 "verde" de sempre.
        const doc = await fa().firestore().collection(collection).doc(empresaId).get();
        const codCliente = codClienteDoCadastro(doc.data());
        if (Boolean(sharePointConfig.autoSyncEnabled) && !codCliente) {
            return res.status(400).json({
                error: 'Esta empresa não tem Cod.Cliente no cadastro — é por ele que a pasta dela é '
                    + 'encontrada no SharePoint. Preencha em Empresas → Dados Fiscais antes de ligar o auto-sync.',
            });
        }

        // ⚠️ `grupo`/`empresaPasta` NÃO são mais gravados: campo de caminho que
        // ninguém lê é o convite para alguém preenchê-lo de novo. O que fica é
        // a MATRÍCULA (quem participa do auto-sync) e o carimbo de quem ligou.
        await fa().firestore().collection(collection).doc(empresaId).update({
            sharePointConfig: {
                autoSyncEnabled: Boolean(sharePointConfig.autoSyncEnabled),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedBy: decoded.email || decoded.uid,
            },
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error('[sharepoint-config]', err);
        return res.status(500).json({ error: err.message });
    }
});

/**
 * GET /status
 * Returns last sync log entry and list of auto-sync-enabled empresas.
 */
router.get('/status', async (req, res) => {
    try {
        const authHeader = req.headers.authorization || '';
        const m = authHeader.match(/^Bearer\s+(.+)$/i);
        if (!m) return res.status(401).json({ error: 'Token ausente' });

        const decoded = await fa().auth().verifyIdToken(m[1]);

        const db = fa().firestore();
        // Mesma régua dos vizinhos /config e /auto-sync: o histórico do sync e a
        // lista de empresas ligadas são de ADMIN, não de qualquer token válido.
        const uDoc = await db.collection('users').doc(decoded.uid).get();
        if ((uDoc.data() || {}).role !== 'admin') return res.status(403).json({ error: 'Apenas administradores' });

        const lastLogSnap = await db.collection('sharepoint_sync_log')
            .orderBy('timestamp', 'desc')
            .limit(1)
            .get();

        const lastSync = lastLogSnap.empty ? null : lastLogSnap.docs[0].data();

        // 🚨 A PERGUNTA MUDOU EM 02/09 — de STATUS para RESULTADO.
        //
        // Isto respondia *"a empresa tem `grupo` + `empresaPasta` preenchidos?"*
        // e pintava de vermelho quem não tinha, dizendo *"nada é sincronizado"*.
        // Os dois campos são cadastro do caminho MORTO: a afirmação passou a
        // ser FALSA, e a fila de trabalho que ela produzia mandava preencher um
        // campo que não muda nada (achado 18, 21/08).
        //
        // A pergunta que vale é *"a pasta desta empresa RESOLVE?"*, e quem
        // responde é o DONO — a mesma resolução que o auto-sync usa para
        // gravar. Uma tela que perguntasse diferente do trilho diria "pronta"
        // sobre empresa que o run pula.
        //
        // ⚠️ UMA listagem por REQUISIÇÃO, e a comparação é pura: leitura por
        // empresa seria o HTTP 429 de 27/08 com outra roupa.
        let pastas = null;
        let pastasErro = null;
        try {
            pastas = await listarPastasDeEmpresas();
        } catch (e) {
            // ⚠️ Falhar a LEITURA não vira "nenhuma pasta resolve": pintaria a
            // carteira inteira de vermelho por causa de uma rede que piscou.
            pastasErro = e.message;
        }

        const empresasAutoSync = [];
        // Quem NÃO resolve a pasta — a fila de trabalho de verdade, com a
        // causa e a ação de cada uma vindas do dono.
        const empresasSemPasta = [];
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            for (const d of snap.docs) {
                const data = d.data();
                if (data._merged_into || data._deleted) continue; // zumbis fora
                const codCliente = codClienteDoCadastro(data);
                const achado = pastas
                    ? await resolverPastaDaEmpresa(data, pastas)
                    : { ok: false, pasta: null, codCliente, motivo: null };
                if (data.sharePointConfig?.autoSyncEnabled) {
                    empresasAutoSync.push({
                        id: d.id,
                        nome: data.nome,
                        cnpj: data.cnpj,
                        codCliente,
                        // `null` = não deu para conferir (a listagem falhou).
                        pastaResolvida: pastas ? achado : null,
                    });
                }
                if (pastas && !achado.ok) {
                    empresasSemPasta.push({
                        id: d.id,
                        nome: data.razaoSocial || data.nome || '—',
                        cnpj: String(data.cnpj || '').replace(/\D/g, ''),
                        fonte: col === 'simples_empresas' ? 'simples' : 'lucro',
                        codCliente,
                        motivo: achado.motivo,
                    });
                }
            }
        }
        empresasSemPasta.sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

        return res.json({ lastSync, empresasAutoSync, empresasSemPasta, pastasErro });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

export default router;
