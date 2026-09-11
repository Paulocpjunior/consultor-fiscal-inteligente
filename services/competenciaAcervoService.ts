/**
 * A porta do navegador para a correção de competência do acervo.
 *
 * O caso é o de 03/09 (CASA DA CRIANCA BETINHO): em SP a nota de 31/08 pode ser
 * emitida até 10/09, e até aquele dia os quatro trilhos gravavam a competência
 * pela EMISSÃO. Os trilhos foram corrigidos; o acervo ficou.
 *
 * ⚠️ Toda decisão é do BACKEND — este arquivo só transporta. Reimplementar aqui
 * "esta nota está no mês errado?" criaria a segunda cópia de uma régua que
 * decide livro, e a tela passaria a prometer um mês diferente do que grava.
 */
import { getAuth } from 'firebase/auth';

export interface NotaNoMesErrado {
    id: string | null;
    numero: string | null;
    prestador: string | null;
    valor: number | null;
    competenciaGravada: string | null;
    competenciaCerta: string;
    motivo: string;
    consequencia: string;
}

export interface FilaCompetenciaAcervo {
    ok: boolean;
    erro?: string;
    paraCorrigir: NotaNoMesErrado[];
    contagem?: {
        examinadas: number; conferem: number; semFatoGerador: number;
        ilegiveis: number; jaCorrigidas: number; foraDoEscopo: number;
    };
    resumo?: string;
    alcance?: string;
    /** Mês que não deu para ler: a fila está INCOMPLETA e isso vai dito. */
    avisoLeitura?: string | null;
    mesesLidos?: string[];
}

async function token(): Promise<string | null> {
    const u = getAuth().currentUser;
    return u ? u.getIdToken() : null;
}

export async function lerFilaCompetencia(
    empresaId: string, competencia: string,
): Promise<FilaCompetenciaAcervo> {
    const t = await token();
    if (!t) return { ok: false, erro: 'Sessão expirada — entre novamente.', paraCorrigir: [] };
    try {
        const res = await fetch(
            `/api/admin/competencia-acervo/fila?empresaId=${encodeURIComponent(empresaId)}`
            + `&competencia=${encodeURIComponent(competencia)}`,
            { headers: { Authorization: `Bearer ${t}` } },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, erro: data.erro || `HTTP ${res.status}`, paraCorrigir: [] };
        return { ok: true, ...data, paraCorrigir: data.paraCorrigir || [] };
    } catch (e) {
        // 🚨 Falha de rede NÃO vira fila vazia: vazio se lê como "o acervo está
        // certo", e é justamente a afirmação que não se pode fazer aqui.
        return { ok: false, erro: (e as Error)?.message || 'Falha ao consultar.', paraCorrigir: [] };
    }
}

export async function corrigirCompetencia(
    docId: string, motivo: string,
): Promise<{ ok: boolean; erro?: string; de?: string | null; para?: string; aviso?: string }> {
    const t = await token();
    if (!t) return { ok: false, erro: 'Sessão expirada — entre novamente.' };
    try {
        const res = await fetch('/api/admin/competencia-acervo/corrigir', {
            method: 'POST',
            headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ docId, motivo }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) return { ok: false, erro: data.erro || `HTTP ${res.status}` };
        return { ok: true, ...data };
    } catch (e) {
        return { ok: false, erro: (e as Error)?.message || 'Falha ao corrigir.' };
    }
}
