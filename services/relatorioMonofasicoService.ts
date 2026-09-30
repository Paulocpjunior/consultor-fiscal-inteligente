/**
 * 🧪 Relatório PIS/COFINS monofásico × tributado (com devoluções) — cliente do
 * GET /api/admin/sped-contrib/relatorio-monofasico. A conta mora no backend
 * (`sefaz-backend/relatorio-monofasico.js`), sobre a MESMA leitura do arquivo.
 */
import { getAuth } from 'firebase/auth';
import type { RelatorioMonofasico, LinhaMonofasico } from '../sefaz-backend/relatorio-monofasico.js';

export type RelatorioMonofasicoResposta = Omit<RelatorioMonofasico, 'linhas'> & {
    ok: true;
    empresaId: string;
    empresaNome: string;
    empresaCnpj: string;
    competencia: string;
    regimeApuracao: string;
    devolucoesLinhas: LinhaMonofasico[];
    totalLinhas: number;
    csv: string;
    avisosDaColeta: string[];
};

export async function carregarRelatorioMonofasico(
    empresaId: string, competencia: string,
): Promise<RelatorioMonofasicoResposta | { ok: false; error: string }> {
    const u = getAuth().currentUser;
    if (!u) return { ok: false, error: 'Sessão expirada — entre novamente.' };
    const token = await u.getIdToken();
    const res = await fetch(
        `/api/admin/sped-contrib/relatorio-monofasico?empresaId=${encodeURIComponent(empresaId)}&competencia=${encodeURIComponent(competencia)}`,
        { headers: { Authorization: `Bearer ${token}` } },
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}

/** Baixa o CSV (Windows-1252 não: UTF-8 com BOM, que o Excel abre com acento). */
export function baixarCsvMonofasico(r: RelatorioMonofasicoResposta) {
    const blob = new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pis-cofins-monofasico-${String(r.empresaCnpj || r.empresaId).replace(/\D/g, '')}-${r.competencia}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
