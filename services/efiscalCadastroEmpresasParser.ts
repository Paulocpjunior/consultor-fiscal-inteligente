/**
 * efiscalCadastroEmpresasParser — PURO (testável).
 *
 * Lê a "Listagem do Cadastro de Empresas" que o E-Fiscal exporta em HTML
 * (gerador XFRX, posicionamento absoluto): uma empresa por página, com
 * Código, Nome e C.G.C./C.N.P.J. É a fonte OFICIAL da carga em massa do
 * Cod.Cliente (Paulo, 05/08: "eu só consegui em html") — validada contra o
 * arquivo real: 1.767 empresas, todas com CNPJ, zero código duplicado,
 * NOVA ERA=1154 e S&P=1200 conferidos.
 *
 * O HTML do XFRX não tem tabela: cada texto é um <div> com top/left. A
 * leitura reconstrói as "linhas" pela coordenada: o VALOR de um rótulo é o
 * texto mais próximo na MESMA altura (±3px), à direita — pulando os outros
 * rótulos, que dividem a linha (a I.E. fica na mesma altura do CNPJ e foi
 * exatamente o primeiro bug do parser).
 */

export interface EmpresaEfiscal {
    /** 4 dígitos com zero à esquerda, como impresso ("0001"). */
    codigo: string;
    nome: string;
    /** Só dígitos (14). */
    cnpj: string;
    /** Regime impresso na ficha (Lucro Presumido/Estimativa/Simples…) — informativo. */
    irpj: string;
}

export interface CadastroEmpresasParseado {
    empresas: EmpresaEfiscal[];
    /** Fichas que não puderam ser lidas por inteiro, com o motivo. */
    ignoradas: Array<{ codigo: string; nome: string; motivo: string }>;
    /** Mesmo CNPJ com DOIS códigos no arquivo — decisão humana. */
    conflitos: Array<{ cnpj: string; codigos: string[]; nomes: string[] }>;
}

const LABELS = new Set([
    'Código', 'Nome', 'Endereço', 'Bairro', 'Distrito', 'Sub-Distrito', 'Cidade', 'Estado',
    'CEP', 'Inscr. Munic.', 'C.G.C./C.N.P.J.', 'I.E.', 'CNAE', 'Telefone', 'Fax', 'IRPJ',
    'Tipo', 'Subtipo', 'Sub. Tribut.', 'Apur. ICMS', 'Simples SP', 'Aba Escrita Fiscal',
    'PIS/COFINS Lucro Real', 'Data', 'Página',
]);

interface Item { top: number; left: number; texto: string; }

function decodificar(t: string): string {
    return t
        .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ')
        .trim();
}

/** Extrai (top, left, texto) de cada div posicionado, na ordem do documento. */
export function extrairItensPosicionados(htmlBruto: string): Item[] {
    const itens: Item[] = [];
    const re = /<div[^>]*style="position:absolute;top:(\d+)px;left:(\d+)px;[^"]*"[^>]*><span[^>]*>([\s\S]*?)<\/span><\/div>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(htmlBruto)) !== null) {
        const texto = decodificar(m[3].replace(/<[^>]+>/g, ''));
        if (texto) itens.push({ top: Number(m[1]), left: Number(m[2]), texto });
    }
    return itens;
}

function valorDoRotulo(pagina: Item[], rotulo: string, tol = 3): string | null {
    const lab = pagina.find(i => i.texto === rotulo && i.left < 100);
    if (!lab) return null;
    // A linha é dividida em colunas por OUTROS rótulos (CNPJ | I.E. | CNAE).
    // O valor deste rótulo mora ANTES do próximo — sem o limite, um CNPJ
    // vazio faria o valor da I.E. ser lido como CNPJ.
    const proximoRotulo = Math.min(
        ...pagina
            .filter(i => Math.abs(i.top - lab.top) <= tol && LABELS.has(i.texto) && i.left > lab.left)
            .map(i => i.left),
        Number.POSITIVE_INFINITY,
    );
    const cands = pagina
        .filter(i => Math.abs(i.top - lab.top) <= tol && i.left > lab.left + 50
            && i.left < proximoRotulo && !LABELS.has(i.texto))
        .sort((a, b) => Math.abs(a.top - lab.top) - Math.abs(b.top - lab.top) || a.left - b.left);
    return cands[0]?.texto ?? null;
}

export function parsearCadastroEmpresas(htmlBruto: string): CadastroEmpresasParseado {
    const itens = extrairItensPosicionados(htmlBruto);

    // Página nova = a coordenada volta pro topo (cada página tem sistema próprio).
    const paginas: Item[][] = [[]];
    for (const it of itens) {
        const atual = paginas[paginas.length - 1];
        if (atual.length > 0 && it.top < atual[atual.length - 1].top - 200) paginas.push([]);
        paginas[paginas.length - 1].push(it);
    }

    const empresas: EmpresaEfiscal[] = [];
    const ignoradas: CadastroEmpresasParseado['ignoradas'] = [];
    for (const pg of paginas) {
        const codigo = valorDoRotulo(pg, 'Código');
        if (codigo == null) continue;              // página de continuação da ficha
        const nome = valorDoRotulo(pg, 'Nome') || '';
        const cnpj = (valorDoRotulo(pg, 'C.G.C./C.N.P.J.') || '').replace(/\D+/g, '');
        if (!/^\d{1,4}$/.test(codigo.trim())) {
            ignoradas.push({ codigo, nome, motivo: `código "${codigo}" fora do padrão de 4 dígitos` });
            continue;
        }
        if (cnpj.length !== 14) {
            ignoradas.push({ codigo, nome, motivo: cnpj ? `CNPJ "${cnpj}" incompleto` : 'ficha sem CNPJ' });
            continue;
        }
        empresas.push({
            codigo: codigo.trim().padStart(4, '0'),
            nome,
            cnpj,
            irpj: valorDoRotulo(pg, 'IRPJ') || '',
        });
    }

    // Mesmo CNPJ com códigos diferentes (matriz recadastrada etc.): o app não
    // escolhe — os dois saem da carga e viram decisão humana.
    const porCnpj = new Map<string, EmpresaEfiscal[]>();
    for (const e of empresas) {
        if (!porCnpj.has(e.cnpj)) porCnpj.set(e.cnpj, []);
        porCnpj.get(e.cnpj)!.push(e);
    }
    const conflitos: CadastroEmpresasParseado['conflitos'] = [];
    for (const [cnpj, lista] of porCnpj) {
        const codigos = Array.from(new Set(lista.map(e => e.codigo)));
        if (codigos.length > 1) {
            conflitos.push({ cnpj, codigos, nomes: Array.from(new Set(lista.map(e => e.nome))) });
        }
    }
    const emConflito = new Set(conflitos.map(c => c.cnpj));

    return {
        empresas: empresas.filter(e => !emConflito.has(e.cnpj)),
        ignoradas,
        conflitos,
    };
}
