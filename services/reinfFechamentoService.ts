/**
 * reinfFechamentoService.ts — porta do RITO DE FECHAMENTO da EFD-Reinf.
 *
 * Paulo, 13/08, com o recibo do R-2099 da VINCENZO na mão: *"vc pode mandar por
 * email somente o que foi enviado e seu status, salvar pode salvar no
 * sharepoint"*.
 *
 * Aqui é só I/O. A régua mora em `sefaz-backend/reinf-recibo-entrega.js`
 * (extrato, farol, e-mail) e em `reinf-aquisicao-rural.js` (conferência do
 * totalizador) — reimplementar qualquer uma delas nesta tela faria a conferência
 * prometer um número diferente do que o backend arquiva e manda ao gestor.
 */

import { getAuth } from 'firebase/auth';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

export interface EntregaReinf {
    /** Código do evento (R-2055…) ou o rótulo cru quando o app não sabe. */
    evento: string;
    /** O id do evento — é por ele que se acha a linha no e-CAC. */
    tipo?: string | null;
    protocolo?: string | null;
    recibo?: string | null;
    transmitidoEm?: string | null;
    tpAmb?: number | null;
    elementoIncerto?: boolean;
    ocorrencias?: Array<{ codigo?: string; descricao?: string }>;
}

export interface PrepararFechamento {
    empresa: { empresaId?: string; nome?: string; cnpj: string };
    competencia: string;
    apurado: { base: number; inss: number; gilrat: number; senar: number; total: number };
    entregas: EntregaReinf[];
    lotesSemCompetencia: number;
    /**
     * Onde o recibo será arquivado — e, quando não houver onde, POR QUÊ.
     *
     * ⚠️ O booleano antigo (`temPastaSharePoint`) lia o cadastro do caminho
     * MORTO e mandava preencher "grupo + pasta", que hoje não resolve nada.
     * O `motivo` vem do dono (`sharepoint-pastas.js`) e traz a ação certa de
     * cada causa — sem Cod.Cliente, pasta duplicada ou pasta inexistente.
     */
    pastaSharePoint: { ok: boolean; pasta: string | null; motivo: string | null; codCliente: string };
    /**
     * Códigos de receita do FUNRURAL, vindos do BACKEND de propósito.
     *
     * Eles saíram do recibo do R-2099 aceito (VINCENZO 07/2026) e moram em
     * `sefaz-backend/reinf-aquisicao-rural.js`. Escrevê-los nesta tela seria a
     * segunda cópia da tabela — e cópia de de-para de código de receita manda a
     * contribuição para o tributo errado, com o erro aparecendo só na cobrança.
     */
    codigosFunrural: Record<string, string>;
}

export interface LinhaExtrato {
    evento: string;
    tipo: string | null;
    recibo: string | null;
    protocolo: string | null;
    transmitidoEm: string | null;
    situacao: 'entregue' | 'recusado' | 'sem-recibo';
    detalhe: string;
}

export interface ExtratoFechamento {
    competencia: string | null;
    competenciaHumana: string;
    empresa: { nome: string | null; cnpj: string | null };
    fechamento: { recibo: string | null; processadoEm: string | null } | null;
    linhas: LinhaExtrato[];
    resumo: { total: number; entregues: number; recusados: number; semRecibo: number };
    conferencia: {
        situacao: 'confere' | 'divergente' | 'nao-conferido';
        linhas: Array<{
            componente: string; rotulo: string; codigoReceita: string;
            apurado: number; totalizado: number | null; confere: boolean; diferenca: number | null;
        }>;
        codigosDesconhecidos: Array<{ codigoReceita: string; valor: number }>;
        resumo: string;
    } | null;
    farol: { cor: 'ok' | 'atencao' | 'falha'; resumo: string };
}

export interface RespostaFechamento {
    extrato: ExtratoFechamento;
    sharePoint: { status: string; pasta?: string; arquivados?: string[]; motivo?: string };
    email: { status: string; remetente?: string; fonteRemetente?: string; gestorEmCopia?: string; motivo?: string };
}

/** O que o app já sabe da competência — eventos transmitidos e o apurado. */
export async function prepararFechamentoReinf(cnpj: string, competencia: string): Promise<PrepararFechamento> {
    const r = await fetch(
        `/api/admin/reinf/fechamento-competencia/preparar?cnpj=${encodeURIComponent(cnpj)}&competencia=${encodeURIComponent(competencia)}`,
        { headers: await authHeader() },
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `Falha ao preparar o fechamento (HTTP ${r.status})`);
    return j as PrepararFechamento;
}

/** Fecha: confere, arquiva no SharePoint e avisa o gestor. Nesta ordem. */
export async function fecharCompetenciaReinf(p: {
    cnpj: string;
    competencia: string;
    entregas: EntregaReinf[];
    totalizador: Array<{ codigoReceita: string; valor: number }>;
    fechamento?: { recibo?: string; processadoEm?: string } | null;
    arquivos?: Array<{ nome: string; base64: string; mime?: string }>;
}): Promise<RespostaFechamento> {
    const r = await fetch('/api/admin/reinf/fechamento-competencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify(p),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `Falha ao fechar a competência (HTTP ${r.status})`);
    return j as RespostaFechamento;
}
