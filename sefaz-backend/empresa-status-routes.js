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
import { caminhoNfseRecomendado, CAMINHO_NFSE } from './municipio-nfse-caminho.js';
import { normalizarCodCliente } from './cod-cliente.js';
import { validarRegimeParaGravacao } from './regime-tributario.js';
import { coberturaAgenteA3, resumirCoberturaA3 } from './captura-a3-cobertura.js';

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
            const dd = doc.data() || {};
            if (dd._merged_into || dd._deleted) return; // zumbis fora
            if (limparCnpj(dd.cnpj) === cnpjLimpo) {
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
        // Arquivadas somem por padrão; ?incluirArquivadas=1 traz de volta (pra
        // desarquivar). Marcador: situacao='arquivada' (setado no soft-delete).
        const incluirArquivadas = String(req.query.incluirArquivadas || '') === '1';
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            snap.forEach(doc => {
                const d = doc.data();
                if (d._merged_into || d._deleted) return; // perdedor de merge / lápide de exclusão
                const cnpj = limparCnpj(d.cnpj);
                if (cnpj.length !== 14) return;
                if (empresasMap.has(cnpj)) return; // dedup
                if (cnpjsSet && !cnpjsSet.has(cnpj)) return; // filtra pela carteira
                const arquivada = d.situacao === 'arquivada';
                if (arquivada && !incluirArquivadas) return; // esconde arquivadas
                empresasMap.set(cnpj, {
                    id: doc.id,
                    cnpj,
                    nome: d.razaoSocial || d.nome || d.fantasia || '—',
                    regime: col === 'simples_empresas' ? 'simples' : 'lucro',
                    arquivada,
                    fonte: col,
                    capturarSefaz: d.capturarSefaz !== false, // default true
                    uf: d.dadosFiscais?.uf || d.uf || '',
                    // Cadastro UNICO: ccmSp em dadosFiscais.ccmSp (canonico, igual
                    // uf/IE). Fallback ao top-level d.ccmSp so pra dado legado.
                    ccmSp: (d.dadosFiscais?.ccmSp || d.ccmSp || '').toString().replace(/\D/g, ''),
                    codMunIBGE: String(d.dadosFiscais?.codMunIBGE || d.codMunIBGE || '').replace(/\D/g, ''),
                    nfseSpAutorizadoEm: toMillis(d.nfseSpAutorizadoEm),
                    nfseNacionalDfeAtivo: d.nfseNacionalDfeAtivo === true,
                    procuracaoEcacAtiva: d.procuracaoEcacAtiva === true,
                    // dadosFiscais completo — semeia o modal "Completar cadastro".
                    // CNAE e data de abertura vivem no top-level (vieram da tela
                    // de criação); entram aqui pro modal mostrar o valor atual
                    // em vez de campo vazio (o merge deixa dadosFiscais vencer).
                    dadosFiscais: {
                        cnae: d.cnae || undefined,
                        dataAbertura: d.dataAbertura || undefined,
                        ...(d.dadosFiscais || {}),
                    },
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
                // 🚨 QUEM escreveu decide o que a data prova. Sem a fonte, uma
                // sync antiga do cron em nuvem passaria por entrega do agente
                // local — e o painel voltaria a afirmar cobertura que ninguém
                // mediu. Campo fora da leitura some da régua.
                ultimaSyncFonte: d.ultimaSyncFonte || null,
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
            // Das A3, quantas o agente local NUNCA entregou documento. É o
            // número que o "✓ Captura OK" escondia — sem ele, o cabeçalho
            // conta certificado e não conta captura.
            a3SemEntrega: 0,
            a3ComEntrega: 0,
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
            const state = stateMap.get(emp.cnpj);
            const temA3Proprio = tipoCert === 'A3' && certUploaded;
            // ⚠️ `temA3Proprio` responde "existe CAMINHO de captura?" — e essa
            // resposta continua sendo sim: o agente local é caminho válido, e
            // por isso ela segue mandando no `capturaNfeOk` e na lista de
            // bloqueios (A3 não é bloqueio). O que ela NUNCA respondeu é
            // "chegou documento por ele?", e era isso que a tela lia como
            // "✓ Captura OK". Duas perguntas, dois donos.
            const coberturaA3 = coberturaAgenteA3({
                tipoCert,
                certUploaded,
                ultimaSyncMs: state?.ultimaSyncMs ?? null,
                ultimaSyncFonte: state?.ultimaSyncFonte ?? null,
            });
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

            // b) NFSe SP (portal da CAPITAL): o app NUNCA assume que a empresa
            // é de SP Capital (caso 4BZ/Jundiaí 24/07 — pedia CCM e marcava o
            // trilho da capital pra empresa de outro município). Aplicabilidade
            // vem do CADASTRO: codMunIBGE == 3550308. Sem codMun, o único
            // indício aceito é o CCM já preenchido (CCM é específico da
            // capital) — senão o trilho simplesmente não se aplica e a NFS-e
            // da empresa vem pelo Padrão Nacional (ADN).
            const recNfse = caminhoNfseRecomendado(emp.codMunIBGE);
            const nfseSpAplicavel = emp.codMunIBGE
                ? recNfse.caminho === CAMINHO_NFSE.SP_PORTAL
                : !!emp.ccmSp;
            let capturaNfseSpOk;
            if (nfseSpAplicavel) {
                capturaNfseSpOk = !!emp.ccmSp && !!emp.nfseSpAutorizadoEm;
                if (!emp.ccmSp) motivosBloqueio.push('NFS-e SP: falta Inscrição Municipal (CCM) nos dados fiscais da empresa.');
                else if (!emp.nfseSpAutorizadoEm) motivosBloqueio.push('NFS-e SP: falta autorizar o escritório no portal nfe.prefeitura.sp.gov.br.');
            } else {
                // Trilho da capital não se aplica — não bloqueia nem pede CCM.
                capturaNfseSpOk = true;
                if (emp.ccmSp && emp.codMunIBGE) {
                    motivosBloqueio.push(
                        `NFS-e SP: o campo CCM está preenchido (${emp.ccmSp}), mas o município do cadastro é `
                        + `${recNfse.nome || emp.codMunIBGE}${recNfse.uf ? '/' + recNfse.uf : ''} — o portal da Prefeitura de SP `
                        + 'não se aplica; a NFS-e desta empresa vem pelo Padrão Nacional (ADN). Se esse número é a inscrição '
                        + 'municipal local, mova para o campo "Inscrição Municipal" em Completar cadastro.'
                    );
                }
            }

            // c) NFSe Nacional ADN: no Cloud Run precisa A1 proprio da mesma
            // raiz CNPJ (ou a propria S&P com cert global). A3 nao entra no
            // cron em nuvem, mas conta como coberto no painel porque depende
            // do agente local A3.
            const nfseNacStatus = classificarCapturaNfseNacionalAdn({
                nfseNacionalDfeAtivo: emp.nfseNacionalDfeAtivo,
                temA1ProprioValido,
                // Filial usando o A1 da matriz (mesma raiz) — o ADN aceita.
                temA1MesmaRaizValido,
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
                // Trilho SP-capital se aplica a esta empresa? (município do
                // cadastro decide; false = NFS-e via ADN, coluna vira "ADN")
                nfseSpAplicavel,
                municipioNfse: recNfse.nome || null,
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
                // 🚨 A empresa A3 não é capturada pelo cron em nuvem: quem a
                // captura é o agente local. O painel dizia "✓ Captura OK" só
                // porque alguém marcou A3 no cadastro — status lido como
                // resultado. Agora ele diz se o agente ENTREGOU, e quando.
                coberturaA3,
            };
            empresas.push(item);

            // Resumo
            resumo.total++;
            if (!emp.uf) resumo.semUf++;
            if (tipoCert === 'A1' || tipoCert === 'A1-raiz') resumo.comCertA1++;
            else if (tipoCert === 'A3') resumo.comCertA3++;
            if (coberturaA3.situacao === 'a3-sem-entrega') resumo.a3SemEntrega++;
            else if (coberturaA3.situacao === 'a3-entregue') resumo.a3ComEntrega++;
            else if (tipoCert === 'escritorio') resumo.usandoCertEscritorio++;
            else resumo.semCertNenhum++;
            if (certVenceEm) {
                const dias = (new Date(certVenceEm).getTime() - agora.getTime()) / 86400000;
                if (dias < 0) resumo.certExpirado++;
                else if (dias < 30) resumo.certVenceEm30d++;
            }
            if (procuracaoInferida) resumo.comProcuracaoEcac++;
            else resumo.semProcuracaoEcac++;
            if (nfseSpAplicavel && capturaNfseSpOk) resumo.ccmSpAutorizado++;
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
    // inscricaoMunicipal = genérica (qualquer município); ccmSp = específico de
    // SP capital (chave da captura NFS-e SP). Campos SEPARADOS de propósito.
    'inscricaoEstadual', 'uf', 'codMunIBGE', 'ccmSp', 'inscricaoMunicipal',
    // 🚨 `gerarInventario` era LIDO pelo bloco H e não existia aqui nem em tela:
    // `inventarioExigido` virava, na prática, "só em dezembro", e quem precisa
    // do inventário em outro mês não tinha como fazer o bloco sair. A ausência
    // de um bloco é silenciosa — o PVA só reclama de quem ESTÁ lá.
    'gerarInventario',
    'logradouro', 'numero',
    // whatsappCliente = número que recebe as guias pelo WhatsApp OFICIAL
    // (Cloud API, 09/08). Separado do telefone de propósito: o contato de
    // ligação nem sempre é o WhatsApp que o cliente quer usar.
    'complemento', 'bairro', 'cep', 'email', 'telefone', 'whatsappCliente', 'perfilEFD', 'indAtividade',
    // CUIDADO com esta whitelist: campo que o modal Dados Fiscais salva e não
    // está aqui é DESCARTADO EM SILÊNCIO neste caminho (o "Completar cadastro"
    // do Status) — o colaborador salva, a tela agradece e nada persiste. Foi o
    // caso de 31/07: CNAE/data de abertura cobrados pela conferência sem lugar
    // pra preencher, e a condição rural (🌾) caindo no chão por aqui.
    'naturezaAtividade', 'inscEstSubstTrib', 'codSuframa',
    'cnae', 'dataAbertura',
    'condicaoRural',
    // Responsável legal + contador (identificação obrigatória dos relatórios,
    // Paulo 01/08). Ficam SÓ em dadosFiscais — nenhum trilho lê top-level.
    'respLegalNome', 'respLegalCpf', 'respLegalCargo',
    'contadorNome', 'contadorCrc', 'contadorCpf',
    'responsaveisLegais', 'contadorId',
    // Código do participante "Consumidor" no E-Fiscal DESTE cliente (Exportar
    // SAGE). Não é código oficial — cada escritório tem o seu, e sem ele TODA
    // NFC-e de balcão fica fora do arquivo. Fica no cadastro pra ser digitado
    // UMA vez, não a cada competência (Paulo, 04/08: "em alguns casos vamos nos
    // deparar com empresas que não colocam o CPF ou CNPJ no cupom fiscal").
    'codigoParticipanteConsumidor',
    // Classificação do estabelecimento industrial (CLAS_ESTAB_IND do registro
    // 0002 do EFD ICMS/IPI). É TABELA OFICIAL e o app NÃO deduz: sem ela o
    // registro não sai e o PVA recusa o arquivo do contribuinte de IPI
    // ("Registro filho obrigatório não foi informado · 0002" — PWR 07/2026).
    // Mesmo desenho do código 9 do ISS fixo: o número mora no cadastro.
    'classEstabIpi', 'contribuinteIpi',
    // Consolidação da receita no 1900 do EFD-Contribuições. Havendo F550 o
    // registro é OBRIGATÓRIO (recusa do PVA na AFFITTARE 07/2026, 24/08), e
    // COD_MOD/COD_SIT são TABELA OFICIAL que depende de qual documento a
    // empresa emite pelo aluguel — o app não deduz. Campo entra na whitelist
    // E no modal no MESMO PR (regra do #382): fora daqui ele é descartado em
    // silêncio e a tela diria "salvo" sem gravar nada.
    'contrib1900CodMod', 'contrib1900CodSit',
    // IND_APRO_CRED do 0110 (não-cumulativo) e a conta contábil da receita
    // financeira do F100 — os dois eram cravados/ausentes e o EFD assinado do
    // CF BANK (24/08) mostrou que são fato DA EMPRESA.
    'indAproCredPisCofins', 'contaContabilReceitaFinanceira',
    // O 0500 exige a conta INTEIRA — nome e nível vêm do plano de contas da
    // empresa. Sem eles o COD_CTA do F100 ficaria órfão (recusa do CF BANK).
    'contaContabilReceitaFinanceiraNome', 'contaContabilReceitaFinanceiraNivel',
    // Natureza da PJ (IND_NAT_PJ, campo 13 do 0000 do EFD-Contribuições). O
    // gerador LIA este campo desde sempre e ele não estava aqui nem na tela:
    // caía no '00' — "sociedade empresária em geral" — em toda empresa,
    // inclusive nas imunes/isentas (varredura de 21/08). Tabela 3.1.3 do
    // leiaute: o número vem do cadastro, o app não deduz.
    'indNatPJ',
    // ICMS a recolher (E116): código de receita ESTADUAL e dia de vencimento.
    // O gerador dizia que os dois eram "sobrescritíveis via dadosFiscais" e
    // eles não estavam aqui nem em tela — a régua caía sempre no default (dia
    // 20, o de SP). O prazo varia por UF e pelo CPR do contribuinte.
    'icmsCodRec', 'icmsDiaVencimento',
    // Regime de apuração de PIS/COFINS quando ele NÃO decorre do regime
    // tributário (o caso '3 — ambos', que a derivação não tem como saber).
    'regimeApuracaoPisCofins',
    // Cod.Cliente — o código da empresa no E-Fiscal (Paulo, 04/08): CHAVE da
    // migração do PG12 (schema e{código} ↔ CNPJ). 4 dígitos com zero à
    // esquerda, 0001–9999, ÚNICO na carteira — validação em cod-cliente.js e
    // recusa de duplicado logo abaixo, antes do update.
    'codCliente',
    // 🆕 REGIME TRIBUTÁRIO E TERCEIRO SETOR (Paulo, 18/08). Sem estes dois aqui,
    // o campo nasceria e NUNCA seria gravado por este caminho — o defeito do
    // #382 na íntegra. São EIXOS SEPARADOS de propósito: "terceiro setor" não é
    // regime, e convive com ele (um templo é imune E sem fins lucrativos).
    'regimeTributario', 'semFinsLucrativos',
]);

// Cadastro (IE, UF, CCM, endereço) é trabalho da EQUIPE — colaborador grava.
// Admin-only aqui travava o "Completar cadastro" da equipe com 403 ("não
// consegue gravar", 27/07): quem detecta a pendência não podia corrigi-la.
// Continuam admin-only as ações destrutivas/estruturais (regime, arquivar,
// excluir, reset de lock, flags de captura). Quem alterou fica registrado em
// dadosFiscaisAlteradoPor.
router.post('/empresa-dados-fiscais', requireAuth, express.json(), async (req, res) => {
    try {
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
            // Só zeros = "não tenho CCM" digitado num campo que parecia
            // obrigatório (26/07: vários cadastros com 000000000) — trata como
            // vazio (apaga) em vez de validar/gravar um CCM fantasma.
            if (/^0*$/.test(ccmDigits)) {
                dadosFiscais.ccmSp = '';
            } else if (ccmDigits.length < 6 || ccmDigits.length > 11) {
                return res.status(400).json({
                    error: `CCM inválido: "${dadosFiscais.ccmSp}". A Inscrição Municipal de SP tem 8 dígitos (aceito 6-11, só números).`,
                });
            }
        }

        // Cod.Cliente: valida a régua (4 dígitos, 0001–9999, zero à esquerda)
        // e recusa DUPLICADO antes de gravar — dois clientes com o mesmo
        // código tornam o confronto CNPJ ↔ schema do E-Fiscal ambíguo, e o
        // erro só apareceria na extração do PG12.
        if ('codCliente' in dadosFiscais) {
            const r = normalizarCodCliente(dadosFiscais.codCliente);
            if (!r.ok) return res.status(400).json({ error: r.erro });
            dadosFiscais.codCliente = r.valor;
            if (r.valor !== '') {
                const db2 = fa().firestore();
                for (const col of ['simples_empresas', 'lucro_empresas']) {
                    const dup = await db2.collection(col)
                        .where('dadosFiscais.codCliente', '==', r.valor).get();
                    for (const d of dup.docs) {
                        const dd = d.data() || {};
                        if (dd._merged_into || dd._deleted) continue;
                        if (limparCnpj(dd.cnpj) === cnpjLimpo) continue;   // a própria empresa
                        return res.status(409).json({
                            error: `Cod.Cliente ${r.valor} já pertence a "${dd.razaoSocial || dd.nome || dd.fantasia || limparCnpj(dd.cnpj)}". `
                                + 'O código do E-Fiscal é único por empresa — confira o cadastro de lá antes de reaproveitar.',
                        });
                    }
                }
            }
        }

        // Monta o update dot-notation só com campos permitidos e definidos.
        const update = {};
        for (const [k, v] of Object.entries(dadosFiscais)) {
            if (!CAMPOS_DADOS_FISCAIS.has(k)) continue;
            // Regime fora do vocabulário é RECUSADO com a lista do que vale, e
            // não descartado calado — quem digitou precisa saber que não colou.
            if (k === 'regimeTributario') {
                const v = validarRegimeParaGravacao(dadosFiscais[k]);
                if (!v.ok) return res.status(400).json({ error: 'REGIME_INVALIDO', message: v.motivo });
                dadosFiscais[k] = v.regime;
            }
            let val = typeof v === 'string' ? v.trim() : v;
            if (k === 'uf' && typeof val === 'string') val = val.toUpperCase();
            if (k === 'ccmSp' && typeof val === 'string') val = val.replace(/\D/g, '');
            // Condição rural (🌾 DIPAM/FUNRURAL): objeto com forma fixa — grava
            // só as chaves conhecidas, booleano explícito (desmarcar = false).
            if (k === 'condicaoRural') {
                if (val == null || typeof val !== 'object') continue;
                val = {
                    adquireDeProdutor: !!val.adquireDeProdutor,
                    ehProdutorRuralPF: !!val.ehProdutorRuralPF,
                    ehCooperativa: !!val.ehCooperativa,
                    funruralSubRogacao: val.funruralSubRogacao === 'nao_aplica' ? 'nao_aplica' : 'automatico',
                    observacao: String(val.observacao || '').trim(),
                };
            }
            update[`dadosFiscais.${k}`] = val === '' ? admin.firestore.FieldValue.delete() : val;
        }
        // Espelha ccmSp/uf no top-level (compat com leitura antiga).
        if ('ccmSp' in dadosFiscais) update.ccmSp = update['dadosFiscais.ccmSp'];
        if ('uf' in dadosFiscais) update.uf = update['dadosFiscais.uf'];
        // CNAE e data de abertura vivem no TOP-LEVEL desde a criação da empresa
        // (é de lá que apuração/DAS e a conferência leem) — o modal só passou a
        // editá-los; espelha pros dois lugares ficarem iguais.
        if ('cnae' in dadosFiscais) update.cnae = update['dadosFiscais.cnae'];
        if ('dataAbertura' in dadosFiscais) update.dataAbertura = update['dadosFiscais.dataAbertura'];
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

// ─── Carga em massa do Cod.Cliente (Listagem de Empresas do E-Fiscal) ──────
// Paulo, 05/08: exportou o "Cadastro de Empresas" do E-Fiscal (1.767 fichas,
// HTML/XFRX). O front parseia o arquivo e manda {codigo, cnpj} — aqui o
// confronto é por CNPJ e a régua é a mesma da gravação unitária:
// normalizarCodCliente + nunca sobrescrever código divergente em silêncio.
// Admin-only: uma carga errada renomeia a carteira inteira.
router.post('/importar-cod-cliente', requireAuth, express.json({ limit: '4mb' }), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores fazem a carga em massa.' });
        }
        const itens = Array.isArray(req.body?.empresas) ? req.body.empresas : [];
        if (itens.length === 0) return res.status(400).json({ error: 'Informe `empresas` [{codigo, cnpj}].' });
        if (itens.length > 5000) return res.status(400).json({ error: 'Máximo de 5.000 itens por carga.' });

        const db = fa().firestore();
        // Uma leitura das duas coleções serve a carga toda (≈ centenas de docs).
        const porCnpj = new Map();          // cnpj → [{col, ref, codAtual, nome}]
        const codigoEmUso = new Map();      // codCliente já gravado → cnpj dono
        for (const col of ['simples_empresas', 'lucro_empresas']) {
            const snap = await db.collection(col).get();
            snap.forEach((d) => {
                const dd = d.data() || {};
                if (dd._merged_into || dd._deleted) return;
                const cnpj = limparCnpj(dd.cnpj);
                if (cnpj.length !== 14) return;
                if (!porCnpj.has(cnpj)) porCnpj.set(cnpj, []);
                porCnpj.get(cnpj).push({
                    ref: d.ref,
                    codAtual: String(dd.dadosFiscais?.codCliente || ''),
                    nome: dd.razaoSocial || dd.nome || dd.fantasia || cnpj,
                });
                const cod = String(dd.dadosFiscais?.codCliente || '');
                if (cod) codigoEmUso.set(cod, cnpj);
            });
        }

        let gravadas = 0, jaIguais = 0, invalidos = 0;
        const naoEncontradas = [];
        const divergentes = [];
        const codigoOcupado = [];
        for (const item of itens) {
            const r = normalizarCodCliente(item?.codigo);
            const cnpj = limparCnpj(item?.cnpj);
            if (!r.ok || r.valor === '' || cnpj.length !== 14) { invalidos++; continue; }
            const docs = porCnpj.get(cnpj);
            if (!docs) {
                // Esperado aos montes: o E-Fiscal guarda 20 anos de carteira,
                // o CFI só as ativas. Não é erro — fica no relatório.
                naoEncontradas.push({ codigo: r.valor, cnpj });
                continue;
            }
            const donoDoCodigo = codigoEmUso.get(r.valor);
            if (donoDoCodigo && donoDoCodigo !== cnpj) {
                codigoOcupado.push({ codigo: r.valor, cnpj, ocupadoPor: donoDoCodigo });
                continue;
            }
            let mudouAlgum = false;
            for (const doc of docs) {
                if (doc.codAtual === r.valor) continue;
                if (doc.codAtual && doc.codAtual !== r.valor) {
                    divergentes.push({ cnpj, nome: doc.nome, salvo: doc.codAtual, arquivo: r.valor });
                    continue;
                }
                await doc.ref.update({
                    'dadosFiscais.codCliente': r.valor,
                    dadosFiscaisAlteradoEm: admin.firestore.FieldValue.serverTimestamp(),
                    dadosFiscaisAlteradoPor: `${req.user.email} (carga E-Fiscal)`,
                });
                doc.codAtual = r.valor;
                mudouAlgum = true;
            }
            if (mudouAlgum) { gravadas++; codigoEmUso.set(r.valor, cnpj); }
            else if (docs.every((d) => d.codAtual === r.valor)) jaIguais++;
        }

        console.log(`[importar-cod-cliente] itens=${itens.length} gravadas=${gravadas} por=${req.user.email}`);
        return res.json({
            ok: true,
            recebidas: itens.length,
            gravadas,
            jaIguais,
            invalidos,
            naoEncontradas: naoEncontradas.length,
            divergentes,
            codigoOcupado,
            mensagem: `${gravadas} empresa(s) receberam o Cod.Cliente; ${jaIguais} já estavam iguais; `
                + `${naoEncontradas.length} do arquivo não existem no CFI (carteira antiga do E-Fiscal — normal)`
                + (divergentes.length ? `; ⚠ ${divergentes.length} divergem do já salvo e NÃO foram alteradas` : '')
                + (codigoOcupado.length ? `; ⚠ ${codigoOcupado.length} código(s) já em uso por outro CNPJ` : '') + '.',
        });
    } catch (e) {
        console.error('[importar-cod-cliente] erro:', e);
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

// ─── Corrigir REGIME (mover Simples ⇄ Lucro) ──────────────────────────────
// No CFI o regime É a coleção: simples_empresas x lucro_empresas — é ela que
// decide qual pipeline fiscal (DAS, DCTFWeb, IPI, SPED…) processa a empresa.
// Cadastrar no regime errado joga a empresa no pipeline errado. Aqui a gente
// MOVE o doc pra coleção certa PRESERVANDO O MESMO id — os documentos, certs e
// sefaz_state referenciam a empresa pelo empresaId (id do doc) e os lookups já
// caem de simples/{id} → lucro/{id}, então nada quebra. Admin-only.
const COLECAO_POR_REGIME = { simples: 'simples_empresas', lucro: 'lucro_empresas' };
router.post('/empresa-corrigir-regime', requireAuth, express.json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores' });
        }
        const { cnpj, regimeNovo } = req.body || {};
        const cnpjLimpo = limparCnpj(cnpj);
        if (cnpjLimpo.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
        const alvo = COLECAO_POR_REGIME[String(regimeNovo || '').toLowerCase()];
        if (!alvo) {
            return res.status(400).json({ error: "regimeNovo deve ser 'simples' ou 'lucro'." });
        }

        const db = fa().firestore();
        const encontrados = await buscarEmpresaDocsPorCnpj(db, cnpjLimpo);
        if (!encontrados.length) {
            return res.status(404).json({ error: 'Empresa não encontrada no cadastro.', code: 'EMPRESA_NAO_ENCONTRADA' });
        }
        // Já está toda no regime alvo? (nenhum doc fora da coleção alvo)
        const foraDoAlvo = encontrados.filter(({ col }) => col !== alvo);
        if (!foraDoAlvo.length) {
            return res.json({ ok: true, cnpj: cnpjLimpo, movidas: 0, msg: `Empresa já está em ${regimeNovo}.` });
        }

        let movidas = 0;
        for (const { doc } of foraDoAlvo) {
            const data = doc.data() || {};
            // MESMO id na coleção alvo — mantém os vínculos por empresaId.
            const batch = db.batch();
            batch.set(db.collection(alvo).doc(doc.id), {
                ...data,
                regimeCorrigidoEm: admin.firestore.FieldValue.serverTimestamp(),
                regimeCorrigidoPor: req.user.email,
                regimeCorrigidoDe: doc.ref.parent.id,
            });
            batch.delete(doc.ref);
            await batch.commit();
            movidas++;
        }
        console.log(`[empresa-corrigir-regime] cnpj=${cnpjLimpo} -> ${alvo} movidas=${movidas} por=${req.user.email}`);
        return res.json({ ok: true, cnpj: cnpjLimpo, movidas, regimeNovo, msg: `Movida para ${regimeNovo}. O pipeline correto passa a processar a empresa.` });
    } catch (e) {
        console.error('[empresa-corrigir-regime] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─── Arquivar / desarquivar empresa (soft, reversível) ─────────────────────
// Cadastro errado ou empresa que saiu da carteira: em vez de apagar (e perder
// os documentos capturados), marca situacao='arquivada'/ativo=false. Some das
// listas e capturas, mas os dados ficam e dá pra desarquivar. Admin-only.
router.post('/empresa-arquivar', requireAuth, express.json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores' });
        }
        const { cnpj, desarquivar } = req.body || {};
        const cnpjLimpo = limparCnpj(cnpj);
        if (cnpjLimpo.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });

        const db = fa().firestore();
        const encontrados = await buscarEmpresaDocsPorCnpj(db, cnpjLimpo);
        if (!encontrados.length) {
            return res.status(404).json({ error: 'Empresa não encontrada no cadastro.', code: 'EMPRESA_NAO_ENCONTRADA' });
        }
        // capturarSefaz é o gate que o cron de NFe já respeita — desligar aqui
        // faz a empresa arquivada parar de ser capturada sem espalhar checagem
        // de 'situacao' por todos os crons. Desarquivar religa.
        const update = desarquivar
            ? {
                situacao: admin.firestore.FieldValue.delete(),
                ativo: true,
                capturarSefaz: true,
                arquivadaEm: admin.firestore.FieldValue.delete(),
                arquivadaPor: admin.firestore.FieldValue.delete(),
            }
            : {
                situacao: 'arquivada',
                ativo: false,
                capturarSefaz: false,
                arquivadaEm: admin.firestore.FieldValue.serverTimestamp(),
                arquivadaPor: req.user.email,
            };
        for (const { doc } of encontrados) await doc.ref.update(update);
        console.log(`[empresa-arquivar] cnpj=${cnpjLimpo} desarquivar=${!!desarquivar} docs=${encontrados.length} por=${req.user.email}`);
        return res.json({
            ok: true, cnpj: cnpjLimpo, atualizadas: encontrados.length,
            msg: desarquivar ? 'Empresa desarquivada.' : 'Empresa arquivada (reversível).',
        });
    } catch (e) {
        console.error('[empresa-arquivar] erro:', e);
        return res.status(500).json({ error: e.message });
    }
});

// ─── Excluir empresa DEFINITIVO (só se não tiver documentos) ───────────────
// Cadastro-lixo (empresa errada, zero notas): apaga o doc de vez. Trava de
// segurança: se houver QUALQUER documento_fiscal vinculado (por empresaId ou
// cnpj), recusa e manda arquivar — pra nunca apagar histórico por engano.
router.post('/empresa-excluir', requireAuth, express.json(), async (req, res) => {
    try {
        if (req.user?.role !== 'admin') {
            return res.status(403).json({ error: 'Apenas administradores' });
        }
        const { cnpj, confirmar } = req.body || {};
        const cnpjLimpo = limparCnpj(cnpj);
        if (cnpjLimpo.length !== 14) return res.status(400).json({ error: 'CNPJ inválido' });
        if (confirmar !== true) {
            return res.status(400).json({ error: 'Exclusão definitiva exige confirmar=true.' });
        }

        const db = fa().firestore();
        const encontrados = await buscarEmpresaDocsPorCnpj(db, cnpjLimpo);
        if (!encontrados.length) {
            return res.status(404).json({ error: 'Empresa não encontrada no cadastro.', code: 'EMPRESA_NAO_ENCONTRADA' });
        }

        // Trava: conta documentos_fiscais vinculados (por empresaId E por cnpj).
        const idsEmpresa = encontrados.map(({ doc }) => doc.id);
        let totalDocs = 0;
        for (const id of idsEmpresa) {
            const c = await db.collection('documentos_fiscais').where('empresaId', '==', id).count().get();
            totalDocs += c.data().count;
        }
        for (const campo of ['empresaCnpj', 'cnpjEmit', 'cnpjDest']) {
            const c = await db.collection('documentos_fiscais').where(campo, '==', cnpjLimpo).count().get();
            totalDocs += c.data().count;
        }
        if (totalDocs > 0) {
            return res.status(409).json({
                error: `Empresa tem ${totalDocs} documento(s) capturado(s) — não pode ser excluída definitivamente. Use "Arquivar" para preservar o histórico.`,
                code: 'TEM_DOCUMENTOS', totalDocs,
            });
        }

        for (const { doc } of encontrados) await doc.ref.delete();
        console.log(`[empresa-excluir] cnpj=${cnpjLimpo} docs_apagados=${encontrados.length} por=${req.user.email}`);
        return res.json({ ok: true, cnpj: cnpjLimpo, excluidas: encontrados.length, msg: 'Empresa excluída definitivamente (não tinha documentos).' });
    } catch (e) {
        console.error('[empresa-excluir] erro:', e);
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
                    if (d._merged_into || d._deleted) continue;
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
                    if (d._merged_into || d._deleted) continue;
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
