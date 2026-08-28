// ============================================================================
// sefaz-backend/envio-imposto-routes.js  (ESM)
// ----------------------------------------------------------------------------
// Rotas da ORDEM TÉCNICA do envio de imposto (ver envio-imposto.js):
//   POST /api/admin/envio-imposto/registrar — registra um envio feito pelo
//        colaborador (mailto/whatsapp/portal) e executa o rito completo:
//        cópia no SharePoint (pasta IMPOSTOS) + baixa da obrigação + auditoria.
//        O envio via Graph do DAS chama o rito direto no server.js.
//   GET  /api/admin/envio-imposto/historico — auditoria (impostos_enviados).
// ============================================================================

import { Router } from 'express';
import admin from 'firebase-admin';
import { requireAuth } from './require-admin.js';
import { podeAcessarCnpj } from './carteira-auth.js';
import { montarPainelEnvios } from './envio-imposto-painel.js';
// ♻️ Refazer o rito de um envio já registrado — o carimbo é histórico e não
// se move sozinho quando a causa é consertada depois.
import { refazerRitoDoEnvio } from './refazer-rito-store.js';
import { executarRitoEnvioImposto, GESTOR_EMAIL } from './envio-imposto.js';
import { enviarEmail } from './graph-provider.js';
import { montarEmailGuia, anexoLogo } from './email-layout.js';
import { parseDestinatarios } from './email-destinatarios-helper.js';
import { escolherRemetente, dominiosPermitidos, ehErroDeCaixaInexistente } from './graph-remetente.js';
import { enviarTemplateWhatsapp, configWhatsapp, faltasDaConfig } from './whatsapp-cloud.js';
import { resolverTemplate, montarVariaveisPorSchema } from './whatsapp-templates.js';
import { nomeArquivoGuia } from './nome-arquivo-guia.js';
import { conferirDebitosJaEnviados, avisoDeRepeticao } from './debito-ja-enviado.js';
import { formasDaCompetencia } from './competencia.js';
import { conferirDeclaracao, textoDaDeclaracao, CANAL_FORA_DO_APP, MEIOS_FORA_DO_APP } from './envio-fora-do-app.js';

const router = Router();

/** Base64 do PDF sem o prefixo data: e sem quebras. */
function limparPdf(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    return s.replace(/^data:application\/pdf;base64,/i, '').replace(/\s+/g, '');
}

function fa() {
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.applicationDefault() });
    return admin;
}

/**
 * Templates aprovados do departamento FISCAL — a mesma coleção que a rota
 * genérica e o ⚙️ Config Admin usam. Ler daqui é o que garante UM cadastro.
 */
async function lerTemplatesDoFiscal() {
    const snap = await fa().firestore().collection('whatsapp_templates')
        .where('departamento', '==', 'fiscal').get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/**
 * Os meios de envio fora do app — a tela LÊ daqui.
 *
 * Copiar a lista para o frontend criaria a segunda cópia: no dia em que um
 * meio entrar, a tela ofereceria um id que o backend RECUSA.
 */
router.get('/meios-fora-do-app', requireAuth, (_req, res) => {
    return res.json({ ok: true, meios: MEIOS_FORA_DO_APP });
});

router.post('/registrar', requireAuth, async (req, res) => {
    try {
        const {
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            canal, para, pdfBase64, pdfFileName, valor,
        } = req.body || {};
        if (!empresaCnpj || !tipo || !competencia) {
            return res.status(400).json({ ok: false, error: 'empresaCnpj + tipo + competencia são obrigatórios' });
        }
        const acesso = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        // 📋 ENVIO DECLARADO — a guia saiu FORA do app (a AC MASON, 27/08:
        // "as guias já foram enviadas para o cliente" e a etapa 5 travava o
        // fim de mês, porque reenviar pelo app duplicaria a guia no cliente).
        //
        // ⚠️ A DECLARAÇÃO É CONFERIDA AQUI, ANTES de gravar: meio da lista,
        // texto com o piso da T3, data que não está no futuro e AUTOR. Sem o
        // autor a declaração é de ninguém — e é ele que a torna aceitável no
        // lugar da prova do servidor.
        let declaracao = null;
        if (String(canal || '') === CANAL_FORA_DO_APP) {
            const conf = conferirDeclaracao({
                meio: req.body?.meio,
                comoFoi: req.body?.comoFoi,
                quando: req.body?.quando,
                quem: req.user?.email || req.user?.uid || null,
            });
            // 400, nunca 500: declaração incompleta é RESPOSTA, e a frase diz
            // o que falta.
            if (!conf.ok) return res.status(400).json({ ok: false, error: conf.erro });
            declaracao = conf.declaracao;
        }

        const r = await executarRitoEnvioImposto({
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            canal: canal || 'email-app',
            declaracao,
            para: para || null,
            pdfBase64, pdfFileName,
            valor,
            // Campo novo => whitelist da rota NO MESMO PR (lição do #382): sem
            // isto a composição é descartada em silêncio e a trava do próximo
            // envio nunca teria o que comparar.
            debitos: req.body?.debitos,
            reenvioMotivo: req.body?.reenvioMotivo,
            enviadoPor: req.user?.email || req.user?.uid || null,
        });
        console.log(`[envio-imposto] ${tipo} ${empresaCnpj} ${competencia} via ${canal || 'email-app'} por ${req.user?.email} — sp=${r.sharePoint.status} baixa=${r.baixa.status}`);
        return res.json({
            ok: true, gestor: GESTOR_EMAIL, ...r,
            // A frase volta para a tela DIZER que o app não enviou nada — quem
            // declarou precisa ver isso na hora, não só na auditoria.
            declaracao: declaracao ? { ...declaracao, texto: textoDaDeclaracao(declaracao) } : null,
        });
    } catch (e) {
        console.error('[envio-imposto/registrar]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/admin/envio-imposto/enviar-graph
//
// Envio PELO SERVIDOR de qualquer guia (DARF, DARE, …) — o que o DAS já tinha
// e DARF/DARE não. Diferença que importa pra equipe (05/08): aqui o app ENVIA
// (Graph aceita e a cópia fica em Itens Enviados), então existe PROVA; o
// mailto/Outlook Web só abre a composição.
//
// O remetente é a caixa do COLABORADOR que clicou (Paulo, 05/08: o cliente
// respondia ao dono achando que era ele quem mandava). Caixa inexistente no
// tenant não derruba a entrega: refaz pela caixa institucional e o payload DIZ
// que caiu no fallback.
// ────────────────────────────────────────────────────────────────────────────
router.post('/enviar-graph', requireAuth, async (req, res) => {
    try {
        const {
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            para, assunto, mensagem, pdfBase64, pdfFileName, valor, vencimento,
        } = req.body || {};
        // 🚨 GUIA SEPARADA VEM EM MAIS DE UM PDF — e sem isto ela não tinha
        // caminho de envio (Paulo, 17/08: *"então como eu tenho que emitir em
        // guias separadas, a função envio pelo sistema não vai né"* — e não ia).
        //
        // A API do Integra Contador emite 1 DARF por CÓDIGO, então a cobrança de
        // um vencimento pode ter 2-3 arquivos. Um e-mail por guia encheria a
        // caixa do cliente com mensagens quase idênticas para a MESMA cobrança:
        // vão todas juntas, numa mensagem só.
        const anexosExtra = Array.isArray(req.body?.pdfs) ? req.body.pdfs : [];
        if (!empresaCnpj || !tipo || !competencia) {
            return res.status(400).json({ ok: false, error: 'empresaCnpj + tipo + competencia são obrigatórios' });
        }
        if (!para || !String(para).includes('@')) {
            return res.status(400).json({ ok: false, error: 'E-mail do cliente ausente — preencha em Dados Fiscais da empresa.' });
        }
        if (!mensagem) return res.status(400).json({ ok: false, error: 'Mensagem obrigatória.' });

        const acesso = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const pdfLimpo = limparPdf(pdfBase64);
        const pdfsLimpos = anexosExtra
            .map((x) => ({ nome: String(x?.nome || '').trim(), base64: limparPdf(x?.base64) }))
            .filter((x) => x.base64);
        // O limite é do TOTAL: duas guias de 2 MB passariam uma a uma e o Graph
        // recusaria a mensagem inteira.
        const totalBytes = pdfLimpo.length + pdfsLimpos.reduce((t, x) => t + x.base64.length, 0);
        if (totalBytes > 4_000_000) {
            return res.status(413).json({ ok: false, error: 'As guias somam mais de 4 MB — envie em duas mensagens.' });
        }

        const padrao = process.env.GRAPH_REMETENTE || process.env.NOTIF_REMETENTE_EMAIL || 'junior@spassessoriacontabil.com.br';
        const escolha = escolherRemetente({
            emailColaborador: req.user?.email,
            padrao,
            dominios: dominiosPermitidos(),
        });

        const bcc = parseDestinatarios(process.env.DAS_ENVIO_BCC || process.env.DAS_ENVIO_CC, GESTOR_EMAIL)
            .filter((c) => c.toLowerCase() !== String(para).trim().toLowerCase());

        const assuntoFinal = assunto || `${String(tipo).toUpperCase()} ${competencia} — ${empresaNome || ''}`.trim();
        const corpoHtml = montarEmailGuia({
            tipo: String(tipo).toUpperCase(),
            empresaNome, competencia, mensagem,
            temPdf: Boolean(pdfLimpo || pdfsLimpos.length),
            vencimento: vencimento || null,
        });
        const anexos = [
            ...(pdfLimpo ? [{
                name: pdfFileName || nomeArquivoGuia({ tipo, competencia }),
                contentType: 'application/pdf',
                contentBytes: pdfLimpo,
            }] : []),
            ...pdfsLimpos.map((x) => ({
                name: x.nome || nomeArquivoGuia({ tipo, competencia }),
                contentType: 'application/pdf',
                contentBytes: x.base64,
            })),
            ...anexoLogo(),
        ];

        let remetente = escolha.remetente;
        let fonteRemetente = escolha.fonte;
        let avisoRemetente = escolha.motivo;
        let envio = await enviarEmail({ remetente, para, bcc, assunto: assuntoFinal, corpoHtml, anexos });

        if (!envio.ok && fonteRemetente === 'colaborador' && ehErroDeCaixaInexistente(envio.error)) {
            // A caixa do colaborador não existe/não envia — a guia do cliente
            // não pode ficar presa por isso.
            avisoRemetente = `a caixa ${remetente} não pôde enviar; usamos ${padrao}`;
            remetente = padrao;
            fonteRemetente = 'padrao';
            envio = await enviarEmail({ remetente, para, bcc, assunto: assuntoFinal, corpoHtml, anexos });
        }
        if (!envio.ok) return res.status(502).json({ ok: false, error: envio.error || 'Falha ao enviar o e-mail.' });

        const rito = await executarRitoEnvioImposto({
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            canal: 'email-graph',
            para,
            pdfBase64: pdfLimpo || undefined,
            pdfFileName,
            valor,
            debitos: req.body?.debitos,
            reenvioMotivo: req.body?.reenvioMotivo,
            enviadoPor: req.user?.email || req.user?.uid || null,
            copiaPara: bcc,
        });
        console.log(`[envio-imposto/graph] ${tipo} ${empresaCnpj} ${competencia} de ${remetente} (${fonteRemetente}) → ${para}`);
        return res.json({
            ok: true, gestor: GESTOR_EMAIL,
            remetente, fonteRemetente, avisoRemetente,
            copiaPara: bcc, anexouPdf: Boolean(pdfLimpo || pdfsLimpos.length),
            guiasAnexadas: (pdfLimpo ? 1 : 0) + pdfsLimpos.length,
            ...rito,
        });
    } catch (e) {
        console.error('[envio-imposto/enviar-graph]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/admin/envio-imposto/whatsapp-status
//
// O botão da tela pergunta ANTES de mostrar: canal pronto? Se não, a resposta
// lista o que falta — botão que some ensina a equipe que a função não existe.
// ────────────────────────────────────────────────────────────────────────────
router.get('/whatsapp-status', requireAuth, (_req, res) => {
    const faltas = faltasDaConfig(configWhatsapp());
    return res.json({ ok: true, pronto: faltas.length === 0, faltas });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/admin/envio-imposto/enviar-whatsapp
//
// Envio PELO SERVIDOR via WhatsApp OFICIAL (Cloud API, WABA da própria S&P) —
// pedido do Paulo (09/08): mesmo controle do e-mail. A Meta devolve o id da
// mensagem = PROVA de envio (≠ wa.me, que só abre a composição). Depois do
// aceite roda o MESMO rito #293: SharePoint (canal whatsapp-api), baixa da
// obrigação (farol sai do vermelho), auditoria — e o GESTOR é notificado por
// e-mail Graph (WhatsApp não tem BCC; a notificação vai pelo canal que prova).
// ────────────────────────────────────────────────────────────────────────────
router.post('/enviar-whatsapp', requireAuth, async (req, res) => {
    try {
        const {
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            paraWhatsapp, pdfBase64, pdfFileName, valor, vencimento,
        } = req.body || {};
        if (!empresaCnpj || !tipo || !competencia) {
            return res.status(400).json({ ok: false, error: 'empresaCnpj + tipo + competencia são obrigatórios' });
        }
        if (!paraWhatsapp) {
            return res.status(400).json({ ok: false, error: 'WhatsApp do cliente ausente — preencha no cadastro da empresa.' });
        }
        const acesso = await podeAcessarCnpj(req.user, empresaCnpj);
        if (!acesso.ok) return res.status(acesso.status).json({ ok: false, error: acesso.error });

        const pdfLimpo = limparPdf(pdfBase64);
        const nomeArquivo = pdfFileName || nomeArquivoGuia({ tipo, competencia });

        // ── O TEMPLATE VEM DO CADASTRO, NÃO DE UMA LISTA AQUI ───────────────
        //
        // Este fluxo mandava QUATRO variáveis posicionais fixas no código
        // (`[cliente, tipo, competência, vencimento]`), enquanto o cadastro por
        // departamento — que existe desde 10/08, com schema NOMEADO — era usado
        // só pelos apps irmãos. Duas fontes para o mesmo fato.
        //
        // O template aprovado pela Meta em 13/08 tem TRÊS variáveis
        // ({{1}} imposto · {{2}} competência · {{3}} vencimento). Mandar quatro
        // faria a Meta recusar com 132000/132012 ("número de parâmetros não
        // bate") — e o colaborador leria isso como "o WhatsApp não funciona".
        //
        // Agora o SCHEMA decide quantas e em que ordem: variável que o template
        // não pede é ignorada, variável que ele pede e não temos RECUSA o envio
        // nomeando qual falta. Trocar de template deixa de exigir deploy.
        const cadastro = await lerTemplatesDoFiscal();
        const resol = resolverTemplate(cadastro, { departamento: 'fiscal' });
        if (!resol.ok) {
            return res.status(400).json({
                ok: false,
                error: resol.erro,
                acao: 'Cadastre o template aprovado do departamento Fiscal em ⚙️ Config Admin → Templates '
                    + '(nome exato da Meta, idioma, 📎 documento e o significado de cada variável).',
                opcoes: resol.opcoes,
            });
        }
        const template = resol.template;
        // Mesma guarda da rota genérica: template sem cabeçalho de DOCUMENTO
        // não carrega o PDF, e mandar assim é prometer anexo que não vai.
        if (pdfLimpo && !template.temDocumento) {
            return res.status(400).json({
                ok: false,
                error: `O template "${template.nome}" não tem cabeçalho de documento — a guia não seria anexada.`,
                acao: 'Adicione um cabeçalho do tipo DOCUMENTO no Gerenciador do WhatsApp e marque '
                    + '"📎 tem documento" em ⚙️ Config Admin. Enquanto isso, mande a guia por e-mail.',
            });
        }
        const mv = montarVariaveisPorSchema(template, {
            cliente: empresaNome || 'cliente',
            imposto: String(tipo).toUpperCase(),
            // `tipo` é o nome que o fluxo antigo usava — fica como sinônimo pra
            // template já cadastrado com essa chave não quebrar.
            tipo: String(tipo).toUpperCase(),
            competencia,
            vencimento: vencimento || 'no documento',
        });
        if (!mv.ok) {
            return res.status(400).json({
                ok: false,
                error: `O template "${template.nome}" pede variáveis que este envio não tem: ${mv.faltando.join(', ')}.`,
                acao: 'Confira o cadastro em ⚙️ Config Admin — as chaves conhecidas aqui são cliente, imposto, '
                    + 'competencia e vencimento.',
                faltando: mv.faltando,
            });
        }
        const envio = await enviarTemplateWhatsapp({
            para: paraWhatsapp,
            template: template.nome,
            idioma: template.idioma,
            variaveis: mv.variaveis,
            pdfBase64: template.temDocumento ? (pdfLimpo || null) : null,
            nomeArquivo,
        });
        if (!envio.ok) {
            const status = envio.configuracaoIncompleta ? 503 : envio.indeterminado ? 502 : 422;
            return res.status(status).json({ ok: false, error: envio.erro, acao: envio.acao, indeterminado: Boolean(envio.indeterminado) });
        }

        const rito = await executarRitoEnvioImposto({
            empresaId, empresaCnpj, empresaNome, tipo, competencia,
            canal: 'whatsapp-api',
            para: envio.numeroEnviado,
            pdfBase64: pdfLimpo || undefined,
            pdfFileName: nomeArquivo,
            valor,
            debitos: req.body?.debitos,
            reenvioMotivo: req.body?.reenvioMotivo,
            enviadoPor: req.user?.email || req.user?.uid || null,
            whatsappMessageId: envio.messageId,
        });

        // Gestor SEMPRE sabe do envio — por e-mail Graph, o canal que prova.
        let gestorNotificado = false;
        try {
            const padrao = process.env.GRAPH_REMETENTE || process.env.NOTIF_REMETENTE_EMAIL || 'junior@spassessoriacontabil.com.br';
            const corpoHtml = montarEmailGuia({
                tipo: String(tipo).toUpperCase(), empresaNome, competencia,
                mensagem: `Guia enviada ao cliente pelo WHATSAPP OFICIAL (número ${envio.numeroEnviado}, mensagem ${envio.messageId}) por ${req.user?.email || 'colaborador'}. Esta é a cópia de controle do gestor.`,
                temPdf: Boolean(pdfLimpo), vencimento: vencimento || null,
            });
            const n = await enviarEmail({
                remetente: padrao, para: GESTOR_EMAIL,
                assunto: `[WhatsApp] ${String(tipo).toUpperCase()} ${competencia} — ${empresaNome || empresaCnpj}`,
                corpoHtml,
                anexos: pdfLimpo ? [{ name: nomeArquivo, contentType: 'application/pdf', contentBytes: pdfLimpo }] : [],
            });
            gestorNotificado = Boolean(n?.ok);
        } catch { /* a falha da cópia não desfaz o envio — aparece no payload */ }

        console.log(`[envio-imposto/whatsapp] ${tipo} ${empresaCnpj} ${competencia} → ${envio.numeroEnviado} (${envio.messageId}) gestor=${gestorNotificado}`);
        return res.json({
            ok: true, gestor: GESTOR_EMAIL, gestorNotificado,
            whatsappMessageId: envio.messageId, numeroEnviado: envio.numeroEnviado,
            ...rito,
        });
    } catch (e) {
        console.error('[envio-imposto/enviar-whatsapp]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

router.get('/historico', requireAuth, async (req, res) => {
    try {
        const cnpj = String(req.query.cnpj || '').replace(/\D/g, '');
        const limite = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
        const db = fa().firestore();
        let q = db.collection('impostos_enviados');
        if (cnpj) q = q.where('empresaCnpj', '==', cnpj);
        const snap = await q.limit(limite).get();
        const envios = snap.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .sort((a, b) => {
                const ta = a.enviadoEm?.toMillis?.() || 0;
                const tb = b.enviadoEm?.toMillis?.() || 0;
                return tb - ta;
            })
            .map((x) => ({ ...x, enviadoEm: x.enviadoEm?.toDate?.()?.toISOString?.() || null }));
        return res.json({ ok: true, envios });
    } catch (e) {
        console.error('[envio-imposto/historico]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * 🚨 ESTE DÉBITO JÁ FOI ENVIADO NESTA COMPETÊNCIA?
 *
 * Paulo, 17/08, autorizando depois do caso HYPE: *"pode fazer, barrar o segundo
 * envio do mesmo débito"*. O aviso de mistura de departamentos dependia de o
 * outro departamento LEMBRAR — e memória não é trava.
 *
 * O cliente manda a composição da guia que está PRESTES a sair; a rota devolve
 * o que já saiu nesta competência para os MESMOS códigos, com quem enviou,
 * quando e se o canal prova o envio. Quem decide continua sendo a pessoa.
 *
 * ⚠️ CNPJ por igualdade É seguro AQUI (contra a regra geral do projeto): esta
 * coleção é escrita só pelo `envio-imposto.js`, que grava `empresaCnpj` já
 * normalizado em dígitos. A régua de "nunca consultar CNPJ por igualdade" vale
 * para `empresas`, onde o dado tem duas formas.
 */
router.post('/debitos-ja-enviados', requireAuth, async (req, res) => {
    try {
        const cnpj = String(req.body?.cnpj || '').replace(/\D/g, '');
        const competencia = String(req.body?.competencia || '').trim();
        const debitos = Array.isArray(req.body?.debitos) ? req.body.debitos : [];
        if (!cnpj || !competencia) {
            return res.status(400).json({ ok: false, error: 'Informe cnpj e competencia.' });
        }
        if (!(await podeAcessarCnpj(req.user, cnpj))) {
            return res.status(403).json({ ok: false, error: 'Empresa fora da sua carteira.' });
        }
        const db = fa().firestore();
        // 🚨 A GRAVAÇÃO NORMALIZA A COMPETÊNCIA E A CONSULTA PERGUNTAVA PELO
        // TEXTO CRU. Pedindo `07/2026` (ou `202607`), a igualdade achava ZERO
        // envios anteriores, a trava respondia "nunca foi enviado" e a MESMA
        // cobrança saía de novo — que é exatamente o que ela existe para
        // impedir (caso HYPE, 17/08: o 1082 indo em duplicidade).
        //
        // ⚠️ A consulta cobre TODAS as formas em que o registro pode estar
        // gravado, não só a normalizada: envio antigo, anterior à normalização,
        // guarda o texto como veio. Perder ESSE registro é a mesma conta
        // dobrada, um mês mais tarde.
        const formas = formasDaCompetencia(competencia);
        if (!formas.length) {
            // Competência ilegível NÃO vira "nunca foi enviado": isso liberaria
            // a segunda cobrança justamente quando não dá para conferir.
            return res.status(400).json({
                ok: false,
                error: `Competência "${competencia}" não reconhecida — use AAAA-MM (ex.: 2026-07). `
                    + 'Sem ela não dá para conferir se este débito já foi enviado, e seguir sem conferir '
                    + 'é o caminho da cobrança em duplicidade.',
            });
        }
        const snap = await db.collection('impostos_enviados')
            .where('empresaCnpj', '==', cnpj)
            .where('competencia', 'in', formas.slice(0, 10))
            .limit(300)
            .get();
        const enviosAnteriores = snap.docs.map((d) => {
            const x = d.data();
            return {
                id: d.id,
                tipo: x.tipo || null,
                canal: x.canal || null,
                enviadoPor: x.enviadoPor || null,
                enviadoEm: x.enviadoEm?.toDate?.()?.toISOString?.() || null,
                debitos: Array.isArray(x.debitos) ? x.debitos : null,
            };
        });
        const conferencia = conferirDebitosJaEnviados({ debitosDaGuia: debitos, enviosAnteriores });
        return res.json({
            ok: true,
            conferencia,
            aviso: avisoDeRepeticao(conferencia),
            enviosNaCompetencia: enviosAnteriores.length,
        });
    } catch (e) {
        console.error('[envio-imposto/debitos-ja-enviados]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * Painel do rito (#293): quantos envios saíram COMPLETOS na competência e,
 * quando não saíram, a causa agrupada com a ação. Admin — é visão de gestão.
 */
router.get('/painel', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: 'Apenas administradores' });
        const competencia = String(req.query.competencia || '').trim() || null;
        const db = fa().firestore();
        // Sem índice composto: filtra a competência em memória (o volume é de
        // dezenas por mês, não de milhares).
        const snap = await db.collection('impostos_enviados').limit(2000).get();
        const envios = snap.docs.map((d) => {
            const x = d.data();
            return { id: d.id, ...x, enviadoEm: x.enviadoEm?.toDate?.()?.toISOString?.() || null };
        });
        const painel = montarPainelEnvios(envios, { competencia });
        return res.json({ ok: true, gestor: GESTOR_EMAIL, ...painel });
    } catch (e) {
        console.error('[envio-imposto/painel]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

/**
 * ♻️ REFAZER O RITO de envios já registrados.
 *
 * Paulo, 28/08 (VINCENZO GUERRA): *"Já criei a pasta e continua assim, o que eu
 * faço?"*. O status do rito é um CARIMBO HISTÓRICO — consertar a causa depois
 * (cadastrar a pasta, gerar a tarefa, corrigir o tenant do proxy) não o move, e
 * o mês ficava travado para sempre. A única saída oferecida era reenviar a guia
 * ao cliente, o que DUPLICA a cobrança.
 *
 * ⚠️ **LOTE AQUI É SEGURO, e a diferença para "ninguém emite em série" (28/07)
 * é concreta**: aquela regra protege a EMISSÃO, que cria cobrança. Isto não
 * emite nada — arquiva um arquivo que já existe e conclui uma tarefa que já
 * deveria estar concluída, e as duas operações são IDEMPOTENTES. E a causa é
 * coletiva por natureza: "12 empresas sem pasta" é UMA tarefa.
 *
 * ⚠️ Mesmo assim o teto é explícito e a RECUSA diz o número — cortar calado
 * faria "50 refeitos" passar por "os 200 rodaram".
 */
const TETO_REFAZER = 50;

router.post('/refazer-rito', requireAuth, async (req, res) => {
    try {
        if (req.user?.role !== 'admin') return res.status(403).json({ ok: false, error: 'Apenas administradores' });
        const ids = Array.isArray(req.body?.logIds) ? req.body.logIds.map(String).filter(Boolean) : [];
        if (!ids.length) return res.status(400).json({ ok: false, error: 'Informe os envios a refazer (logIds).' });
        if (ids.length > TETO_REFAZER) {
            return res.status(400).json({
                ok: false,
                error: `São ${ids.length} envios e o teto por rodada é ${TETO_REFAZER}. `
                    + 'Rode em partes — cortar aqui faria a tela dizer que todos passaram.',
            });
        }

        const quem = req.user?.email || req.user?.uid || null;
        const resultados = [];
        for (const logId of ids) {
            try {
                resultados.push({ logId, ...(await refazerRitoDoEnvio({ logId, quem })) });
            } catch (e) {
                // Um envio que explode NÃO derruba a rodada — e volta NOMEADO.
                resultados.push({ logId, ok: false, erro: e.message });
            }
        }
        const arquivados = resultados.filter((r) => r.sharePoint?.status === 'arquivado').length;
        const baixados = resultados.filter((r) => ['baixada', 'ja-baixada'].includes(r.baixa?.status)).length;
        const semPdf = resultados.filter((r) => r.pdfIndisponivel).length;
        const falhas = resultados.filter((r) => r.ok === false).length;
        console.log(`[envio-imposto/refazer-rito] ${ids.length} envio(s) por ${quem} — ${arquivados} arquivados, ${baixados} baixados`);
        return res.json({
            ok: true, total: ids.length, arquivados, baixados, semPdf, falhas, resultados,
        });
    } catch (e) {
        console.error('[envio-imposto/refazer-rito]', e);
        return res.status(500).json({ ok: false, error: e.message });
    }
});

export default router;
