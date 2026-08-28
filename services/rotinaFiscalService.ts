/**
 * rotinaFiscalService.ts — a LINHA do mês (Paulo, 28/07/2026).
 *
 * A rotina do departamento tem ordem: captura → validação das notas →
 * apuração → entrega das obrigações → emissão e envio das guias. O app tinha
 * todas as telas, mas nenhuma dizia ONDE cada cliente está. Esta é a leitura
 * do trilho — o backend deriva cada etapa de dado real (nada se marca como
 * feito na mão).
 */
import { getAuth } from 'firebase/auth';

export type StatusEtapa = 'pendente' | 'atencao' | 'concluida' | 'na';

export interface EtapaRotina {
    id: 'captura' | 'validacao' | 'apuracao' | 'obrigacoes' | 'guias';
    ordem: number;
    nome: string;
    onde: string;
    status: StatusEtapa;
    resumo: string;
    acao: string | null;
    /**
     * Extras por etapa (entradas/saidas, resumos, concluidas/total, envios…).
     *
     * Na etapa `obrigacoes` vêm também o PRAZO das que estão abertas —
     * `prazo: { obrigacao, dias, urgencia, dominante } | null`, `atrasadas` e
     * `semData`. A rotina já lia as tarefas e jogava a data fora: sem prazo,
     * "2/5 entregues" não diz se sobra uma semana ou se venceu ontem.
     */
    [k: string]: any;
}

/**
 * ISS de SP capital daquela empresa no mês. `null` fora de SP capital — o ISS
 * de outro município é de outra prefeitura, com outro portal e outro
 * vencimento, e inventar pendência lá seria pior que não mostrar nada.
 */
export interface IssDaRotina {
    situacao: string | null;
    notas: number;
    aRecolher: number;
    /** ISS que existe mas NÃO vira guia por faturamento (dentro do DAS, ou SUP fixo). */
    foraDoTotal: number;
    tomadoRetido: number;
    tomadoNotas: number;
    proprioEnviado: boolean;
    retidoEnviado: boolean;
    pendencias: string[];
}

export interface RotinaEmpresa {
    /**
     * 🔒 O carimbo do fim de mês desta empresa/competência — vem do PAINEL.
     *
     * Ele viaja aqui de propósito: cada card buscando o seu era ~400
     * requisições simultâneas ao abrir a Rotina, e foi o **HTTP 429** de
     * 27/08. `null` = competência aberta.
     */
    fechamento?: import('./fimDeMesService').FechamentoCompetencia | null;
    empresa: { id: string; nome: string; cnpj: string; regime: 'simples' | 'lucro' } | null;
    competencia: string;
    iss: IssDaRotina | null;
    etapas: EtapaRotina[];
    proximoPasso: { id: string; ordem: number; nome: string; onde: string; acao: string | null; resumo: string } | null;
    progresso: { concluidas: number; total: number };
    /**
     * `'fechado'` é FATO (o carimbo do fim de mês); `'ok'` quer dizer **pronto
     * para fechar** desde 26/08 — as cinco etapas fecharam e ninguém deu o ato.
     */
    farol: 'fechado' | 'ok' | 'atencao' | 'pendente';
}

export interface FunilRotina {
    total: number;
    /** Mês FECHADO pelo carimbo — fato, nada a fazer. */
    fechados: number;
    /** As cinco etapas fecharam e falta o clique do "Dar fim de mês". */
    prontos: number;
    /** `fechados + prontos` — quem não tem próximo passo. */
    completos: number;
    etapas: { id: string; ordem: number; nome: string; qtd: number; empresas: string[] }[];
    resumo: string;
}

export interface PainelRotina {
    ok: boolean;
    error?: string;
    competencia?: string;
    escopo?: 'carteira' | 'todas';
    funil?: FunilRotina;
    /** Resumo do ISS de SP capital da seleção. `null` = nenhuma empresa de SP capital. */
    iss?: {
        empresas: number;
        aRecolher: number;
        totalARecolher: number;
        semCcm: number;
        capturaIncerta: number;
        issZerado: number;
        comIssTomado: number;
        totalIssTomado: number;
        issNoDas: number;
        totalIssNoDas: number;
        issFixo: number;
        farol: string;
        avisos: string[];
    } | null;
    issSaudeCaptura?: { farol: string; motivo?: string; acao?: string; zeroConfiavel: boolean } | null;
    /**
     * O que o próprio CATÁLOGO admite não saber — obrigação cujo prazo/regra
     * ninguém confirmou, e obrigação `proposta` que depende de informação que o
     * app não tem (o ISS depende do calendário do MUNICÍPIO; o INSS patronal,
     * da folha). Sem isto o painel diria "N obrigações" sem dizer que M ficaram
     * FORA da conta — e é justamente aí que nasce o "mês fechado" com obrigação
     * nunca listada.
     */
    catalogoPendencias?: Array<{
        obrigacao: string;
        label: string;
        esfera: string;
        abrangencia: string;
        status: string;
        dependeDe: string | null;
        motivo: string;
    }>;
    rotinas?: RotinaEmpresa[];
    lidos?: { documentos: number; tarefas: number; envios: number };
    geradoEm?: string;
}

/**
 * @param empresaIds recorte opcional (a rota já aceita `?empresaIds=` CSV).
 *   Sem ele, o escopo é o do usuário: colaborador vê a própria carteira,
 *   admin vê todas — quem decide é `getEmpresaIdsDaCarteira` no backend.
 */
export async function carregarRotinaFiscal(competencia: string, empresaIds?: string[]): Promise<PainelRotina> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' };
    const token = await u.getIdToken();
    const recorte = empresaIds?.length ? `&empresaIds=${encodeURIComponent(empresaIds.join(','))}` : '';
    const res = await fetch(`/api/admin/rotina-fiscal/painel?competencia=${encodeURIComponent(competencia)}${recorte}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}

/**
 * 📋 DECLARAR QUE AS OBRIGAÇÕES FORA DO CATÁLOGO FORAM ENTREGUES POR FORA.
 *
 * ⚠️ **NENHUMA RÉGUA MORA AQUI.** O piso do texto, a recusa de data no futuro e
 * a exigência do autor vivem no backend (`obrigacao-fora-do-catalogo.js`).
 * Validar na tela criaria a segunda cópia — e ela divergiria no primeiro
 * ajuste da régua.
 */
export async function declararCoberturaForaDoCatalogo(p: {
    empresaId: string; empresaCnpj?: string; competencia: string;
    obrigacoes: string[]; comoFoi: string; quando: string;
}): Promise<{ ok: boolean; error?: string; declaracao?: { texto: string } }> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' };
    const token = await u.getIdToken();
    const res = await fetch('/api/admin/rotina-fiscal/cobertura-declarada', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}
