/**
 * empresaOption.ts — a MESMA empresa, na forma que o seletor entende.
 *
 * O `EmpresaSearchSelect` (busca por código, nome ou CNPJ + botão ⚡ Ativar)
 * nasceu na Central de XMLs e ficou lá. As outras telas — DAS, DARF, Tarefas,
 * SharePoint, NFTS, A3 — continuam com `<select>` cru de 400 opções, onde
 * achar cliente é rolar a lista.
 *
 * O que impedia reaproveitar não era o componente: era a FORMA. Cada tela
 * guarda a empresa do jeito da coleção dela — umas com `nome`, outras com
 * `razaoSocial`, o Cod.Cliente ora em `dadosFiscais.codCliente`, ora no topo
 * (legado). Sem um lugar só pra isso, cada tela reescreveria o mesmo `map`, e
 * a próxima esqueceria o `codCliente` — que é justamente o campo pelo qual a
 * equipe procura ("587" acha mais rápido que digitar o nome).
 *
 * REGRAS:
 * 1. NÃO INVENTA DADO. Campo que não existe vira string vazia, nunca um
 *    placeholder que pareça cadastro ("—" no lugar do nome faria a busca por
 *    nome casar com todo mundo).
 * 2. NÃO FILTRA. Empresa sem CNPJ ou sem nome continua na lista: sumir do
 *    seletor é pior que aparecer torta — o colaborador acha que não existe.
 *    Cadastro torto é ALERTA na tela de cadastro, não desaparecimento aqui.
 * 3. `fonte` é o regime (simples|lucro) e aparece no rodapé de cada linha.
 *    Sem saber, assume 'lucro' só para tipar — e quem chama deve passar.
 */
import type { EmpresaXmlOption } from './xmlFiscalService';

type Bruta = Record<string, any>;

const texto = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v).trim();
    return s === 'undefined' || s === 'null' ? '' : s;
};

/** Cod.Cliente do E-Fiscal: canônico em dadosFiscais, com fallback legado. */
export function codClienteDe(e: Bruta | null | undefined): string | undefined {
    const c = texto(e?.dadosFiscais?.codCliente) || texto(e?.codCliente);
    return c || undefined;
}

/** Regime da empresa, aceitando os nomes que as telas usam. */
function fonteDe(e: Bruta, padrao?: 'simples' | 'lucro'): 'simples' | 'lucro' {
    const bruto = texto(e?.fonte) || texto(e?.regime) || texto(e?.tipoRegime);
    if (/simples/i.test(bruto)) return 'simples';
    if (/lucro|presumido|real/i.test(bruto)) return 'lucro';
    return padrao || 'lucro';
}

/**
 * Empresa de QUALQUER tela → opção do seletor.
 *
 * @param e      empresa na forma da coleção de origem
 * @param fonte  regime, quando a tela já sabe (ex.: lista só do Simples)
 */
export function paraEmpresaOption(e: Bruta, fonte?: 'simples' | 'lucro'): EmpresaXmlOption {
    return {
        id: texto(e?.id) || texto(e?.empresaId) || texto(e?.docId),
        // A ordem é a de confiança: `nome` é o campo canônico; razaoSocial e
        // fantasia cobrem as coleções que nunca tiveram `nome`.
        nome: texto(e?.nome) || texto(e?.razaoSocial) || texto(e?.fantasia),
        cnpj: texto(e?.cnpj) || texto(e?.empresaCnpj),
        fonte: fonteDe(e, fonte),
        uf: texto(e?.uf) || texto(e?.dadosFiscais?.uf) || undefined,
        codCliente: codClienteDe(e),
    };
}

/**
 * Lista inteira. Mantém a ORDEM de quem chamou — telas ordenam por critérios
 * próprios (alfabético, por carteira) e reordenar aqui bagunçaria a de todas.
 */
export function paraEmpresaOptions(lista: Bruta[] | null | undefined, fonte?: 'simples' | 'lucro'): EmpresaXmlOption[] {
    return (lista || []).filter(Boolean).map((e) => paraEmpresaOption(e, fonte));
}
