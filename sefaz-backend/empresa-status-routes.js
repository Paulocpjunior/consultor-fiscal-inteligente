// ============================================================================
// sefaz-backend/empresa-status-routes.js
// ----------------------------------------------------------------------------
// Endpoint admin que retorna pra CADA empresa elegível de captura:
//   - tipoCert      : 'A1' | 'A3' | 'escritorio' | 'nenhum'
//   - certUploaded  : bool (cert subido em empresas_certificados)
//   - certValido    : bool (notAfter > hoje)
//   - certVenceEm   : ISO date
//   - usaCertEscritorio : bool (sem cert próprio, escritório usa cert dele)
//   - procuracaoEcacAtiva : bool (flag manual no doc da empresa)
//   - nfseSpAutorizado    : bool (ccmSp + nfseSpAutorizadoEm)
//   - nfseNacionalDfeAtivo: bool
//   - capturaNfeOk        : bool
//   - capturaNfseSpOk     : bool
//   - capturaNfseNacionalOk : bool
//   - motivosBloqueio     : string[] (gaps identificados)
//
// Montado em /api/admin/sefaz/empresas-status-captura
// ============================================================================

import express from 'express';
import admin from 'firebase-admin';
import forge from 'node-forge';
import { requireAuth } from './require-admin.js';
import { getCnpjsDaCarteira } from './carteira-auth.js';
import { loadCertificate } from './secret-loader.js';
import { lookupCnpj } from './brasilapi-cache.js';
import { classificarCapturaNfseNacionalAdn } from './empresa-status-helper.js';
import { selecionarCertA1PorBase } from './cert-base-helper.js';

const router = express.Router();

function fa() {
    if (!admin.apps.length) {
        admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
    return admin;
}

function limparCnpj(value) {
    return String(value || '').replace(/\D/g, '');
}

async function buscarEmpresaDocsPorCnpj(db, cnpjLimpo) {
    const encontrados = [];
    for (const col of ['simples_empresas', 'lucro_empresas']) {
        const snap = await db.collection(col).get();
        snap.forEach((doc) => {
            if (limparCnpj(doc.data()?.cnpj) === cnpjLimpo) {
                encontrados.push({ col, doc });
            }
        });
    }
    return encontrados;
}

// Normaliza uma data que pode chegar em formatos diferentes para millis:
//   - Timestamp do Firestore   (escrito pelo backend/cron)    -> .toMillis()
//   - string ISO               (escrita pelo front via setDoc) -> Date.parse
//   - number em millis / Date  -> direto
// Sem isso o badge NFSe SP rodava .toMillis() numa string ISO (o painel grava
// nfseSpAutorizadoEm como ISO via new Date().toISOString()), o resultado virava
// null e marcava "falta autorização" mesmo com a data salva e a empresa
// ELEGÍVEL no painel. A captura em si nunca foi bloqueada — os orquestradores
// (nfse-sp-routes/orchestrator, sync-routes) checam truthiness do valor cru.
function toMillis(v) {
    if (v == null) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();        // Firestore Timestamp
    if (typeof v.toDate === 'function') return v.toDate().getTime();  // Timestamp-like
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const ms = Date.parse(v);
        return Number.isNaN(ms) ? null : ms;
    }
    return null;
}

// CNPJ do escritório (SP Assessoria Contábil) — quem detém o cert default.
const CNPJ_ESCRITORIO = (process.env.CNPJ_ESCRITORIO || '44388152000189').replace(/\D/g, '');

router.get('/empresas-status-captura', requireAuth, async (req, res) => {
    try {
        const db = fa().firestore();
        const agora = new Date();

        // Multi-tenancy: admin ve todas. Colaborador ve so as empresas da
        // carteira dele (via colecao `carteiras`). Se nao tem nenhuma na
        // carteira, vai retornar lista vazia (intencional — sem carteira =
        // sem acesso a empresa nenhuma).
        const cnpjsPermitidos = await getCnpjsDaCarteira(req.user);
        const cnpjsSet = cnpjsPermitidos ? new Set(cnpjsPermitidos) : null;

        // 1. Lista todas as empresas (Simples + Lucro)
        const empresasMap = new Map();
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            snap.forEach(doc => {
                const d = doc.data();
                const cnpj = limparCnpj(d.cnpj);
                if (cnpj.length !== 14) return;
                if (empresasMap.has(cnpj)) return; // dedup
                if (cnpjsSet && !cnpjsSet.has(cnpj)) return; // filtra pela carteira
                empresasMap.set(cnpj, {
                    id: doc.id,
                    cnpj,
                    nome: d.razaoSocial || d.nome || d.fantasia || '—',
                    regime: col === 'simples_empresas' ? 'simples' : 'lucro',
                    fonte: col,
                    capturarSefaz: d.capturarSefaz !== false, // default true
                    uf: d.dadosFiscais?.uf || d.uf || '',
                    // Cadastro UNICO: ccmSp em dadosFiscais.ccmSp (canonico, igual
                    // uf/IE). Fallback ao top-level d.ccmSp so pra dado legado.
                    ccmSp: (d.dadosFiscais?.ccmSp || d.ccmSp || '').toString().replace(/\D/g, ''),
                    nfseSpAutorizadoEm: toMillis(d.nfseSpAutorizadoEm),
                    nfseNacionalDfeAtivo: d.nfseNacionalDfeAtivo === true,
                    procuracaoEcacAtiva: d.procuracaoEcacAtiva === true,
                    // dadosFiscais completo — semeia o modal "Completar cadastro".
                    dadosFiscais: d.dadosFiscais || {},
                });
            });
        }

        // 2. Lista todos os certs cadastrados
        const certsMap = new Map();
        const certsMeta = [];
        const certsSnap = await db.collection('empresas_certificados').get();
        certsSnap.forEach(doc => {
            const d = doc.data();
            const certMeta = {
                empresaId: doc.id,
                tipoCert: d.tipoCert || 'A1', // default A1 (subido via .pfx)
                cnpjCert: (d.cnpj || '').replace(/\D/g, ''),
                cnpj: (d.cnpj || '').replace(/\D/g, ''),
                notAfter: d.notAfter || null,
                fingerprint: d.fingerprint || null,
                storagePath: d.storagePath || null,
                passwordEnc: d.passwordEnc || null,
                uploadedAt: d.uploadedAt?.toDate?.()?.toISOString?.() || null,
            };
            certsMeta.push(certMeta);
            certsMap.set(doc.id, certMeta);
        });

        // 3. Estado de última captura por CNPJ
        const stateMap = new Map();
        const stateSnap = await db.collection('sefaz_state').get();
        stateSnap.forEach(doc => {
            const d = doc.data();
            stateMap.set(doc.id, {
                ultimaSyncMs: d.ultimaSync?.toMillis?.() ?? null,
                ultNSU: d.ultNSU || '0',
                cStatUltimaSync: d.cStatUltimaSync || null,
            });
        });

        // 3b. Responsáveis (vínculos da Carteira de Clientes) por CNPJ.
        // Permite admin/colaborador ver de cara quem cuida de cada empresa
        // direto no painel de Status (antes precisava abrir Carteira de Clientes
        // numa aba separada e cruzar manualmente).
        const responsaveisMap = new Map();
        const carteirasSnap = await db.collection('carteiras').get();
        carteirasSnap.forEach(doc => {
            const d = doc.data();
            const cnpj = limparCnpj(d.empresaCnpj);
            if (!cnpj) return;
            if (!responsaveisMap.has(cnpj)) responsaveisMap.set(cnpj, []);
            responsaveisMap.get(cnpj).push({
                nome: d.colaboradorNome || '—',
                papel: d.papel || 'principal',
            });
        });

        // 4. Monta resposta agregada
        const empresas = [];
        const resumo = {
            total: 0,
            semUf: 0,
            comCertA1: 0,
            comCertA3: 0,
            usandoCertEscritorio: 0,
            semCertNenhum: 0,
            certExpirado: 0,
            certVenceEm30d: 0,
            comProcuracaoEcac: 0,
            semProcuracaoEcac: 0,
            ccmSpAutorizado: 0,
            nfseNacionalAtivo: 0,
            // Status de captura
            capturaNfeOk: 0,
            capturaNfeBloqueada: 0,
            capturaNfseSpOk: 0,
            capturaNfseNacionalOk: 0,
        };

        // Lê o cert do escritório (Secret Manager) UMA vez por request e
        // extrai o CNPJ-Base do subject. Usado pra detectar o mismatch que
        // causa cStat=593 em massa (cert global pertence a outro CNPJ).
        // loadCertificate() tem cache TTL 5min — chamada repetida é grátis.
        let cnpjBaseCertEscritorio = null;
        let certEscritorioErro = null;
        try {
            const certEsc = await loadCertificate();
            if (certEsc?.pemCert) {
                const cert509 = forge.pki.certificateFromPem(certEsc.pemCert);
                const subjectAttrs = cert509.subject?.attributes || [];
                const cn = (subjectAttrs.find(a => a.shortName === 'CN' || a.name === 'commonName')?.value || '');
                const serial = (subjectAttrs.find(a => a.shortName === 'serialNumber')?.value || '');
                const matchCN = cn.match(/:(\d{14})$/);
                const matchSerial = serial.match(/\d{14}/);
                const cnpjCert = matchCN ? matchCN[1] : (matchSerial ? matchSerial[0] : null);
                if (cnpjCert) cnpjBaseCertEscritorio = cnpjCert.slice(0, 8);
            }
        } catch (e) {
            certEscritorioErro = e.message;
            console.warn('[empresa-status-routes] falha lendo cert do escritorio:', e.message);
        }

        // CNPJ-Base esperado do cert do escritorio (44388152). Usado pro
        // sanity check do cert global no Secret Manager (detecta upload
        // errado de outro CNPJ).
        const CNPJ_ESCRITORIO_BASE = CNPJ_ESCRITORIO.slice(0, 8);
        // O cert do escritorio pode estar quebrado ou indisponivel — nesses
        // casos a captura via procuracao tambem nao serve.
        const certEscritorioUtilizavel = !certEscritorioErro
            && (!cnpjBaseCertEscritorio || cnpjBaseCertEscritorio === CNPJ_ESCRITORIO_BASE);

        const fmtDataBr = (iso) => {
            if (!iso) return null;
            try { return new Date(iso).toLocaleDateString('pt-BR'); }
            catch { return null; }
        };

        for (const emp of empresasMap.values()) {
            let cert = certsMap.get(emp.id);
            let usaA1MesmaRaiz = false;
            let tipoCert = 'nenhum';
            let certUploaded = false;
            let certValido = false;
            let certVenceEm = null;

            // A propria empresa do escritorio (S&P) tem o cert dela no Secret
            // Manager (carregado por loadCertificate()), NAO em empresas_certificados.
            // Sem esse caso especial, ela aparecia como "sem cert" na varredura
            // mesmo sendo o dono do cert global usado por todas as procuracoes.
            const ehEscritorio = emp.cnpj === CNPJ_ESCRITORIO;

            if (cert) {
                certUploaded = true;
                tipoCert = cert.tipoCert;
                if (cert.notAfter) {
                    const venceEm = new Date(cert.notAfter);
                    certValido = venceEm > agora;
                    certVenceEm = cert.notAfter;
                } else if (tipoCert === 'A3') {
                    // A3 pode ser cadastrado sem .pfx/notAfter no Cloud Run:
                    // quem valida o certificado físico é o agente local.
                    certValido = true;
                }
            } else if (ehEscritorio) {
                // Cert do escritorio vive em Secret Manager. Marca como A1 proprio.
                // Nao puxa notAfter daqui pra nao adicionar chamada ao Secret Manager
                // na rota de varredura (cara, +200ms por request). Se precisar do
                // venc real, a tela de Configurações > Certificado Digital mostra.
                tipoCert = 'A1';
                certUploaded = true;
                certValido = true;
            } else {
                const certMesmaRaiz = selecionarCertA1PorBase(certsMeta, emp.cnpj, agora.getTime(), emp.id);
                if (certMesmaRaiz) {
                    cert = certMesmaRaiz;
                    usaA1MesmaRaiz = true;
                    certUploaded = true;
                    tipoCert = 'A1-raiz';
                    certValido = true;
                    certVenceEm = certMesmaRaiz.notAfter || null;
                }
            }

            // ── Capacidade real de captura NFe ──────────────────────────────
            // Caminhos validos:
            //  a) Cert A1 proprio valido.
            //  b) Cert A1 valido de outra empresa da mesma raiz CNPJ.
            //  c) Empresa E a S&P (cert global serve direto).
            //  d) A3 proprio via agente local cfi-a3.
            // Procuracao e-CAC do escritorio nao substitui certificado na NFe
            // Distribuicao DF-e; SEFAZ rejeita com cStat=593.
            const temA1ProprioValido = tipoCert === 'A1' && certValido && !ehEscritorio;
            const temA1MesmaRaizValido = tipoCert === 'A1-raiz' && certValido && usaA1MesmaRaiz;
            const temA3Proprio = tipoCert === 'A3' && certUploaded;
            const podeUsarCertEscritorio = certEscritorioUtilizavel && ehEscritorio;
            const usaCertEscritorio = !temA1ProprioValido && podeUsarCertEscritorio;

            const procuracaoInferida = emp.procuracaoEcacAtiva;

            const motivosBloqueio = [];

            // capturaNfeOk: precisa um caminho valido + uf + flag manual.
            const capturaNfeOk = emp.capturarSefaz && !!emp.uf
                && (temA1ProprioValido || temA1MesmaRaizValido || temA3Proprio || usaCertEscritorio);

            // Mensagens de bloqueio. A3 nao entra aqui: fica coberto pelo
            // agente local.
            if (!emp.capturarSefaz) motivosBloqueio.push('NFe: captura SEFAZ desativada no cadastro');
            else if (!emp.uf) motivosBloqueio.push('NFe: UF não cadastrada. Preencha a UF nos dados fiscais da empresa.');
            else if (capturaNfeOk) {
                // Caminho valido. Sem motivo.
            }
            else if (!certValido && certUploaded) {
                const dataBr = fmtDataBr(certVenceEm);
                if (dataBr) motivosBloqueio.push(`NFe: certificado ${tipoCert} expirado em ${dataBr}. Renove o certificado A1 ou use agente local A3.`);
                else motivosBloqueio.push(`NFe: certificado ${tipoCert} sem data de validade no cadastro. Reenvie o .pfx A1 ou use agente local A3.`);
            }
            else if (tipoCert === 'nenhum') {
                motivosBloqueio.push('NFe: sem certificado A1 próprio/mesma raiz CNPJ ou marcação A3. Procuração e-CAC do escritório não substitui certificado na consulta NFe DistDFe.');
            }
            else if (!certEscritorioUtilizavel && ehEscritorio) {
                if (certEscritorioErro) {
                    motivosBloqueio.push(`NFe: certificado do escritório indisponível. Detalhe técnico: ${certEscritorioErro}`);
                } else if (cnpjBaseCertEscritorio && cnpjBaseCertEscritorio !== CNPJ_ESCRITORIO_BASE) {
                    motivosBloqueio.push(
                        `NFe: certificado do escritório pertence a outro CNPJ-base (${cnpjBaseCertEscritorio}); esperado ${CNPJ_ESCRITORIO_BASE}. ` +
                        `Suba o .pfx correto da S&P em Configurações > Certificado Digital.`
                    );
                }
            }

            // b) NFSe SP: precisa ccmSp + autorização do contador no portal SP
            const capturaNfseSpOk = !!emp.ccmSp && !!emp.nfseSpAutorizadoEm;
            if (!emp.ccmSp) motivosBloqueio.push('NFS-e SP: falta Inscrição Municipal (CCM) nos dados fiscais da empresa.');
            else if (!emp.nfseSpAutorizadoEm) motivosBloqueio.push('NFS-e SP: falta autorizar o escritório no portal nfe.prefeitura.sp.gov.br.');

            // c) NFSe Nacional ADN: no Cloud Run precisa A1 proprio da mesma
            // raiz CNPJ (ou a propria S&P com cert global). A3 nao entra no
            // cron em nuvem, mas conta como coberto no painel porque depende
            // do agente local A3.
            const nfseNacStatus = classificarCapturaNfseNacionalAdn({
                nfseNacionalDfeAtivo: emp.nfseNacionalDfeAtivo,
                temA1ProprioValido,
                ehEscritorio,
                tipoCert,
                usaCertEscritorio,
                procuracaoEcacAtiva: emp.procuracaoEcacAtiva,
                certUploaded,
                certValido,
            });
            const capturaNfseNacionalOk = nfseNacStatus.ok;
            const capturaNfseNacionalVia = nfseNacStatus.via;
            if (nfseNacStatus.motivo) motivosBloqueio.push(nfseNacStatus.motivo);

            const state = stateMap.get(emp.cnpj);

            const item = {
                id: emp.id,
                cnpj: emp.cnpj,
                nome: emp.nome,
                regime: emp.regime,
                fonte: emp.fonte,
                uf: emp.uf,
                // certificados
                tipoCert,
                certUploaded,
                certValido,
                certVenceEm,
                usaCertEscritorio,
                usaA1MesmaRaiz,
                // procuração / autorizações (flag real do cadastro)
                procuracaoEcacAtiva: procuracaoInferida,
                procuracaoEcacFlagBruta: emp.procuracaoEcacAtiva,
                ccmSp: emp.ccmSp,
                dadosFiscais: emp.dadosFiscais || {},
                nfseSpAutorizado: !!emp.nfseSpAutorizadoEm,
                nfseNacionalDfeAtivo: emp.nfseNacionalDfeAtivo,
                capturarSefaz: emp.capturarSefaz,
                // capacidades
                capturaNfeOk,
                capturaNfseSpOk,
                capturaNfseNacionalOk,
                capturaNfseNacionalVia,
                motivosBloqueio,
                // responsáveis na carteira de clientes (vazio = ninguém atribuído)
                responsaveis: responsaveisMap.get(emp.cnpj) || [],
                // estado última sync
                ultimaSyncMs: state?.ultimaSyncMs ?? null,
                ultNSU: state?.ultNSU ?? null,
                cStatUltimaSync: state?.cStatUltimaSync ?? null,
            };
            empresas.push(item);

            // Resumo
            resumo.total++;
            if (!emp.uf) resumo.semUf++;
            if (tipoCert === 'A1' || tipoCert === 'A1-raiz') resumo.comCertA1++;
            else if (tipoCert === 'A3') resumo.comCertA3++;
            else if (tipoCert === 'escritorio') resumo.usandoCertEscritorio++;
            else resumo.semCertNenhum++;
            if (certVenceEm) {
                const dias = (new Date(certVenceEm).getTime() - agora.getTime()) / 86400000;
                if (dias < 0) resumo.certExpirado++;
                else if (dias < 30) resumo.certVenceEm30d++;
            }
            if (procuracaoInferida) resumo.comProcuracaoEcac++;
            else resumo.semProcuracaoEcac++;
            if (capturaNfseSpOk) resumo.ccmSpAutorizado++;
            if (emp.nfseNacionalDfeAtivo) resumo.nfseNacionalAtivo++;
            if (capturaNfeOk) resumo.capturaNfeOk++;
            else resumo.capturaNfeBloqueada++;
            if (capturaNfseSpOk) resumo.capturaNfseSpOk++;
            if (capturaNfseNacionalOk) resumo.capturaNfseNacionalOk++;
        }

        // Ordena: bloqueadas primeiro (pra ficar fácil ver o que precisa atenção)
        empresas.sort((a, b) => {
            const aBlocked = a.motivosBloqueio.length;
            const bBlocked = b.motivosBloqueio.length;
            if (aBlocked !== bBlocked) return bBlocked - aBlocked;
            return a.nome.localeCompare(b.nome);
        });

        return res.json({ resumo, empresas, geradoEm: new Date().toISOString() });
    } catch (e) {
        console.error('[empresa-status-routes] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─── Toggle flags ──────────────────────────────────────────────────────────
// Permite admin ativar/desativar via UI: procuração e-CAC, NFSe Nacional, captura SEFAZ.

router.post('/empresa-toggle-flag', requireAuth, express.json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores' });
        }
        const { cnpj, campo, valor } = req.body || {};
        const cnpjLimpo = limparCnpj(cnpj);
        if (cnpjLimpo.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
        const FLAGS_PERMITIDAS = ['procuracaoEcacAtiva', 'nfseNacionalDfeAtivo', 'capturarSefaz'];
        if (!FLAGS_PERMITIDAS.includes(campo)) {
            return res.status(400).json({ error: `Campo inválido. Permitidos: ${FLAGS_PERMITIDAS.join(', ')}` });
        }
        if (typeof valor !== 'boolean') {
            return res.status(400).json({ error: 'Valor deve ser boolean' });
        }

        const db = fa().firestore();
        const encontrados = await buscarEmpresaDocsPorCnpj(db, cnpjLimpo);
        let atualizadas = 0;
        for (const { doc } of encontrados) {
            await doc.ref.update({
                [campo]: valor,
                [`${campo}AlteradoEm`]: admin.firestore.FieldValue.serverTimestamp(),
                [`${campo}AlteradoPor`]: req.user.email,
            });
            atualizadas++;
        }
        if (!atualizadas) {
            return res.status(404).json({
                error: 'Não localizei esta empresa no cadastro atual. Atualize o painel e confira se o CNPJ ainda existe em Simples ou Lucro Presumido/Real.',
                code: 'EMPRESA_NAO_ENCONTRADA',
                cnpj: cnpjLimpo,
            });
        }
        console.log(`[empresa-toggle-flag] cnpj=${cnpjLimpo} ${campo}=${valor} por=${req.user.email}`);
        return res.json({ ok: true, cnpj: cnpjLimpo, campo, valor, atualizadas });
    } catch (e) {
        console.error('[empresa-toggle-flag] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─── Salvar campos do cadastro (dadosFiscais) de uma empresa ───────────────
// Ponte "Completar cadastro" do painel Status por Empresa: grava os campos que
// faltam (UF, CCM, IE, etc.) direto da linha da pendência. Merge por
// dot-notation — NUNCA clobbera o dadosFiscais inteiro (só os campos enviados).
const CAMPOS_DADOS_FISCAIS = new Set([
    'inscricaoEstadual', 'uf', 'codMunIBGE', 'ccmSp', 'logradouro', 'numero',
    'complemento', 'bairro', 'cep', 'email', 'telefone', 'perfilEFD', 'indAtividade',
]);

router.post('/empresa-dados-fiscais', requireAuth, express.json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores' });
        }
        const { cnpj, dadosFiscais } = req.body || {};
        const cnpjLimpo = limparCnpj(cnpj);
        if (cnpjLimpo.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
        if (!dadosFiscais || typeof dadosFiscais !== 'object') {
            return res.status(400).json({ error: 'dadosFiscais é obrigatório (objeto)' });
        }

        // PREVENÇÃO (pendências não voltarem): valida UF e CCM ANTES de gravar.
        // UF errada bloqueia captura NFe; CCM fora do padrão quebra NFSe SP.
        const UFS_VALIDAS = new Set([
            'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
            'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
        ]);
        if ('uf' in dadosFiscais && String(dadosFiscais.uf || '').trim() !== '') {
            const ufNorm = String(dadosFiscais.uf).trim().toUpperCase();
            if (!UFS_VALIDAS.has(ufNorm)) {
                return res.status(400).json({ error: `UF inválida: "${dadosFiscais.uf}". Use a sigla de 2 letras (ex.: SP).` });
            }
        }
        if ('ccmSp' in dadosFiscais && String(dadosFiscais.ccmSp || '').trim() !== '') {
            const ccmDigits = String(dadosFiscais.ccmSp).replace(/\D/g, '');
            if (ccmDigits.length < 6 || ccmDigits.length > 11) {
                return res.status(400).json({
                    error: `CCM inválido: "${dadosFiscais.ccmSp}". A Inscrição Municipal de SP tem 8 dígitos (aceito 6-11, só números).`,
                });
            }
        }

        // Monta o update dot-notation só com campos permitidos e definidos.
        const update = {};
        for (const [k, v] of Object.entries(dadosFiscais)) {
            if (!CAMPOS_DADOS_FISCAIS.has(k)) continue;
            let val = typeof v === 'string' ? v.trim() : v;
            if (k === 'uf' && typeof val === 'string') val = val.toUpperCase();
            if (k === 'ccmSp' && typeof val === 'string') val = val.replace(/\D/g, '');
            update[`dadosFiscais.${k}`] = val === '' ? admin.firestore.FieldValue.delete() : val;
        }
        // Espelha ccmSp/uf no top-level (compat com leitura antiga).
        if ('ccmSp' in dadosFiscais) update.ccmSp = update['dadosFiscais.ccmSp'];
        if ('uf' in dadosFiscais) update.uf = update['dadosFiscais.uf'];
        if (Object.keys(update).length === 0) {
            return res.status(400).json({ error: 'Nenhum campo válido para salvar' });
        }
        update.dadosFiscaisAlteradoEm = admin.firestore.FieldValue.serverTimestamp();
        update.dadosFiscaisAlteradoPor = req.user.email;

        const db = fa().firestore();
        const encontrados = await buscarEmpresaDocsPorCnpj(db, cnpjLimpo);
        let atualizadas = 0;
        for (const { doc } of encontrados) {
            await doc.ref.update(update);
            atualizadas++;
        }
        if (!atualizadas) {
            return res.status(404).json({
                error: 'Não localizei esta empresa no cadastro atual.',
                code: 'EMPRESA_NAO_ENCONTRADA', cnpj: cnpjLimpo,
            });
        }
        console.log(`[empresa-dados-fiscais] cnpj=${cnpjLimpo} campos=${Object.keys(update).length} por=${req.user.email}`);
        return res.json({ ok: true, cnpj: cnpjLimpo, atualizadas });
    } catch (e) {
        console.error('[empresa-dados-fiscais] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─── Resetar lock SEFAZ de uma empresa ────────────────────────────────────
// Sync-orchestrator marca lock de 1h por CNPJ pra evitar disparos
// concorrentes. Quando admin precisa testar de novo dentro da janela
// (ex: ajustou procuracao e quer rodar sem esperar a janela vencer),
// esse endpoint apaga o doc sefaz_locks/{cnpj}. Próximo disparo do
// orchestrator vai criar o lock de novo.
router.post('/empresa-reset-lock', requireAuth, express.json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores' });
        }
        const { cnpj } = req.body || {};
        const cnpjLimpo = String(cnpj || '').replace(/\D/g, '');
        if (cnpjLimpo.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });

        const db = fa().firestore();
        const ref = db.collection('sefaz_locks').doc(cnpjLimpo);
        const snap = await ref.get();
        if (!snap.exists) {
            return res.json({ ok: true, cnpj: cnpjLimpo, hadLock: false, msg: 'Empresa já estava sem lock ativo' });
        }
        await ref.delete();
        console.log(`[empresa-reset-lock] cnpj=${cnpjLimpo} por=${req.user.email}`);
        return res.json({ ok: true, cnpj: cnpjLimpo, hadLock: true, msg: 'Lock resetado — próximo disparo recria.' });
    } catch (e) {
        console.error('[empresa-reset-lock] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─── Auto-preencher UF via BrasilAPI ───────────────────────────────────────
// Itera empresas sem dadosFiscais.uf e busca o estado via BrasilAPI a partir
// do CNPJ. Resolve em massa o motivo "UF não cadastrada" sem trabalho manual.
router.post('/auto-preencher-uf', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores' });
        }
        res.json({ ok: true, motivo: 'Auto-preenchimento iniciado em background' });

        setImmediate(async () => {
            const db = fa().firestore();
            const t0 = Date.now();
            let preenchidas = 0, jaTinham = 0, naoEncontradas = 0, erros = 0, total = 0;

            for (const col of ['simples_empresas', 'lucro_empresas']) {
                const snap = await db.collection(col).get();
                for (const doc of snap.docs) {
                    total++;
                    const d = doc.data();
                    const ufAtual = d.dadosFiscais?.uf || d.uf || '';
                    if (ufAtual) { jaTinham++; continue; }
                    const cnpj = (d.cnpj || '').replace(/\D/g, '');
                    if (cnpj.length !== 14) { erros++; continue; }
                    try {
                        const info = await lookupCnpj(cnpj);
                        const uf = info?.uf || null;
                        const municipio = info?.municipio || null;
                        const codMunIBGE = info?.codigo_municipio_ibge || info?.codigo_municipio || null;
                        if (!uf) { naoEncontradas++; continue; }
                        const update = {
                            'dadosFiscais.uf': uf,
                            'dadosFiscais.autoPreenchidoEm': admin.firestore.FieldValue.serverTimestamp(),
                            'dadosFiscais.autoPreenchidoPor': req.user.email,
                        };
                        if (municipio && !d.dadosFiscais?.municipio) update['dadosFiscais.municipio'] = municipio;
                        if (codMunIBGE && !d.dadosFiscais?.codMunIBGE) update['dadosFiscais.codMunIBGE'] = String(codMunIBGE);
                        await doc.ref.update(update);
                        preenchidas++;
                        console.log(`[auto-preencher-uf] ${cnpj} ${d.razaoSocial || d.nome} → uf=${uf} mun=${municipio || '?'}`);
                    } catch (e) {
                        erros++;
                        console.warn(`[auto-preencher-uf] ${cnpj} erro:`, e.message);
                    }
                }
            }

            const duracaoMs = Date.now() - t0;
            await fa().firestore().collection('sefaz_cron_logs').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                tipo: 'auto-preencher-uf',
                total, preenchidas, jaTinham, naoEncontradas, erros,
                duracaoMs,
                fonte: req.user.email,
            });
            console.log(`[auto-preencher-uf] FIM — total=${total} preenchidas=${preenchidas} jaTinham=${jaTinham} naoEncontradas=${naoEncontradas} erros=${erros} (${duracaoMs}ms)`);
        });
    } catch (e) {
        console.error('[auto-preencher-uf] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ── POST /auto-preencher-municipio ──────────────────────────────────────────
// Preenche dadosFiscais.codMunIBGE (+municipio) via BrasilAPI para TODAS as
// empresas sem código de município. Motivação 23/07: a elegibilidade da NFSe
// Nacional cruza com o município (SP capital = portal próprio, fora do ADN),
// mas 368/373 empresas não tinham codMun — o auto-preencher-uf não as tocava
// porque só processa quem está SEM UF. Admin-only; roda em background.
router.post('/auto-preencher-municipio', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores' });
        }
        res.json({ ok: true, motivo: 'Auto-preenchimento de município iniciado em background' });

        setImmediate(async () => {
            const db = fa().firestore();
            const t0 = Date.now();
            let preenchidas = 0, jaTinham = 0, naoEncontradas = 0, erros = 0, total = 0;

            for (const col of ['simples_empresas', 'lucro_empresas']) {
                const snap = await db.collection(col).get();
                for (const doc of snap.docs) {
                    total++;
                    const d = doc.data();
                    if (d._merged_into) continue;
                    const codAtual = String(d.dadosFiscais?.codMunIBGE || d.codMunIBGE || '').replace(/\D/g, '');
                    if (codAtual) { jaTinham++; continue; }
                    const cnpj = (d.cnpj || '').replace(/\D/g, '');
                    if (cnpj.length !== 14) { erros++; continue; }
                    try {
                        const info = await lookupCnpj(cnpj);
                        const codMunIBGE = info?.codigo_municipio_ibge || info?.codigo_municipio || null;
                        const municipio = info?.municipio || null;
                        if (!codMunIBGE) { naoEncontradas++; continue; }
                        const update = {
                            'dadosFiscais.codMunIBGE': String(codMunIBGE),
                            'dadosFiscais.municipioAutoPreenchidoEm': admin.firestore.FieldValue.serverTimestamp(),
                            'dadosFiscais.municipioAutoPreenchidoPor': req.user.email,
                        };
                        if (municipio && !d.dadosFiscais?.municipio) update['dadosFiscais.municipio'] = municipio;
                        await doc.ref.update(update);
                        preenchidas++;
                        console.log(`[auto-preencher-municipio] ${cnpj} ${d.razaoSocial || d.nome} → ${codMunIBGE} (${municipio || '?'})`);
                    } catch (e) {
                        erros++;
                        console.warn(`[auto-preencher-municipio] ${cnpj} erro:`, e.message);
                    }
                    // Gentileza com a BrasilAPI (o cache brasilapi-cache evita
                    // re-consultas; o sleep protege a primeira varredura).
                    await new Promise((r2) => setTimeout(r2, 350));
                }
            }

            const duracaoMs = Date.now() - t0;
            await fa().firestore().collection('sefaz_cron_logs').add({
                executadoEm: admin.firestore.FieldValue.serverTimestamp(),
                tipo: 'auto-preencher-municipio',
                total, preenchidas, jaTinham, naoEncontradas, erros,
                duracaoMs,
                fonte: req.user.email,
            });
            console.log(`[auto-preencher-municipio] FIM — total=${total} preenchidas=${preenchidas} jaTinham=${jaTinham} naoEncontradas=${naoEncontradas} erros=${erros} (${duracaoMs}ms)`);
        });
    } catch (e) {
        console.error('[auto-preencher-municipio] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

export default router;
