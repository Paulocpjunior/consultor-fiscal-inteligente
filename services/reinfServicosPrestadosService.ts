/**
 * reinfServicosPrestadosService — porta do R-2020 (retenção previdenciária
 * SOFRIDA em serviços PRESTADOS).
 *
 * Só I/O. A régua mora em `sefaz-backend/reinf-servicos-prestados.js`,
 * calibrada contra um `evtServPrest` REAL aceito em produção (07/2026). É o
 * espelho do R-2010: lá o cliente é o tomador; aqui ele é o prestador, e o eixo
 * do evento é o TOMADOR.
 *
 * Reimplementar qualquer pedaço da régua aqui faria a tela prometer um número
 * diferente do que o outro app declara.
 */

import { getAuth } from 'firebase/auth';
import type { ConferenciaBase } from './reinfServicosTomadosService';

async function authHeader(): Promise<Record<string, string>> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    return { Authorization: `Bearer ${await u.getIdToken()}` };
}

/**
 * A nota como o backend entrega — e os nomes são os DELE.
 *
 * Contrato que o app irmão consome para montar o `nfs` do evtServPrest. Campo
 * novo no payload entra AQUI no mesmo PR (a varredura do teste cobra).
 */
export interface NotaR2020 {
    numero?: string | null;
    serie?: string | null;
    /** 'AAAA-MM-DD' — vira `dtEmissaoNF` no evento. */
    dtEmissao?: string | null;
    chave?: string | null;
    competencia?: string | null;
    /** O cliente (quem declara) — vira `nrInscEstabPrest`. */
    prestadorCnpj: string;
    /** A contraparte — o eixo do evento (`ideTomador`). */
    tomadorCnpj: string;
    tomadorNome: string | null;
    vlrBruto: number;
    inssRetido: number;
    /** De onde saiu o retido: do documento, ou da declaração (ajuste). */
    inssOrigem: 'documento' | 'ajuste-declarado' | null;
    /** Carimbo da declaração, quando o retido veio dela. */
    ajuste: { autor: string | null; motivo: string | null; em: string | null } | null;
    baseRetencao: number | null;
    baseOrigem: 'bruto-sem-deducao' | 'derivada-da-retencao' | null;
    discriminacao?: string | null;
    codigoServicoMunicipal?: string | null;
    /** NULOS de propósito: não estão na nota, são cadastrados por tomador. */
    tpServico: null;
    indObra: null;
    conferencia: ConferenciaBase;
}

export interface TomadorR2020 {
    cnpjTomador: string;
    nome: string | null;
    nrInscEstabPrest: string | null;
    indObra: number | null;
    notas: NotaR2020[];
    vlrTotalBruto: number;
    /** NULO quando a base não está provada — parcial seria lido como total. */
    vlrTotalBaseRet: number | null;
    baseCompleta: boolean;
    vlrTotalRetPrinc: number;
    comPendencia: number;
    comAjuste: number;
}

export interface PayloadR2020 {
    empresa: { empresaId?: string; nome?: string; regime?: string; cnpj: string };
    documentosLidos: number;
    cnpjPrestador: string | null;
    competencia: string | null;
    tomadores: TomadorR2020[];
    resumo: {
        tomadores: number;
        notas: number;
        semRetencaoPrevidenciaria: number;
        tomadorPessoaFisica: number;
        semTomadorLegivel: number;
        comPendencia: number;
        comAjuste: number;
        semBaseProvada: number;
        vlrTotalBruto: number;
        vlrTotalRetPrinc: number;
    };
    ressalvas: string[];
}

/** As NFS-e prestadas com INSS retido da competência, prontas para o R-2020. */
export async function carregarServicosPrestados(cnpj: string, competencia: string): Promise<PayloadR2020> {
    const qs = `cnpj=${encodeURIComponent(cnpj)}&competencia=${encodeURIComponent(competencia)}`;
    const r = await fetch(`/api/admin/reinf/servicos-prestados?${qs}`, { headers: await authHeader() });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.error || `Falha ao ler os serviços prestados (HTTP ${r.status})`);
    return j as PayloadR2020;
}
