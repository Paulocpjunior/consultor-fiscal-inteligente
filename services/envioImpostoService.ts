/**
 * envioImpostoService.ts — ORDEM TÉCNICA do envio de imposto ao cliente
 * (Paulo, 24/07/2026). Todo imposto/guia/obrigação enviado pelo app segue:
 *
 *   1. Cópia do arquivo na pasta IMPOSTOS do cliente no SharePoint
 *      (Empresas/{grupo}/DEPARTAMENTO FISCAL/{ano}/{mês}-{ano}/{pasta}/IMPOSTOS);
 *   2. Cópia automática ao gestor (alexandre@) em TODO envio;
 *   3. Baixa da obrigação correspondente na aba Vencimentos e Obrigações
 *      (o reverso da pendência que o cron mensal cria — e que zera todo mês);
 *   4. Auditoria central (impostos_enviados).
 *
 * O backend executa 1/3/4 via POST /api/admin/envio-imposto/registrar; o
 * mailto daqui garante o 2 no fluxo "e-mail padrão do colaborador".
 */
import { getAuth } from 'firebase/auth';

export const GESTOR_EMAIL = 'alexandre@spassessoriacontabil.com.br';

export interface EnvioImpostoInput {
    empresaId?: string;
    empresaCnpj: string;
    empresaNome: string;
    /** 'DAS' | 'DARF' | 'DCTFWEB' | 'DARE' | 'FGTS' | 'SPED' | ... */
    tipo: string;
    /** 'AAAA-MM' ou 'MM/AAAA' */
    competencia: string;
    canal: 'email-app' | 'email-graph' | 'whatsapp';
    para?: string;
    pdfBase64?: string | null;
    pdfFileName?: string;
    valor?: number;
}

export interface RitoResultado {
    ok: boolean;
    error?: string;
    gestor?: string;
    sharePoint?: { status: 'arquivado' | 'sem-config' | 'sem-pdf' | 'erro'; motivo?: string; folder?: string; filename?: string };
    baixa?: { status: 'baixada' | 'sem-tarefa' | 'erro'; motivo?: string; obrigacao?: string; competencia?: string; tarefas?: number };
    logId?: string | null;
}

/** Registra o envio no backend — executa SharePoint + baixa + auditoria. */
export async function registrarEnvioImposto(input: EnvioImpostoInput): Promise<RitoResultado> {
    const u = getAuth().currentUser;
    if (!u) throw new Error('Sessão expirada');
    const token = await u.getIdToken();
    const res = await fetch('/api/admin/envio-imposto/registrar', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
    return data;
}

/**
 * Monta o link mailto: do envio pelo e-mail PADRÃO do colaborador — com o
 * e-mail de cadastro do cliente no Para e o gestor SEMPRE em cópia (regra 2
 * da ordem técnica; espelho do montarMailtoEnvio do backend).
 * Obs.: mailto não anexa arquivo — o colaborador anexa o PDF baixado; a
 * cópia de arquivo da ordem técnica é garantida pelo SharePoint (regra 1).
 */
export function montarMailtoEnvio(p: { para: string; assunto?: string; corpo?: string; cc?: string[] }): string {
    const dest = String(p.para || '').trim();
    const listaCc = [...new Set([GESTOR_EMAIL, ...(p.cc || [])]
        .map((e) => String(e || '').trim().toLowerCase())
        .filter((e) => e && e !== dest.toLowerCase()))];
    const qs = new URLSearchParams();
    if (listaCc.length) qs.set('cc', listaCc.join(','));
    if (p.assunto) qs.set('subject', p.assunto);
    if (p.corpo) qs.set('body', p.corpo);
    const query = qs.toString().replace(/\+/g, '%20');
    return `mailto:${encodeURIComponent(dest)}${query ? `?${query}` : ''}`;
}

/**
 * Fluxo completo do envio pelo e-mail do colaborador: abre o mailto (cliente
 * no Para, gestor em CC) E registra o envio no backend (SharePoint + baixa +
 * auditoria). Retorna o resultado do rito pra UI mostrar o farol honesto.
 */
export async function enviarPorEmailDoColaborador(
    input: Omit<EnvioImpostoInput, 'canal'> & { assunto?: string; corpo?: string },
): Promise<RitoResultado> {
    if (!input.para || !input.para.includes('@')) {
        return { ok: false, error: 'E-mail do cliente ausente — preencha o e-mail no cadastro da empresa (dados fiscais).' };
    }
    const mailto = montarMailtoEnvio({ para: input.para, assunto: input.assunto, corpo: input.corpo });
    window.open(mailto, '_self');
    const { assunto: _a, corpo: _c, ...resto } = input;
    return registrarEnvioImposto({ ...resto, canal: 'email-app' });
}
