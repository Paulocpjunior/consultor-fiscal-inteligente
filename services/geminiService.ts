
import { SearchType, type SearchResult, type GroundingSource, type ComparisonResult, type NewsAlert, type SimilarService, type CnaeSuggestion, type SimplesNacionalEmpresa, type SimplesNacionalResumo, CnaeTaxDetail } from '../types';
import { auth } from './firebaseConfig';
import { classificarCfop, ehCfopDeEntrada } from './cfopClassifier';

interface ProxyResponse { text: string; candidates?: any[]; }

async function getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
        const token = await auth?.currentUser?.getIdToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch { /* sem token — servidor decidirá */ }
    return headers;
}

const callProxy = async (prompt: string | any[], options?: { temperature?: number; googleSearch?: boolean; model?: string }): Promise<ProxyResponse> => {
    const headers = await getAuthHeaders();
    if (Array.isArray(prompt)) {
        const textPart = prompt.find((p: any) => p.text)?.text || '';
        const dataPart = prompt.find((p: any) => p.inlineData);
        if (dataPart?.inlineData) {
            const response = await fetch('/api/fiscal/multimodal', {
                method: 'POST', headers,
                body: JSON.stringify({ prompt: textPart, base64Data: dataPart.inlineData.data, mimeType: dataPart.inlineData.mimeType, model: options?.model }),
            });
            if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `Erro ${response.status}`); }
            return await response.json();
        }
    }
    const response = await fetch('/api/fiscal/query', {
        method: 'POST', headers,
        body: JSON.stringify({ prompt: typeof prompt === 'string' ? prompt : JSON.stringify(prompt), model: options?.model, temperature: options?.temperature, googleSearch: options?.googleSearch }),
    });
    if (!response.ok) { const err = await response.json().catch(() => ({})); throw new Error(err.error || `Erro ${response.status}`); }
    return await response.json();
};

const withRetry = async <T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> => {
    let lastError: any;
    for (let i = 0; i < maxRetries; i++) {
        try { return await fn(); } catch (error: any) {
            lastError = error;
            const msg = error?.message || '';
            const isRetryable = msg.includes('503') || msg.includes('429') || msg.includes('500')
                || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota');
            if (isRetryable && i < maxRetries - 1) {
                const baseMs = Math.min(Math.pow(2, i) * 4000, 30000);
                const waitMs = baseMs + Math.random() * 1000;
                console.warn('[Gemini retry] ' + (i+1) + '/' + maxRetries + ' em ' + Math.round(waitMs/1000) + 's');
                await new Promise(r => setTimeout(r, waitMs));
                continue;
            }
            throw error;
        }
    }
    throw lastError;
};

const safeJsonParse = (str: string) => {
    let s = str.trim();
    const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m?.[1]) { s = m[1].trim(); } else {
        const fb = s.indexOf('{'), fk = s.indexOf('['), lb = s.lastIndexOf('}'), lk = s.lastIndexOf(']');
        let si = -1, ei = -1;
        if (fb !== -1 && (fk === -1 || fb < fk)) { si = fb; ei = lb; } else if (fk !== -1) { si = fk; ei = lk; }
        if (si !== -1 && ei > si) s = s.substring(si, ei + 1);
    }
    return JSON.parse(s);
};

const CFOP_CATEGORY_LABEL: Record<string, string> = {
    compra: 'Compra / entrada',
    venda: 'Venda / saída',
    servico_prestado: 'Serviço prestado',
    servico_tomado: 'Serviço tomado',
    devolucao: 'Devolução',
    transferencia: 'Transferência',
    remessa: 'Remessa / retorno',
    outro: 'Outra operação',
};

const CFOP_FONTE_OFICIAL: GroundingSource = {
    web: {
        uri: 'https://www.confaz.fazenda.gov.br/legislacao/ajustes/sinief/copy_of_cfop_cvsn_70_nova',
        title: 'CONFAZ - Tabela CFOP vigente',
    },
};

const CFOP_DESCRICOES: Record<string, string> = {
    '1924': 'Entrada para industrialização por conta e ordem do adquirente da mercadoria, quando esta não transitar pelo estabelecimento do adquirente.',
    '5106': 'Venda de mercadoria adquirida ou recebida de terceiros, que não deva por ele transitar. Classificam-se neste código as vendas de mercadorias adquiridas ou recebidas de terceiros para industrialização ou comercialização, armazenadas em depósito fechado, armazém geral ou outro, que não tenham sido objeto de qualquer processo industrial no estabelecimento sem que haja retorno ao estabelecimento depositante. Também se aplica às vendas de mercadorias importadas cuja saída ocorra do recinto alfandegado ou repartição alfandegária onde se processou o desembaraço aduaneiro, com destino ao comprador, sem transitar pelo estabelecimento do importador.',
};

const SERVICO_LC116_DESCRICOES: Record<string, { descricao: string; grupo: string; observacoes?: string[] }> = {
    '1.01': { descricao: 'Análise e desenvolvimento de sistemas.', grupo: 'Serviços de informática e congêneres' },
    '1.02': { descricao: 'Programação.', grupo: 'Serviços de informática e congêneres' },
    '1.03': { descricao: 'Processamento, armazenamento ou hospedagem de dados, textos, imagens, vídeos, páginas eletrônicas, aplicativos e sistemas de informação.', grupo: 'Serviços de informática e congêneres' },
    '1.04': { descricao: 'Elaboração de programas de computadores, inclusive jogos eletrônicos.', grupo: 'Serviços de informática e congêneres' },
    '1.05': { descricao: 'Licenciamento ou cessão de direito de uso de programas de computação.', grupo: 'Serviços de informática e congêneres' },
    '1.06': { descricao: 'Assessoria e consultoria em informática.', grupo: 'Serviços de informática e congêneres' },
    '1.07': { descricao: 'Suporte técnico em informática, inclusive instalação, configuração e manutenção de programas de computação e bancos de dados.', grupo: 'Serviços de informática e congêneres' },
    '3.05': { descricao: 'Cessão de andaimes, palcos, coberturas e outras estruturas de uso temporário.', grupo: 'Serviços prestados mediante locação, cessão de direito de uso e congêneres' },
    '4.01': {
        descricao: 'Medicina e biomedicina.',
        grupo: 'Serviços de saúde, assistência médica e congêneres',
        observacoes: [
            'Para clínicas, profissionais de saúde e sociedades uniprofissionais, valide inscrição municipal, regime de ISS fixo/SUP e regras locais.',
            'Não confundir item LC 116 com CNAE: o CNAE define enquadramento cadastral; o item de serviço orienta a NFS-e e o ISS.',
        ],
    },
    '4.02': { descricao: 'Análises clínicas, patologia, eletricidade médica, radioterapia, quimioterapia, ultrassonografia, ressonância magnética, radiologia, tomografia e congêneres.', grupo: 'Serviços de saúde, assistência médica e congêneres' },
    '4.03': { descricao: 'Hospitais, clínicas, laboratórios, sanatórios, manicômios, casas de saúde, prontos-socorros, ambulatórios e congêneres.', grupo: 'Serviços de saúde, assistência médica e congêneres' },
    '7.02': { descricao: 'Execução, por administração, empreitada ou subempreitada, de obras de construção civil, hidráulica ou elétrica e congêneres.', grupo: 'Serviços relativos a engenharia, arquitetura, geologia, urbanismo, construção civil e congêneres' },
    '10.05': { descricao: 'Agenciamento, corretagem ou intermediação de bens móveis ou imóveis.', grupo: 'Serviços de intermediação e congêneres' },
    '14.01': { descricao: 'Lubrificação, limpeza, lustração, revisão, carga e recarga, conserto, restauração, blindagem, manutenção e conservação de máquinas, veículos, aparelhos, equipamentos e congêneres.', grupo: 'Serviços relativos a bens de terceiros' },
    '17.01': { descricao: 'Assessoria ou consultoria de qualquer natureza, não contida em outros itens da lista.', grupo: 'Serviços de apoio técnico, administrativo, jurídico, contábil, comercial e congêneres' },
    '17.05': { descricao: 'Fornecimento de mão de obra, mesmo em caráter temporário, inclusive por empregados ou trabalhadores avulsos.', grupo: 'Serviços de apoio técnico, administrativo, jurídico, contábil, comercial e congêneres' },
    '17.19': { descricao: 'Contabilidade, inclusive serviços técnicos e auxiliares.', grupo: 'Serviços de apoio técnico, administrativo, jurídico, contábil, comercial e congêneres' },
};

const SERVICO_GRUPOS: Record<string, string> = {
    '1': 'Serviços de informática e congêneres',
    '3': 'Serviços prestados mediante locação, cessão de direito de uso e congêneres',
    '4': 'Serviços de saúde, assistência médica e congêneres',
    '7': 'Serviços relativos a engenharia, arquitetura, geologia, urbanismo, construção civil e congêneres',
    '10': 'Serviços de intermediação e congêneres',
    '14': 'Serviços relativos a bens de terceiros',
    '17': 'Serviços de apoio técnico, administrativo, jurídico, contábil, comercial e congêneres',
};

function normalizarCodigoServico(query: string): string | null {
    const raw = (query || '').trim();
    if (!raw) return null;
    const explicit = raw.match(/^0?(\d{1,2})\s*[\.,/-]\s*(\d{2})$/);
    if (explicit) {
        const grupo = Number(explicit[1]);
        if (!Number.isInteger(grupo) || grupo < 1 || grupo > 40) return null;
        return `${grupo}.${explicit[2]}`;
    }

    const digits = raw.replace(/\D/g, '');
    if (!/^\d{3,4}$/.test(digits)) return null;
    const grupoDigits = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
    const itemDigits = digits.slice(-2);
    const grupo = Number(grupoDigits);
    if (!Number.isInteger(grupo) || grupo < 1 || grupo > 40) return null;
    return `${grupo}.${itemDigits}`;
}

function consultaCfopLocal(query: string, context?: SearchResult['context']): SearchResult | null {
    const codigo = (query || '').replace(/\D/g, '');
    if (codigo.length !== 4) return null;
    if (!/^[123567]\d{3}$/.test(codigo)) {
        return {
            query,
            timestamp: Date.now(),
            context,
            text: [
                `## CFOP ${codigo}`,
                '',
                '**Status:** código inválido para CFOP.',
                '',
                'CFOP deve ter 4 dígitos e iniciar por 1, 2, 3, 5, 6 ou 7.',
            ].join('\n'),
        };
    }

    const categoria = classificarCfop(codigo) || (ehCfopDeEntrada(codigo) ? 'compra' : 'venda');
    const direcao = ehCfopDeEntrada(codigo) ? 'Entrada' : 'Saída';
    const descricao = CFOP_DESCRICOES[codigo]
        || 'Descrição específica não cadastrada no catálogo local. Use a categoria operacional abaixo como triagem e confirme a descrição oficial na tabela CFOP vigente.';
    const contexto = context && (context.aliquotaIcms || context.aliquotaPisCofins || context.aliquotaIss || context.userNotes)
        ? [
            '',
            '## Contexto informado',
            context.aliquotaIcms ? `- ICMS informado: ${context.aliquotaIcms}%` : '',
            context.aliquotaPisCofins ? `- PIS/COFINS informado: ${context.aliquotaPisCofins}%` : '',
            context.aliquotaIss ? `- ISS informado: ${context.aliquotaIss}%` : '',
            context.userNotes ? `- Observações: ${context.userNotes}` : '',
        ].filter(Boolean).join('\n')
        : '';

    return {
        query,
        timestamp: Date.now(),
        context,
        sources: [CFOP_FONTE_OFICIAL],
        text: [
            `## CFOP ${codigo}`,
            '',
            `**Descrição:** ${descricao}`,
            '',
            `**Direção:** ${direcao}`,
            `**Categoria operacional:** ${CFOP_CATEGORY_LABEL[categoria] || categoria}`,
            '',
            '## Orientação fiscal',
            '- Use este retorno local para triagem imediata quando a IA estiver indisponível.',
            '- Confira CST, finalidade da NF-e, natureza da operação e regra estadual antes de escriturar.',
            '- Em operações de remessa/retorno ou industrialização, valide se há vínculo com nota de origem e se o CFOP está na perspectiva correta do emitente/destinatário.',
            contexto,
        ].filter(Boolean).join('\n'),
    };
}

function consultaServicoLocal(query: string, context?: SearchResult['context'], municipio?: string, alias?: string, regimeTributario?: string): SearchResult | null {
    const codigo = normalizarCodigoServico(query);
    if (!codigo) return null;

    const grupoCodigo = codigo.split('.')[0];
    const item = SERVICO_LC116_DESCRICOES[codigo];
    const grupo = item?.grupo || (grupoCodigo ? SERVICO_GRUPOS[grupoCodigo] : undefined) || 'Grupo LC 116 não classificado no catálogo local';
    const descricao = item?.descricao
        || 'Item válido em formato LC 116/ISS, mas a descrição específica ainda não está cadastrada no catálogo local. Confirme a redação na lista anexa da LC 116/2003 e na tabela municipal.';
    const aliquota = context?.aliquotaIss
        ? `${context.aliquotaIss}% informada no contexto`
        : 'definida pelo município, normalmente dentro do intervalo legal de 2% a 5%';
    const contexto = [
        municipio ? `- Município/prestação informado: ${municipio}` : '',
        alias ? `- Tomador informado: ${alias}` : '',
        regimeTributario ? `- Regime informado: ${regimeTributario}` : '',
        context?.aliquotaIss ? `- ISS informado: ${context.aliquotaIss}%` : '',
        context?.aliquotaPisCofins ? `- PIS/COFINS informado: ${context.aliquotaPisCofins}%` : '',
        context?.userNotes ? `- Observações: ${context.userNotes}` : '',
    ].filter(Boolean);

    return {
        query: codigo,
        timestamp: Date.now(),
        context,
        sources: [
            { web: { uri: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp116.htm', title: 'Lei Complementar nº 116/2003 - lista de serviços' } },
        ],
        text: [
            `## Serviço LC 116/ISS ${codigo}`,
            '',
            `**Descrição:** ${descricao}`,
            `**Grupo:** ${grupo}`,
            '',
            '## Incidência de ISS',
            '- Serviço enquadrado na lista anexa da LC 116/2003, sujeito a ISS quando houver prestação onerosa.',
            `- Alíquota: ${aliquota}. Confirme sempre a lei municipal, código de tributação local e eventual regra de retenção/substituição.`,
            '- Local de recolhimento: regra geral no município do estabelecimento prestador; valide exceções do art. 3º da LC 116/2003 e regras específicas do município.',
            '',
            '## Pontos de atenção',
            '- Informe na NFS-e o item da lista, o código municipal de tributação, município de prestação e retenção do ISS quando aplicável.',
            '- Retenções federais (IRRF, PIS, COFINS, CSLL e INSS) dependem do tipo de tomador, natureza do serviço, valor e regime tributário.',
            '- No Simples Nacional, não presuma anexo apenas pelo item de serviço: avalie CNAE, atividade efetiva, Fator R e regras de ISS retido.',
            ...(item?.observacoes ? ['', '## Observações específicas', ...item.observacoes.map(o => `- ${o}`)] : []),
            ...(contexto.length ? ['', '## Contexto informado', ...contexto] : []),
            '',
            '## Checklist operacional',
            '- Conferir se o código LC 116 bate com a descrição da atividade na NFS-e.',
            '- Validar alíquota/código municipal na prefeitura do prestador.',
            '- Conferir se o tomador exige retenção de ISS e se há responsabilidade tributária local.',
            '- Para saúde/profissionais liberais, verificar tratamento de sociedade uniprofissional/SUP, quando existir no município.',
        ].join('\n'),
    };
}

export const fetchFiscalData = async (type: SearchType, query: string, municipio?: string, alias?: string, responsavel?: string, cnae?: string, regimeTributario?: string, reformaQuery?: string, aliquotaIcms?: string, aliquotaPisCofins?: string, aliquotaIss?: string, userNotes?: string): Promise<SearchResult> => {
    let ctx = [];
    if (municipio) ctx.push(`Município: ${municipio}`); if (alias) ctx.push(`Tomador: ${alias}`);
    if (regimeTributario) ctx.push(`Regime: ${regimeTributario}`); if (aliquotaIcms) ctx.push(`ICMS: ${aliquotaIcms}%`);
    if (aliquotaPisCofins) ctx.push(`PIS/COFINS: ${aliquotaPisCofins}%`); if (aliquotaIss) ctx.push(`ISS: ${aliquotaIss}%`);
    if (userNotes) ctx.push(`Notas: ${userNotes}`);
    const context = { aliquotaIcms, aliquotaPisCofins, aliquotaIss, userNotes };
    if (type === SearchType.CFOP) {
        const local = consultaCfopLocal(query, context);
        if (local) return local;
    }
    if (type === SearchType.SERVICO) {
        const local = consultaServicoLocal(query, context, municipio, alias, regimeTributario);
        if (local) return local;
    }
    const ctxInfo = ctx.length > 0 ? `\nCONSIDERE: ${ctx.join('; ')}.` : '';
    const prompt = `Analise "${query}" no contexto de ${type}.${ctxInfo}\n1. Detalhes tributários, base legal, retenções.\n2. AO FINAL inclua JSON IBPT:\n\`\`\`json\n{"ibpt":{"nacional":0,"importado":0,"estadual":0,"municipal":0}}\n\`\`\``;
    const useSearch = [SearchType.REFORMA_TRIBUTARIA, SearchType.SERVICO, SearchType.CFOP, SearchType.NCM].includes(type);
    try {
        const response = await withRetry(() => callProxy(prompt, { temperature: 0.4, googleSearch: useSearch }));
        let text = response.text || 'Análise indisponível.'; let ibptData;
        const jm = text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (jm?.[1]) { try { const p = JSON.parse(jm[1]); if (p.ibpt) { ibptData = p.ibpt; text = text.replace(jm[0], '').trim(); } } catch {} }
        let sources: GroundingSource[] = [];
        if (response.candidates?.[0]?.groundingMetadata?.groundingChunks) {
            sources = response.candidates[0].groundingMetadata.groundingChunks.filter((c: any) => c.web).map((c: any) => ({ web: { uri: c.web.uri, title: c.web.title } }));
        }
        return { text, sources, query, timestamp: Date.now(), context, ibpt: ibptData };
    } catch (e: any) { throw e; }
};

export const fetchComparison = async (type: SearchType, q1: string, q2: string): Promise<ComparisonResult> => {
    const r = await withRetry(() => callProxy(`Compare ${type}: "${q1}" vs "${q2}".`, { googleSearch: true }));
    return { summary: r.text || 'Indisponível', result1: { text: 'Ver resumo', sources: [], query: q1 }, result2: { text: 'Ver resumo', sources: [], query: q2 } };
};

export const fetchSimilarServices = async (query: string): Promise<SimilarService[]> => {
    try { const r = await withRetry(() => callProxy(`Liste 4 códigos LC 116/03 similares a: "${query}". JSON: [{"code":"X.XX","description":"..."}]`)); return safeJsonParse(r.text || '[]'); } catch { return []; }
};

export const fetchCnaeSuggestions = async (query: string): Promise<CnaeSuggestion[]> => {
    try { const r = await withRetry(() => callProxy(`Sugira 5 CNAEs para: "${query}". JSON: [{"code":"XXXX-X/XX","description":"..."}]`, { googleSearch: true })); return safeJsonParse(r.text || '[]'); } catch { return []; }
};

export const fetchNewsAlerts = async (): Promise<NewsAlert[]> => {
    try {
        const r = await withRetry(() => callProxy(`Liste 3 notícias fiscais Brasil recentes. JSON: [{"title":"...","summary":"..."}]`, { googleSearch: true }));
        const alerts: NewsAlert[] = safeJsonParse(r.text || '[]');
        const urls: string[] = [];
        if (r.candidates?.[0]?.groundingMetadata?.groundingChunks) r.candidates[0].groundingMetadata.groundingChunks.filter((c: any) => c.web?.uri).forEach((c: any) => urls.push(c.web.uri));
        return alerts.map((a, i) => ({ ...a, source: a.source?.startsWith('https://') ? a.source : (urls[i] || urls[0] || '') }));
    } catch { return []; }
};

export const fetchReformaNews = async (): Promise<NewsAlert[]> => {
    try {
        const r = await withRetry(() => callProxy(`Liste 3 notícias Reforma Tributária Brasil (IBS,CBS,IS). JSON: [{"title":"...","summary":"..."}]`, { googleSearch: true }));
        const alerts: NewsAlert[] = safeJsonParse(r.text || '[]');
        const urls: string[] = [];
        if (r.candidates?.[0]?.groundingMetadata?.groundingChunks) r.candidates[0].groundingMetadata.groundingChunks.filter((c: any) => c.web?.uri).forEach((c: any) => urls.push(c.web.uri));
        return alerts.map((a, i) => ({ ...a, source: a.source?.startsWith('https://') ? a.source : (urls[i] || urls[0] || '') }));
    } catch { return []; }
};

export const fetchSimplesNacionalExplanation = async (empresa: SimplesNacionalEmpresa, resumo: SimplesNacionalResumo, question: string): Promise<SearchResult> => {
    const ctx = `Empresa: ${empresa.nome}, CNAE: ${empresa.cnae}, Anexo: ${empresa.anexo}, RBT12: ${resumo.rbt12}, Aliq: ${resumo.aliq_eff}%`;
    const r = await withRetry(() => callProxy(`Contexto: ${ctx}. Pergunta: "${question}"`));
    return { text: r.text || '', query: question, sources: [] };
};

export const fetchCnaeDescription = async (cnae: string): Promise<SearchResult> => {
    const r = await withRetry(() => callProxy(`Analise CNAE ${cnae} para Simples Nacional: Descrição, Anexo, Fator R, Atividades.`, { googleSearch: true }));
    return { text: r.text || '', query: cnae, sources: [] };
};

export const fetchCnaeTaxDetails = async (cnae: string, manualRates?: { icms: string; pisCofins: string; iss: string }): Promise<CnaeTaxDetail[]> => {
    try {
        let p = `CNAE ${cnae} impostos Regime Geral. JSON: [{"tributo":"...","incidencia":"...","aliquotaMedia":"...","baseLegal":"..."}]`;
        if (manualRates) p += `\nAlíquotas: ICMS:${manualRates.icms||'Padrão'}, PIS/COFINS:${manualRates.pisCofins||'Padrão'}, ISS:${manualRates.iss||'Padrão'}`;
        const r = await withRetry(() => callProxy(p, { googleSearch: true })); return safeJsonParse(r.text || '[]');
    } catch { return []; }
};

export const extractDocumentData = async (base64Data: string, mimeType: string = 'application/pdf'): Promise<any[]> => {
    const prompt = `Extraia dados financeiros deste documento. JSON: [{"data":"YYYY-MM-DD","valor":0.00,"descricao":"...","origem":"..."}]`;
    const r = await withRetry(() => callProxy([{ inlineData: { mimeType, data: base64Data } }, { text: prompt }]));
    return safeJsonParse(r.text || '[]');
};

export const extractInvoiceDataFromPdf = async (base64Pdf: string): Promise<any[]> => extractDocumentData(base64Pdf, 'application/pdf');

export const extractNftsDataFromPdf = async (base64Pdf: string): Promise<any> => {
    // FALLBACK do modulo NFTS SP: usado apenas quando o pdfjs nao consegue
    // extrair texto (PDF escaneado). O resultado passa pelas MESMAS
    // validacoes do fluxo deterministico (montarNotaDeGemini).
    const prompt = (
        'Voce e um extrator de dados de NOTA FISCAL DE SERVICO ELETRONICA (NFS-e) brasileira.\n'
        + 'O documento pode ser escaneado. Extraia os dados do PRESTADOR do servico (quem emitiu),\n'
        + 'NUNCA do tomador. Nao invente dados: se um campo nao estiver legivel, retorne null.\n\n'
        + 'Responda APENAS JSON valido no formato:\n'
        + '{"numero":"...","serie":"...","dataEmissao":"DD/MM/AAAA","cnpjPrestador":"14 digitos",\n'
        + '"razaoSocial":"...","valorTotal":"1234,56","itemLc116":"X.XX ou null",\n'
        + '"codigoServicoMunicipal":"4-5 digitos ou null","descricaoServico":"...",\n'
        + '"issRetido":true/false,"simplesNacional":true/false,"mei":true/false,\n'
        + '"email":"... ou null","endereco":{"tipoLogradouro":"RUA/AV/...","logradouro":"...",\n'
        + '"numero":"...","complemento":"...","bairro":"...","cidade":"...","uf":"XX","cep":"8 digitos"}}\n\n'
        + 'issRetido = true SOMENTE se o ISS/ISSQN estiver explicitamente retido pelo tomador\n'
        + '(ignore retencoes de IR, INSS, PIS, COFINS e CSLL).'
    );
    const r = await withRetry(() => callProxy([
        { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
        { text: prompt },
    ]));
    return safeJsonParse(r.text || 'null');
};

export const extractPgdasDataFromPdf = async (base64Pdf: string): Promise<any> => {
    // FALLBACK: usado apenas quando o parser deterministico (pgdasPdfParser)
    // nao consegue extrair. Prompt corrigido (anterior pedia "RBT12" e o
    // Gemini retornava o acumulado de 12m em vez do faturamento mensal).
    try {
        const prompt = (
            'Voce e um extrator de dados estruturados do extrato PGDAS-D 2018 da Receita Federal.\n'
            + 'Localize a secao "2.2) Receitas Brutas Anteriores (R$)" e extraia o FATURAMENTO MENSAL\n'
            + 'INDIVIDUAL de cada mes (NAO o RBT12 acumulado, NAO a receita do ano-calendario).\n'
            + 'Some Mercado Interno (2.2.1) + Mercado Externo (2.2.2) por mes.\n'
            + 'Cada item da tabela tem o formato "MM/AAAA  VALOR" — sao os 13-14 meses anteriores.\n'
            + 'Valores esperados: faturamento mensal individual, geralmente entre R$ 0 e R$ 500.000\n'
            + 'pra empresa do Simples (limite anual R$ 4,8M). Se voce ver valores acima de R$ 1M\n'
            + 'em um unico mes, provavelmente esta lendo o RBT12 acumulado — refaca a extracao.\n\n'
            + 'Responda APENAS JSON valido no formato:\n'
            + '[{"periodo":"MM/AAAA","valor":number}, ...]'
        );
        const r = await withRetry(() => callProxy([
            { inlineData: { mimeType: 'application/pdf', data: base64Pdf } },
            { text: prompt },
        ]));
        return safeJsonParse(r.text || '[]');
    } catch { return []; }
};
