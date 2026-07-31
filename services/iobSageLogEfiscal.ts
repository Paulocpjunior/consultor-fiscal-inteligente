/**
 * iobSageLogEfiscal.ts — PURO (testável). Lê o LOG DE ERROS que o E-Fiscal
 * gera ao importar o .FML e transforma em ação.
 *
 * Caso 31/07 (EDUARDO GUERRA, 07/2026): "não importou". O log mostrava a
 * cascata — 53 E010 sem UF + 31 E010 "CNPJ já cadastrado com outro Código de
 * Faturamento" ⇒ 84/84 participantes recusados ⇒ 384 E200 "código não consta
 * no cadastro" ⇒ 384 E342 "nota não cadastrada". ZERO notas importadas, e o
 * colaborador só via "não importou".
 *
 * O log referencia a LINHA do .FML ("Linha 000002"): cruzando com o conteúdo
 * gerado (que a tela guarda), recuperamos QUEM é cada erro — pro caso do
 * "outro código", o CNPJ e o nome do participante que precisa do De→Para.
 */

export type CategoriaErroEfiscal =
    | 'uf-invalida'            // E010 campo 10 vazio/inválido
    | 'codigo-existente'       // CNPJ já cadastrado com outro Código de Faturamento
    | 'participante-nao-consta'// E200 campo 08 aponta código que não existe lá
    | 'nota-nao-cadastrada'    // E342 (consequência do E200 recusado)
    | 'outro';

export interface ErroLogEfiscal {
    linha: number;             // linha do .FML (1-based, como o log escreve)
    registro: string;          // E010, E200, E342…
    mensagem: string;
    categoria: CategoriaErroEfiscal;
}

export interface ParticipanteComCodigoExistente {
    cnpjCpf: string;
    nome: string;
    codigoEnviado: string;
}

export interface CruzamentoLogEfiscal {
    totalErros: number;
    porCategoria: Record<CategoriaErroEfiscal, number>;
    /** Participantes que o E-Fiscal já tem com OUTRO código — precisam do De→Para. */
    codigoExistente: ParticipanteComCodigoExistente[];
    /** Participantes recusados por UF — a geração nova deriva a UF do IBGE; regerar resolve. */
    semUf: ParticipanteComCodigoExistente[];
    resumo: string;
}

function categorizar(registro: string, mensagem: string): CategoriaErroEfiscal {
    const m = mensagem.toLowerCase();
    if (/uf inv[aá]lida/.test(m)) return 'uf-invalida';
    if (/j[aá] cadastrado com outro c[oó]digo/.test(m)) return 'codigo-existente';
    if (/n[aã]o consta no cadastro de clientes/.test(m)) return 'participante-nao-consta';
    if (registro === 'E342' || /nota fiscal n[aã]o cadastrada/.test(m)) return 'nota-nao-cadastrada';
    return 'outro';
}

/**
 * Extrai os erros do log. O formato REAL varia por registro (conferido no log
 * do caso 31/07):
 *   E010: "(X)  Linha 000002 - Registro E010 - Campo 10, UF inválida…"
 *   E200: "(X) NF SAÍDA - N° 0000429967- CÓDIGO DO CLIENTE: … Linha 000099 - Registro E200 - …"
 *   E342: "(X) NF SAÍDA  - N° …- CÓDIGO DO CLIENTE/FORNECEDOR: … Linha 000105 - Registro E342 - …"
 * A âncora é "Linha NNNNNN - Registro XXXX" em QUALQUER posição da linha — o
 * regex ancorado no início só pegava os E010 e escondia a cascata.
 */
export function parseLogEfiscal(txt: string): ErroLogEfiscal[] {
    const out: ErroLogEfiscal[] = [];
    for (const linha of String(txt || '').split(/\r?\n/)) {
        if (!linha.startsWith('(X)')) continue;
        const m = linha.match(/Linha\s+(\d+)\s*-\s*Registro\s+(\w+)\s*-\s*(.+)$/i);
        if (!m) continue;
        const mensagem = m[3].trim();
        out.push({
            linha: parseInt(m[1], 10),
            registro: m[2].toUpperCase(),
            mensagem,
            categoria: categorizar(m[2].toUpperCase(), mensagem),
        });
    }
    return out;
}

/** Campos do E010 por POSIÇÃO FIXA (Layout Folhamatic v2.0.06). */
function lerE010(linhaFml: string) {
    const campo = (ini: number, fim: number) => linhaFml.slice(ini - 1, fim).trim();
    return {
        codigoEnviado: campo(5, 24),
        nome: campo(25, 124),
        cnpjCpf: campo(360, 373).replace(/\D/g, ''),
    };
}

/**
 * Cruza o log com o CONTEÚDO do .FML gerado (mesma geração — as linhas do log
 * apontam pro arquivo que saiu desta tela).
 */
export function cruzarLogComFml(erros: ErroLogEfiscal[], conteudoFml: string): CruzamentoLogEfiscal {
    const linhas = String(conteudoFml || '').split(/\r?\n/);
    const porCategoria: Record<CategoriaErroEfiscal, number> = {
        'uf-invalida': 0, 'codigo-existente': 0, 'participante-nao-consta': 0,
        'nota-nao-cadastrada': 0, 'outro': 0,
    };
    const codigoExistente = new Map<string, ParticipanteComCodigoExistente>();
    const semUf = new Map<string, ParticipanteComCodigoExistente>();

    for (const e of erros) {
        porCategoria[e.categoria] += 1;
        if (e.categoria !== 'codigo-existente' && e.categoria !== 'uf-invalida') continue;
        const linhaFml = linhas[e.linha - 1] || '';
        if (!linhaFml.startsWith('E010')) continue;
        const p = lerE010(linhaFml);
        if (!p.cnpjCpf) continue;
        (e.categoria === 'codigo-existente' ? codigoExistente : semUf).set(p.cnpjCpf, p);
    }

    const nCod = codigoExistente.size;
    const nUf = semUf.size;
    const partes: string[] = [];
    if (nUf > 0) partes.push(`${nUf} participante(s) sem UF — a geração nova preenche pela cidade (IBGE); basta REGERAR o arquivo`);
    if (nCod > 0) partes.push(`${nCod} participante(s) que o E-Fiscal já tem com OUTRO código — informe o código existente no De→Para abaixo e regere`);
    if (porCategoria['nota-nao-cadastrada'] > 0 || porCategoria['participante-nao-consta'] > 0) {
        partes.push(`as ${porCategoria['participante-nao-consta']} nota(s) recusadas são CONSEQUÊNCIA do cadastro — resolvendo o de cima, elas entram`);
    }
    return {
        totalErros: erros.length,
        porCategoria,
        codigoExistente: Array.from(codigoExistente.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
        semUf: Array.from(semUf.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')),
        resumo: partes.length ? partes.join('; ') + '.' : (erros.length === 0
            ? 'Nenhum erro "(X)" encontrado no log — se nada importou, o arquivo pode nem ter sido lido (confira empresa/competência no E-Fiscal).'
            : 'Erros sem tratamento automático — veja a lista completa.'),
    };
}
