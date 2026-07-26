/**
 * moduloDeepLink.ts — URL fixa por módulo dentro do SPA.
 *
 * O app não tem router de URL (navegação é estado React); o deep-link
 * `?modulo=<slug>` dá um endereço estável pra cada app/departamento —
 * ex.: https://<serviço>.run.app/?modulo=legalizacao — pra atalhos,
 * favoritos e links em e-mail/WhatsApp da equipe.
 *
 * O gate de acesso continua no menu (podeAcessarCard) + backend; o deep-link
 * só seleciona o card, não abre porta nova.
 */
import { SearchType } from '../types';

export const MODULO_SLUGS: Record<string, SearchType> = {
    legalizacao: SearchType.LEGALIZACAO,
    vencimentos: SearchType.OBRIGACOES_FISCAIS,
    xmls: SearchType.IMPORTA_XML,
    das: SearchType.DAS_SIMPLES,
    dctfweb: SearchType.DCTFWEB,
    diagnostico: SearchType.SAUDE_GERAL,
};

/** `?modulo=<slug>` → SearchType, ou null se ausente/desconhecido. */
export function resolverModuloDeepLink(search: string): SearchType | null {
    try {
        const slug = new URLSearchParams(search || '').get('modulo');
        if (!slug) return null;
        return MODULO_SLUGS[slug.trim().toLowerCase()] ?? null;
    } catch {
        return null;
    }
}
