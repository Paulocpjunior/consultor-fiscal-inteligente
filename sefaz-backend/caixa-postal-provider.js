// ============================================================================
// sefaz-backend/caixa-postal-provider.js
// Provider abstrato pra Caixa Postal multi-canal.
//
// Canais suportados:
//   - eCAC          (Receita Federal) — SERPRO Integra Contador IC-CXPOSTAL
//   - DET           (Domicílio Eletrônico Trabalhista) — MTE
//   - DEC           (Domicílio Eletrônico do Contribuinte) — SEFAZ estadual
//   - DJE           (Diário de Justiça Eletrônico) — Tribunais
//   - e-MAC         (Ministério da Agricultura) — MAPA
//   - Prefeitura SP (NFS-e e comunicados da Prefeitura de São Paulo)
//
// Suporta 2 modos:
//   - 'mock'   (default): gera mensagens sintéticas pra testar UI
//   - 'serpro' (futuro):  chama Integra Contador SERPRO (IC-CXPOSTAL)
//
// Troca via env var CAIXA_POSTAL_MODE — sem rebuild.
//
// API Integra Contador SERPRO (referencia, ativa quando contratar):
//   POST https://gateway.apiserpro.serpro.gov.br/integra-contador/v1/Consultar
//   Auth: e-CNPJ A1 da SP Contábil + procuração eletrônica eCAC do cliente
//   idSistema: CAIXAPOSTAL
//   idServicos: MSGCONTRIBUINTE51, OBTERINDICADORNOVASMSGS52, OBTERLISTAMSGS53
// ============================================================================

import { invokeIntegraContador } from './serpro-client.js';
import { consultarNfseRecebidas } from './nfse-sp-client.js';

const MODE = process.env.CAIXA_POSTAL_MODE || 'mock';

// ── Mock Templates ─────────────────────────────────────────────────────────

// eCAC (Receita Federal) — templates originais
const MOCK_TEMPLATES_ECAC = [
    {
        categoria: 'intimacao',
        assunto: 'Intimação fiscal — Esclarecimento de divergência',
        remetente: 'Receita Federal do Brasil',
        corpo: 'Prezado contribuinte, foi identificada divergência entre o valor declarado em DCTF e os pagamentos realizados no período de competência {COMP}. Solicitamos esclarecimentos no prazo de 30 dias.',
    },
    {
        categoria: 'malha',
        assunto: 'Sua declaração está em malha fiscal',
        remetente: 'Receita Federal do Brasil',
        corpo: 'A declaração referente ao exercício de 2025 foi retida em malha fiscal por inconsistências nos rendimentos declarados. Acesse o e-CAC para regularização.',
    },
    {
        categoria: 'exclusao',
        assunto: 'Termo de Exclusão do Simples Nacional',
        remetente: 'Receita Federal do Brasil',
        corpo: 'Empresa identificada com débitos pendentes. Caso não regularize a situação no prazo de 30 dias, será excluída do Simples Nacional a partir do próximo exercício.',
    },
    {
        categoria: 'informativo',
        assunto: 'Comunicado — Reforma Tributária 2026',
        remetente: 'Receita Federal do Brasil',
        corpo: 'A LC 224/2025 estabelece nova alíquota de IRPJ presumido a partir de 2026. Verifique impactos no seu regime tributário.',
    },
    {
        categoria: 'informativo',
        assunto: 'Confirmação de transmissão DCTF',
        remetente: 'Receita Federal do Brasil',
        corpo: 'A DCTF referente ao período {COMP} foi recebida com sucesso. Número do recibo: {RECIBO}.',
    },
    {
        categoria: 'malha',
        assunto: 'Pendência identificada — PGDAS-D',
        remetente: 'Receita Federal do Brasil',
        corpo: 'O PGDAS-D do período {COMP} apresenta divergências com os XMLs autorizados. Revisão necessária.',
    },
];

// DET (Domicílio Eletrônico Trabalhista) — MTE
const MOCK_TEMPLATES_DET = [
    {
        categoria: 'det_notificacao',
        assunto: 'Notificação Trabalhista — Irregularidade em registro de empregados',
        remetente: 'Ministério do Trabalho e Emprego',
        corpo: 'Prezado empregador, a Auditoria-Fiscal do Trabalho identificou irregularidade no registro de empregados conforme art. 41 da CLT. Prazo para regularização: 15 dias corridos a partir da ciência desta notificação, nos termos da Portaria MTE nº 671/2021. Protocolo: DET-{RECIBO}.',
        prazo: 15,
    },
    {
        categoria: 'det_auto_infracao',
        assunto: 'Auto de Infração — Descumprimento NR-12 (Segurança no Trabalho)',
        remetente: 'Ministério do Trabalho e Emprego',
        corpo: 'Foi lavrado Auto de Infração nº AI-{RECIBO} por descumprimento da Norma Regulamentadora NR-12 (Segurança no Trabalho com Máquinas e Equipamentos). Fundamentação: art. 157 da CLT c/c art. 75 da Portaria MTE nº 671/2021. O empregador tem 10 dias para apresentar defesa administrativa. Valor da multa: R$ 4.025,33.',
        prazo: 10,
    },
    {
        categoria: 'det_notificacao',
        assunto: 'Convocação para Audiência — Mediação Coletiva',
        remetente: 'Superintendência Regional do Trabalho',
        corpo: 'A empresa está convocada para audiência de mediação coletiva referente à Convenção Coletiva de Trabalho {COMP}, conforme art. 616 da CLT. Data: {DATA_FUTURA}. Local: SRT/MTE. O não comparecimento poderá ensejar instauração de dissídio coletivo (art. 616, §1º, CLT).',
        prazo: 15,
    },
];

// DEC (Domicílio Eletrônico do Contribuinte) — SEFAZ estadual
const MOCK_TEMPLATES_DEC = [
    {
        categoria: 'dec_intimacao',
        assunto: 'Intimação Eletrônica — Divergência ICMS período {COMP}',
        remetente: 'Secretaria da Fazenda do Estado de São Paulo',
        corpo: 'Prezado contribuinte, foi identificada divergência entre os valores de ICMS declarados em GIA/EFD e os documentos fiscais eletrônicos emitidos no período {COMP}. Diferença apurada: R$ 12.847,30. Intimamos V.Sa. a apresentar esclarecimentos no prazo de 30 dias, sob pena de lavratura de AIIM, conforme art. 527 do RICMS/SP (Decreto 45.490/2000).',
        prazo: 30,
    },
    {
        categoria: 'dec_comunicado',
        assunto: 'Comunicado SEFAZ/SP — Nova obrigação acessória DeSTDA',
        remetente: 'Secretaria da Fazenda do Estado de São Paulo',
        corpo: 'Informamos que a Portaria CAT 155/2025 estabelece novas regras para a Declaração de Substituição Tributária, Diferencial de Alíquota e Antecipação (DeSTDA) a partir de {COMP}. Empresas do Simples Nacional com faturamento acima de R$ 3,6 milhões devem se adequar em 60 dias.',
    },
    {
        categoria: 'dec_intimacao',
        assunto: 'Notificação — ICMS-ST não recolhido',
        remetente: 'Secretaria da Fazenda do Estado de São Paulo',
        corpo: 'Constatou-se a falta de recolhimento de ICMS Substituição Tributária referente a operações interestaduais do período {COMP}. Valor principal: R$ 8.932,15. Multa de 50% sobre o valor do imposto (art. 85, I, Lei 6.374/89). Regularize no prazo de 30 dias para usufruir de redução de multa conforme art. 95 da mesma lei.',
        prazo: 30,
    },
];

// DJE (Diário de Justiça Eletrônico) — Tribunais
const MOCK_TEMPLATES_DJE = [
    {
        categoria: 'dje_citacao',
        assunto: 'Citação — Reclamação Trabalhista Proc. {PROCESSO}',
        remetente: 'Tribunal Regional do Trabalho — 2ª Região',
        corpo: 'Fica a empresa citada para comparecer à audiência inicial na Reclamação Trabalhista nº {PROCESSO}, ajuizada por ex-empregado, a realizar-se em {DATA_FUTURA} às 14:00, na {VARA}ª Vara do Trabalho de São Paulo. Apresentar defesa escrita em 20 dias (art. 847 da CLT c/c art. 335 do CPC). Advertência: a ausência importará em revelia e confissão (art. 844 da CLT).',
    },
    {
        categoria: 'dje_intimacao',
        assunto: 'Intimação — Execução Fiscal Proc. {PROCESSO}',
        remetente: 'Tribunal Regional Federal — 3ª Região',
        corpo: 'Intima-se a parte executada para pagamento ou oferecimento de bens à penhora no prazo de 5 dias (art. 8º da Lei 6.830/80), nos autos da Execução Fiscal nº {PROCESSO}, movida pela Fazenda Nacional. Valor atualizado do débito: R$ 47.312,88. O não cumprimento ensejará penhora on-line via SISBAJUD.',
    },
    {
        categoria: 'dje_intimacao',
        assunto: 'Publicação — Acórdão Mandado de Segurança Proc. {PROCESSO}',
        remetente: 'Tribunal de Justiça do Estado de São Paulo',
        corpo: 'Publicação do v. Acórdão proferido pela 13ª Câmara de Direito Público, que NEGOU PROVIMENTO ao recurso de apelação no Mandado de Segurança nº {PROCESSO}, mantendo a exigibilidade do ITCMD sobre doações realizadas no exterior. Prazo para Recurso Especial/Extraordinário: 15 dias (art. 1.003, §5º, CPC).',
    },
];

// e-MAC (Ministério da Agricultura) — MAPA
const MOCK_TEMPLATES_EMAC = [
    {
        categoria: 'emac_notificacao',
        assunto: 'Notificação Sanitária — Pendência registro DIPOA',
        remetente: 'Ministério da Agricultura e Pecuária — MAPA',
        corpo: 'Prezado estabelecimento, informamos que o registro junto ao DIPOA (Departamento de Inspeção de Produtos de Origem Animal) nº SIF-{RECIBO} está com documentação vencida. Regularize o Alvará Sanitário e o PCMSO no prazo de 30 dias, sob pena de suspensão do registro conforme Decreto nº 9.013/2017 (RIISPOA). Protocolo: EMAC-{RECIBO}.',
    },
    {
        categoria: 'emac_notificacao',
        assunto: 'Certificação SISBI — Auditoria programada',
        remetente: 'Ministério da Agricultura e Pecuária — MAPA',
        corpo: 'Comunicamos que seu estabelecimento foi selecionado para auditoria do Sistema Brasileiro de Inspeção de Produtos de Origem Animal (SISBI-POA), conforme IN MAPA nº 29/2020. Data prevista: {DATA_FUTURA}. Mantenha disponível a documentação de rastreabilidade e o Manual de Boas Práticas de Fabricação (BPF).',
    },
];

// Prefeitura SP (NFS-e, ISS e comunicados da Fazenda Municipal)
const MOCK_TEMPLATES_PREFEITURA_SP = [
    {
        categoria: 'prefeitura_sp_nfse',
        assunto: 'Nova NFS-e recebida — Prestador CNPJ {RECIBO}',
        remetente: 'Prefeitura de São Paulo — SF/SUREM',
        corpo: 'Informamos que foi emitida NFS-e de serviço tomado pela sua empresa, referente à competência {COMP}. Número da NFS-e: {RECIBO}. Acesse o portal nfe.prefeitura.sp.gov.br para visualizar o documento fiscal completo e verificar a retenção de ISS na fonte, se aplicável.',
    },
    {
        categoria: 'prefeitura_sp_iss',
        assunto: 'Pendência ISS competência {COMP}',
        remetente: 'Prefeitura de São Paulo — SF/SUREM',
        corpo: 'Prezado contribuinte, identificamos pendência no recolhimento do ISS referente à competência {COMP}. Valor apurado: R$ 2.847,50. Regularize o pagamento através do portal da Nota Fiscal Paulistana (nfe.prefeitura.sp.gov.br) ou via DAS (Simples Nacional), conforme seu regime tributário. Fundamento: Lei Municipal 13.701/2003, art. 14.',
        prazo: 30,
    },
    {
        categoria: 'prefeitura_sp_comunicado',
        assunto: 'Comunicado CAT/Fazenda Municipal — Atualização cadastral CCM',
        remetente: 'Prefeitura de São Paulo — SF/SUREM',
        corpo: 'A Secretaria Municipal da Fazenda comunica que, conforme Instrução Normativa SF/SUREM nº 15/2025, todos os contribuintes com inscrição no CCM (Cadastro de Contribuintes Mobiliários) devem atualizar seus dados cadastrais até {DATA_FUTURA}. A não atualização poderá resultar em suspensão temporária da inscrição municipal.',
    },
];

function hashCnpj(cnpj) {
    let h = 0;
    for (const c of String(cnpj || '')) h = (h * 31 + c.charCodeAt(0)) | 0;
    return Math.abs(h);
}

/**
 * Gera data futura formatada para uso em templates (dd/mm/aaaa).
 */
function _dataFutura(diasAFrente) {
    const d = new Date();
    d.setDate(d.getDate() + diasAFrente);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

/**
 * Gera número de processo judicial fictício no formato CNJ.
 */
function _gerarProcesso(seed, idx) {
    const n = String(seed * 7 + idx * 13).padStart(7, '0').slice(0, 7);
    const d = String((seed + idx) % 100).padStart(2, '0');
    const j = String(5 + (seed % 3));
    const tr = String(2 + (seed % 24)).padStart(2, '0');
    const o = String(1 + ((seed + idx) % 8)).padStart(4, '0');
    return `${n}-${d}.2025.${j}.${tr}.${o}`;
}

// ── Mock Provider ──────────────────────────────────────────────────────────
// Gera mensagens determinísticas baseadas no CNPJ pra testes consistentes.

class MockProvider {
    async listarMensagens(empresaCnpj, opts = {}) {
        return this._gerarMensagensCanal(empresaCnpj, MOCK_TEMPLATES_ECAC, 'ecac');
    }

    async listarMensagensDET(empresaCnpj) {
        return this._gerarMensagensCanal(empresaCnpj, MOCK_TEMPLATES_DET, 'det', 1, 2);
    }

    async listarMensagensDEC(empresaCnpj, uf = 'SP') {
        return this._gerarMensagensCanal(empresaCnpj, MOCK_TEMPLATES_DEC, 'dec', 1, 2);
    }

    async listarMensagensDJE(empresaCnpj) {
        return this._gerarMensagensCanal(empresaCnpj, MOCK_TEMPLATES_DJE, 'dje', 1, 2);
    }

    async listarMensagensEMAC(empresaCnpj) {
        // e-MAC só é relevante pra empresas com CNAE de agricultura/alimentos.
        // No mock, gera 0-1 mensagens (50% chance baseada no CNPJ).
        const seed = hashCnpj(empresaCnpj);
        if (seed % 2 === 0) return []; // 50% das empresas não recebem e-MAC
        return this._gerarMensagensCanal(empresaCnpj, MOCK_TEMPLATES_EMAC, 'emac', 1, 1);
    }

    async listarMensagensPrefeituraSP(empresaCnpj) {
        return this._gerarMensagensCanal(empresaCnpj, MOCK_TEMPLATES_PREFEITURA_SP, 'prefeitura_sp', 1, 3);
    }

    async listarTodasMensagens(empresaCnpj, uf = 'SP') {
        const [ecac, det, dec, dje, emac, prefSp] = await Promise.all([
            this.listarMensagens(empresaCnpj),
            this.listarMensagensDET(empresaCnpj),
            this.listarMensagensDEC(empresaCnpj, uf),
            this.listarMensagensDJE(empresaCnpj),
            this.listarMensagensEMAC(empresaCnpj),
            this.listarMensagensPrefeituraSP(empresaCnpj),
        ]);
        return {
            mensagens: [...ecac, ...det, ...dec, ...dje, ...emac, ...prefSp],
            canais: {
                ecac:          { ok: true, total: ecac.length,  status: 'integrado' },
                det:           { ok: true, total: det.length,   status: 'integrado' },
                dec:           { ok: true, total: dec.length,   status: 'integrado' },
                dje:           { ok: true, total: dje.length,   status: 'integrado' },
                emac:          { ok: true, total: emac.length,  status: 'integrado' },
                prefeitura_sp: { ok: true, total: prefSp.length, status: 'integrado' },
            },
        };
    }

    async marcarComoLida(mensagemId) {
        return { ok: true, mode: 'mock', message: 'Em modo mock: marcação só persiste no Firestore local.' };
    }

    // Gera N mensagens determinísticas a partir de templates de um canal
    _gerarMensagensCanal(empresaCnpj, templates, fonte, minQty, maxQty) {
        const seed = hashCnpj(empresaCnpj);
        const min = minQty ?? 2;
        const max = maxQty ?? 8;
        const range = max - min + 1;
        const qty = min + (seed % range);
        const out = [];
        for (let i = 0; i < qty; i++) {
            const tpl = templates[(seed + i) % templates.length];
            const diasAtras = (seed * (i + 1)) % 90;
            const data = new Date();
            data.setDate(data.getDate() - diasAtras);
            const comp = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
            const recibo = `${seed}${i}${Math.random().toString().slice(2, 8)}`.slice(0, 12);
            const processo = _gerarProcesso(seed, i);
            const vara = 1 + ((seed + i) % 15);
            const dataFutura = _dataFutura(15 + (seed + i) % 30);

            let prazoResposta = null;
            if (tpl.prazo) {
                const prazoDate = new Date(data);
                prazoDate.setDate(prazoDate.getDate() + tpl.prazo);
                prazoResposta = prazoDate.toISOString();
            }

            out.push({
                mensagemId: `MOCK-${fonte.toUpperCase()}-${empresaCnpj}-${i.toString().padStart(4, '0')}`,
                empresaCnpj,
                assunto: tpl.assunto
                    .replace('{COMP}', comp)
                    .replace('{PROCESSO}', processo),
                remetente: tpl.remetente,
                categoria: tpl.categoria,
                corpo: tpl.corpo
                    .replace(/{COMP}/g, comp)
                    .replace(/{RECIBO}/g, recibo)
                    .replace(/{PROCESSO}/g, processo)
                    .replace(/{VARA}/g, String(vara))
                    .replace(/{DATA_FUTURA}/g, dataFutura),
                dataEnvio: data.toISOString(),
                dataLeitura: i < 1 ? null : new Date(data.getTime() + 86400000).toISOString(),
                fonte,
                prazoResposta,
            });
        }
        return out;
    }
}

// ── SERPRO Provider (Integra-CaixaPostal ATIVO) ─────────────────────────────
// idServicos (idSistema=CAIXAPOSTAL):
//   - INNOVAMSG63        (/Consultar) -> indicador rapido tem msg nova
//   - MSGCONTRIBUINTE61  (/Consultar) -> lista paginada
//   - MSGCONTRIBUINTE62  (/Consultar) -> detalhe por isn

function safeJsonParse(s) {
    if (typeof s !== 'string') return s;
    try { return JSON.parse(s); } catch { return s; }
}

class SerproProvider {
    constructor() {}

    async temNovasMensagens(empresaCnpj) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'CAIXAPOSTAL',
            idServico: 'INNOVAMSG63',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: {},
        });
        const d = safeJsonParse(r.dados) || {};
        const ind = d.indicadorNovasMensagens || d.indicador || d.temNovas || '';
        return { temNovas: /^[ST1]/i.test(String(ind)), _raw: d };
    }

    async listarMensagens(empresaCnpj, opts = {}) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const todas = [];
        let ponteiro = '00000000000000';
        let p = 0;
        const MAX = 10;
        while (p < MAX) {
            const r = await invokeIntegraContador({
                idSistema: 'CAIXAPOSTAL',
                idServico: 'MSGCONTRIBUINTE61',
                contribuinteCnpj: cnpj,
                acao: 'Consultar',
                dados: {
                    categoria: '0',
                    statusLeitura: '0',
                    indicadorPagina: p === 0 ? '0' : '1',
                    ponteiroPagina: ponteiro,
                },
            });
            const d = safeJsonParse(r.dados) || {};
            const conteudo = (d.conteudo && d.conteudo[0]) || d;
            const lista = conteudo.listaMensagens || [];
            for (const m of lista) todas.push(this._mapMensagem(m, cnpj, 'ecac'));
            const ultima = String(conteudo.indicadorUltimaPagina || 'S');
            const prox = conteudo.ponteiroProximaPagina;
            if (/^S/i.test(ultima) || !prox || prox === ponteiro) break;
            ponteiro = prox;
            p++;
        }
        return todas;
    }

    // DET — Integra Contador SERPRO (idSistema: 'DET')
    async listarMensagensDET(empresaCnpj) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        try {
            const r = await invokeIntegraContador({
                idSistema: 'DET',
                idServico: 'CONSULTARMENSAGENS',
                contribuinteCnpj: cnpj,
                acao: 'Consultar',
                dados: {},
            });
            const d = safeJsonParse(r.dados) || {};
            const lista = d.listaMensagens || d.mensagens || [];
            return lista.map(m => this._mapMensagem(m, cnpj, 'det'));
        } catch (err) {
            console.warn(`[caixa-postal] DET SERPRO falhou pra ${cnpj}: ${err.message}`);
            return [];
        }
    }

    // DEC — Sem integração SERPRO padrão (cada SEFAZ tem API própria)
    async listarMensagensDEC(empresaCnpj, uf = 'SP') {
        return {
            ok: true,
            mensagens: [],
            fonte: 'dec',
            status: 'nao_integrado',
            motivo: `Integração direta DEC/${uf} pendente — consulte o portal dec.fazenda.${uf.toLowerCase()}.gov.br manualmente`,
        };
    }

    // DJE — Sem integração SERPRO (futuro: TST API, TRF API)
    async listarMensagensDJE(empresaCnpj) {
        return {
            ok: true,
            mensagens: [],
            fonte: 'dje',
            status: 'nao_integrado',
            motivo: 'Integração direta DJE pendente — consulte o Diário de Justiça Eletrônico do tribunal competente manualmente',
        };
    }

    // e-MAC — Sem integração SERPRO (futuro: MAPA sistemasweb)
    async listarMensagensEMAC(empresaCnpj) {
        return {
            ok: true,
            mensagens: [],
            fonte: 'emac',
            status: 'nao_integrado',
            motivo: 'Integração direta e-MAC pendente — consulte sistemasweb.agricultura.gov.br manualmente',
        };
    }

    // Prefeitura SP — Dados reais via nfse-sp-client.js (ConsultaNFeRecebidas)
    async listarMensagensPrefeituraSP(empresaCnpj, ccmSp) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        if (!ccmSp) {
            return {
                ok: true,
                mensagens: [],
                fonte: 'prefeitura_sp',
                status: 'nao_integrado',
                motivo: 'CCM (inscrição municipal SP) não configurado — configure em Cadastro da empresa',
            };
        }
        try {
            const now = new Date();
            const dtFim = { ano: now.getFullYear(), mes: now.getMonth() + 1 };
            // Últimos 3 meses
            const dtInicioDate = new Date(now);
            dtInicioDate.setMonth(dtInicioDate.getMonth() - 3);
            const dtInicio = { ano: dtInicioDate.getFullYear(), mes: dtInicioDate.getMonth() + 1 };

            const result = await consultarNfseRecebidas({
                cnpjRemetente: cnpj,
                inscricaoMunicipalTomador: ccmSp,
                dtInicio,
                dtFim,
            });

            if (!result.sucesso || result.totalNFes === 0) {
                return [];
            }

            // Map NFS-e received into inbox messages
            const mensagens = [];
            for (let i = 0; i < result.totalNFes && i < 20; i++) {
                const nfeXml = result.nfes[i] || '';
                // Extract basic info from the NFe XML
                const numMatch = nfeXml.match(/<NumeroNFe>(\d+)<\/NumeroNFe>/);
                const valorMatch = nfeXml.match(/<ValorServicos>([\d.,]+)<\/ValorServicos>/);
                const dataMatch = nfeXml.match(/<DataEmissao>(\d{4}-\d{2}-\d{2})/);
                const prestadorMatch = nfeXml.match(/<RazaoSocialPrestador>([^<]+)<\/RazaoSocialPrestador>/);

                const numero = numMatch ? numMatch[1] : `${i + 1}`;
                const valor = valorMatch ? valorMatch[1] : '—';
                const dataEmissao = dataMatch ? dataMatch[1] : new Date().toISOString().slice(0, 10);
                const prestador = prestadorMatch ? prestadorMatch[1] : 'Prestador SP';

                mensagens.push({
                    mensagemId: `NFSE-SP-${cnpj}-${numero}`,
                    empresaCnpj: cnpj,
                    assunto: `Nova NFS-e recebida nº ${numero} — ${prestador} (R$ ${valor})`,
                    remetente: 'Prefeitura de São Paulo — SF/SUREM',
                    categoria: 'prefeitura_sp_nfse',
                    corpo: `NFS-e nº ${numero} emitida por ${prestador} em ${dataEmissao}. Valor dos serviços: R$ ${valor}. Verifique a retenção de ISS aplicável no portal nfe.prefeitura.sp.gov.br.`,
                    dataEnvio: `${dataEmissao}T12:00:00-03:00`,
                    dataLeitura: null,
                    fonte: 'prefeitura_sp',
                });
            }
            return mensagens;
        } catch (err) {
            console.warn(`[caixa-postal] Prefeitura SP falhou pra ${cnpj}: ${err.message}`);
            return {
                ok: true,
                mensagens: [],
                fonte: 'prefeitura_sp',
                status: 'erro',
                motivo: `Erro ao consultar NFS-e SP: ${err.message}`,
            };
        }
    }

    async listarTodasMensagens(empresaCnpj, uf = 'SP') {
        const [ecac, det, decResult, djeResult, emacResult, prefSpResult] = await Promise.all([
            this.listarMensagens(empresaCnpj),
            this.listarMensagensDET(empresaCnpj),
            this.listarMensagensDEC(empresaCnpj, uf),
            this.listarMensagensDJE(empresaCnpj),
            this.listarMensagensEMAC(empresaCnpj),
            this.listarMensagensPrefeituraSP(empresaCnpj),
        ]);

        // DEC, DJE, e-MAC, Prefeitura SP retornam objeto { ok, mensagens, ... } quando não integrados
        const decMsgs = Array.isArray(decResult) ? decResult : (decResult.mensagens || []);
        const djeMsgs = Array.isArray(djeResult) ? djeResult : (djeResult.mensagens || []);
        const emacMsgs = Array.isArray(emacResult) ? emacResult : (emacResult.mensagens || []);
        const prefSpMsgs = Array.isArray(prefSpResult) ? prefSpResult : (prefSpResult.mensagens || []);

        return {
            mensagens: [...ecac, ...det, ...decMsgs, ...djeMsgs, ...emacMsgs, ...prefSpMsgs],
            canais: {
                ecac: { ok: true, total: ecac.length, status: 'integrado' },
                det:  { ok: true, total: det.length, status: 'integrado' },
                dec:  Array.isArray(decResult)
                    ? { ok: true, total: decResult.length, status: 'integrado' }
                    : { ok: true, total: 0, status: decResult.status || 'nao_integrado', motivo: decResult.motivo },
                dje:  Array.isArray(djeResult)
                    ? { ok: true, total: djeResult.length, status: 'integrado' }
                    : { ok: true, total: 0, status: djeResult.status || 'nao_integrado', motivo: djeResult.motivo },
                emac: Array.isArray(emacResult)
                    ? { ok: true, total: emacResult.length, status: 'integrado' }
                    : { ok: true, total: 0, status: emacResult.status || 'nao_integrado', motivo: emacResult.motivo },
                prefeitura_sp: Array.isArray(prefSpResult)
                    ? { ok: true, total: prefSpResult.length, status: 'integrado' }
                    : { ok: true, total: 0, status: prefSpResult.status || 'nao_integrado', motivo: prefSpResult.motivo },
            },
        };
    }

    async obterDetalhe(empresaCnpj, isn) {
        const cnpj = String(empresaCnpj).replace(/\D/g, '');
        const r = await invokeIntegraContador({
            idSistema: 'CAIXAPOSTAL',
            idServico: 'MSGCONTRIBUINTE62',
            contribuinteCnpj: cnpj,
            acao: 'Consultar',
            dados: { isn: String(isn) },
        });
        return safeJsonParse(r.dados) || {};
    }

    async marcarComoLida(mensagemId) {
        return { ok: true, mode: 'serpro', message: 'SERPRO nao expoe marcar-lida. Persistencia local.' };
    }

    _mapMensagem(m, cnpj, fonte = 'ecac') {
        const isn = m.isn || m.numeroControle || '';
        const data = m.dataEnvio || '';
        const hora = m.horaEnvio || '';
        let dataIso = new Date().toISOString();
        if (/^\d{8}$/.test(data)) {
            const y = data.slice(0,4), mo = data.slice(4,6), dd = data.slice(6,8);
            const hh = /^\d{6}$/.test(hora) ? hora.slice(0,2) : '00';
            const mm = /^\d{6}$/.test(hora) ? hora.slice(2,4) : '00';
            const ss = /^\d{6}$/.test(hora) ? hora.slice(4,6) : '00';
            dataIso = `${y}-${mo}-${dd}T${hh}:${mm}:${ss}-03:00`;
        }
        let leituraIso = null;
        if (/^\d{8}$/.test(m.dataLeitura || '')) {
            const y = m.dataLeitura.slice(0,4), mo = m.dataLeitura.slice(4,6), dd = m.dataLeitura.slice(6,8);
            leituraIso = `${y}-${mo}-${dd}T00:00:00-03:00`;
        }
        const assunto = String(m.assuntoModelo || m.assunto || '').toLowerCase();

        // Mapeamento de categoria com base na fonte
        let categoria = 'informativo';
        if (fonte === 'det') {
            if (/auto de infra/.test(assunto)) categoria = 'det_auto_infracao';
            else categoria = 'det_notificacao';
        } else if (fonte === 'dec') {
            if (/intima|notifica/.test(assunto)) categoria = 'dec_intimacao';
            else categoria = 'dec_comunicado';
        } else if (fonte === 'dje') {
            if (/cita/.test(assunto)) categoria = 'dje_citacao';
            else categoria = 'dje_intimacao';
        } else if (fonte === 'emac') {
            categoria = 'emac_notificacao';
        } else if (fonte === 'prefeitura_sp') {
            if (/nfs-?e|nota fiscal/i.test(assunto)) categoria = 'prefeitura_sp_nfse';
            else if (/iss|pend[eê]ncia|cobran/i.test(assunto)) categoria = 'prefeitura_sp_iss';
            else categoria = 'prefeitura_sp_comunicado';
        } else {
            // eCAC original
            if (/intima|notifica/.test(assunto)) categoria = 'intimacao';
            else if (/malha|divergencia|inconsistencia/.test(assunto)) categoria = 'malha';
            else if (/exclus|exclud/.test(assunto)) categoria = 'exclusao';
        }

        return {
            mensagemId: String(isn),
            empresaCnpj: cnpj,
            assunto: m.assuntoModelo || m.assunto || '(sem assunto)',
            remetente: m.remetente || 'Receita Federal do Brasil',
            categoria,
            corpo: m.corpo || '',
            dataEnvio: dataIso,
            dataLeitura: leituraIso,
            dataCiencia: /^\d{8}$/.test(m.dataCiencia || '') ? m.dataCiencia : null,
            indicadorLeitura: m.indicadorLeitura || '0',
            numeroControle: m.numeroControle || '',
            fonte,
        };
    }
}

// ── Factory ─────────────────────────────────────────────────────────────────

let providerInstance = null;

export function getCaixaPostalProvider() {
    if (providerInstance) return providerInstance;
    if (MODE === 'serpro') {
        providerInstance = new SerproProvider();
    } else {
        providerInstance = new MockProvider();
    }
    return providerInstance;
}

export function getProviderMode() {
    return MODE;
}

// Lista de canais disponíveis (metadata para UI)
export const CANAIS_DISPONIVEIS = [
    { id: 'ecac', nome: 'e-CAC',  descricao: 'Receita Federal do Brasil',              cor: 'blue',   portal: 'https://cav.receita.fazenda.gov.br' },
    { id: 'det',  nome: 'DET',    descricao: 'Domicílio Eletrônico Trabalhista — MTE',  cor: 'orange', portal: 'https://det.sit.trabalho.gov.br' },
    { id: 'dec',  nome: 'DEC',    descricao: 'Domicílio Eletrônico do Contribuinte',    cor: 'green',  portal: 'https://dec.fazenda.sp.gov.br' },
    { id: 'dje',  nome: 'DJE',    descricao: 'Diário de Justiça Eletrônico',            cor: 'purple', portal: 'https://dje.trt2.jus.br' },
    { id: 'emac', nome: 'e-MAC',  descricao: 'Ministério da Agricultura — MAPA',        cor: 'brown',  portal: 'https://sistemasweb.agricultura.gov.br' },
    { id: 'prefeitura_sp', nome: 'Prefeitura SP', descricao: 'NFS-e e comunicados da Prefeitura de São Paulo', cor: '#1e3a5f', portal: 'https://nfe.prefeitura.sp.gov.br' },
];
