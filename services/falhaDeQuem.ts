// ============================================================================
// 🚨 DE QUEM É A FALHA — do SERVIÇO ou do CADASTRO de cada empresa?
//
// 30/08, print do Paulo: o **NFS-e Nacional ADN** em vermelho com
// *"TODAS as 42 tentativas da última execução falharam — captura inoperante"*,
// e os motivos:
//
//   1× 27986638000108 — pagina 1: HTTP 400: {"StatusProcessamento":"REJEICAO",
//      "Erros":[{"Codigo":"E999","Descricao":"Erro não catalogado"}]}
//   1× 34025070000116 — pagina 1: HTTP 400: {… mesmo E999 …}
//
// O farol estava CERTO (100% falhou, 0 doc em 7 dias ⇒ crítico) e a causa
// aparecia na tela. **O que faltava era a AÇÃO** — e a ação aqui é o oposto da
// intuitiva: com 42 empresas em vermelho e um "Erro não catalogado", quem lê
// vai conferir cadastro e certificado das 42, **uma por uma, à toa**.
//
// 📌 É a lição das 236 empresas em ALTO por um campo fantasma (26/08): o custo
// não é a linha errada, é a equipe gastar o dia no lugar errado — e depois
// parar de olhar o painel.
//
// ✂️ O que o app PODE afirmar sozinho: **quando 100% das falhas têm a MESMA
// assinatura, o problema não é de cada empresa.** Cadastro torto é individual e
// varia; contrato/serviço fora do ar erra igual em todas.
//
// ⚠️ E ele NÃO diz qual é o defeito do provedor. "Erro não catalogado" é o
// órgão dizendo que nem ele sabe — deduzir dali o que mudou na API seria
// inventar contrato (a disciplina do `1405`). O que ele afirma é de QUEM é.
// ============================================================================

/** Uma falha agregada, como o painel já a recebe. */
export interface FalhaAgregada {
    motivo: string;
    quantidade: number;
}

export type OrigemDaFalha = 'servico' | 'por-empresa' | 'indeterminado';

export interface VereditoDaFalha {
    origem: OrigemDaFalha;
    /** A assinatura comum, quando existe (ex.: "HTTP 400 · E999"). */
    assinatura: string | null;
    frase: string;
    /** A ação — e no caso do serviço ela é o que NÃO fazer. */
    acao: string | null;
}

/**
 * A assinatura ESTÁVEL de um motivo — o que se repete entre empresas.
 *
 * ⚠️ O motivo carrega o **CNPJ** e a **página**, que mudam a cada empresa: sem
 * tirá-los, duas falhas idênticas contariam como duas causas diferentes (é por
 * isso que o card mostra `1× … 1× …` para o mesmo E999). Fica o código HTTP e
 * o código de erro do órgão, que é o que de fato identifica a causa.
 */
export function assinaturaDaFalha(motivo: string): string | null {
    const t = String(motivo || '');
    if (!t.trim()) return null;
    const partes: string[] = [];
    const http = t.match(/HTTP\s+(\d{3})/i);
    if (http) partes.push(`HTTP ${http[1]}`);
    // Código do órgão: "Codigo":"E999" / cStat 656 / E2220 solto.
    const codigo = t.match(/"Codigo"\s*:\s*"([A-Z0-9_-]+)"/i)
        || t.match(/\bcStat[=:\s]+(\d{3})\b/i)
        || t.match(/\b(E\d{3,4})\b/);
    if (codigo) partes.push(codigo[1]);
    if (partes.length) return partes.join(' · ');
    // Sem código legível: cai no texto normalizado (sem números), que ainda
    // distingue "erro de certificado" de "timeout".
    const limpo = t.replace(/\d+/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
    return limpo || null;
}

/** Mínimo de falhas para afirmar que o problema é do SERVIÇO. */
export const MIN_FALHAS_PARA_CULPAR_O_SERVICO = 3;

/**
 * De quem é a falha desta rodada?
 *
 * ⚠️ **Com sucesso junto, nunca é do serviço**: se algumas empresas passaram, o
 * serviço está de pé e o que falhou é daquelas empresas.
 * ⚠️ **E poucas falhas não bastam**: duas empresas com o mesmo erro pode ser
 * coincidência, e afirmar "é do provedor" ali mandaria ignorar cadastro torto.
 */
export function deQuemEhAFalha(p: {
    sucessos?: number | null;
    falhas?: number | null;
    motivos?: FalhaAgregada[] | null;
    canal?: string;
}): VereditoDaFalha {
    const sucessos = p?.sucessos ?? null;
    const falhas = p?.falhas ?? null;
    const motivos = Array.isArray(p?.motivos) ? p!.motivos!.filter(m => m && m.motivo) : [];
    const canal = p?.canal || 'a captura';

    if (!falhas || falhas <= 0 || !motivos.length) {
        return { origem: 'indeterminado', assinatura: null, frase: '', acao: null };
    }
    // Alguma empresa passou ⇒ o serviço responde; o que falhou é delas.
    if ((sucessos ?? 0) > 0) {
        return {
            origem: 'por-empresa',
            assinatura: null,
            frase: `${falhas} empresa(s) falharam e ${sucessos} passaram — o serviço está de pé, então a causa é de cada empresa.`,
            acao: 'Confira o cadastro e o certificado das que falharam; as demais capturaram normalmente.',
        };
    }

    const assinaturas = new Set(
        motivos.map(m => assinaturaDaFalha(m.motivo)).filter(Boolean) as string[],
    );
    const totalNosMotivos = motivos.reduce((s, m) => s + (m.quantidade || 1), 0);

    if (assinaturas.size === 1 && falhas >= MIN_FALHAS_PARA_CULPAR_O_SERVICO) {
        const assinatura = [...assinaturas][0];
        return {
            origem: 'servico',
            assinatura,
            frase: `TODAS as ${falhas} tentativas falharam com o MESMO erro (${assinatura}) — `
                + 'isso é do serviço, não do cadastro de cada empresa.',
            // 🚨 A ação aqui é o que NÃO fazer: é ela que evita o dia perdido.
            acao: `Não confira cadastro nem certificado empresa por empresa — cadastro torto erra `
                + `de um jeito em cada uma, e aqui as ${falhas} erraram igual. Também não adianta `
                + `reprocessar em série: o erro se repete. Aguarde a próxima rodada e, se persistir, `
                + `leve ESTE código (${assinatura}) ao suporte do provedor de ${canal}.`,
        };
    }

    return {
        origem: 'por-empresa',
        assinatura: null,
        frase: `${falhas} tentativa(s) falharam com ${assinaturas.size} causa(s) diferentes`
            + `${totalNosMotivos < falhas ? ' (a lista mostra as principais)' : ''}.`,
        acao: 'Cada causa pede uma ação — confira a lista de motivos abaixo.',
    };
}
