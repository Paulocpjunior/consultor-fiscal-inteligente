/**
 * efiscalCadastroParticipantesParser — PURO (testável).
 *
 * Lê a "Listagem do Cad. de Clientes/Fornec" que o E-Fiscal exporta em XLSX
 * (gerador XFRX). Paulo conseguiu o relatório em 05/08: é a fonte oficial do
 * De→Para de participantes — cada cliente/fornecedor com o CÓDIGO que JÁ
 * EXISTE no E-Fiscal daquela empresa. Mapeado, o participante não gera E010
 * e as notas saem referenciando o cadastro de lá (fim do "CNPJ já cadastrado
 * com outro Código de Faturamento", que digitado à mão eram 187 códigos só
 * na S&P).
 *
 * Formato real (blocos por participante, rótulo numa célula e valor nas
 * células seguintes da MESMA linha):
 *   Nome:   AO3 TECNOLOGIA LTDA
 *   ...
 *   CNPJ:   64.555.626/0001-47   IE: ...
 *   Código: 1                    Cliente  [X]  Fornecedor
 *
 * O cabeçalho do relatório traz "1200 - S&P ASSESSORIA CONTABIL S/S" — o
 * Cod.Cliente da PRÓPRIA empresa, que serve de trava: importar o arquivo da
 * empresa errada é o risco nº 1 desse fluxo.
 */

export interface ParticipanteEfiscal {
    codigo: string;
    nome: string;
    /** Só dígitos; '' quando o relatório não traz documento aproveitável. */
    cnpjCpf: string;
}

export interface CadastroEfiscalParseado {
    /** "1200 - S&P ..." do cabeçalho, quando encontrado. */
    empresaCodigo: string | null;
    empresaNome: string | null;
    participantes: ParticipanteEfiscal[];
    /** Blocos que não puderam virar mapa, com o motivo (farol honesto). */
    ignorados: Array<{ nome: string; motivo: string }>;
    /** Mesmo CNPJ com códigos DIFERENTES no arquivo — decisão é humana. */
    conflitos: Array<{ cnpjCpf: string; nomes: string[]; codigos: string[] }>;
    /** Pronto pra salvarCodigosParticipantes: só os sem conflito. */
    codigos: Record<string, string>;
}

const texto = (v: unknown): string => String(v ?? '').trim();
const soDigitos = (s: string): string => s.replace(/\D+/g, '');

/** Valor = primeira célula não vazia à direita do rótulo. */
function valorAposRotulo(row: unknown[], rotulo: string): string | null {
    for (let i = 0; i < row.length; i++) {
        if (texto(row[i]).toLowerCase() === rotulo) {
            for (let j = i + 1; j < row.length; j++) {
                const v = texto(row[j]);
                if (v) return v;
            }
            return '';
        }
    }
    return null;
}

export function parsearCadastroClientesFornecedores(rows: unknown[][]): CadastroEfiscalParseado {
    let empresaCodigo: string | null = null;
    let empresaNome: string | null = null;
    const participantes: ParticipanteEfiscal[] = [];
    const ignorados: CadastroEfiscalParseado['ignorados'] = [];

    let atual: { nome: string; cnpjCpf?: string; codigo?: string } | null = null;

    const fecharBloco = () => {
        if (!atual) return;
        const { nome, cnpjCpf, codigo } = atual;
        atual = null;
        if (!codigo) {
            ignorados.push({ nome, motivo: 'bloco sem a linha "Código:" — participante sem código no E-Fiscal' });
            return;
        }
        const doc = soDigitos(cnpjCpf || '');
        // CNPJ (14) e CPF (11) mapeiam; resto (truncado/vazio) não serve de
        // chave — o De→Para casa por documento.
        if (doc.length !== 14 && doc.length !== 11) {
            ignorados.push({
                nome,
                motivo: doc ? `documento "${cnpjCpf}" fora do padrão CNPJ/CPF — não dá pra casar` : 'sem CNPJ/CPF no relatório',
            });
            return;
        }
        participantes.push({ codigo: codigo.slice(0, 20), nome, cnpjCpf: doc });
    };

    for (const row of rows) {
        // Cabeçalho "1200 - EMPRESA" (só o primeiro vale — repete por página).
        if (empresaCodigo == null) {
            for (const cell of row) {
                const m = texto(cell).match(/^(\d{1,4})\s+-\s+(.{3,})$/);
                if (m) { empresaCodigo = m[1].padStart(4, '0'); empresaNome = m[2].trim(); break; }
            }
        }

        const nome = valorAposRotulo(row, 'nome:');
        if (nome != null) {
            fecharBloco();
            atual = { nome: nome || '(sem nome)' };
            continue;
        }
        if (!atual) continue;

        const cnpj = valorAposRotulo(row, 'cnpj:');
        if (cnpj != null) {
            // Na linha "CNPJ: x IE: y", o valor certo é o logo após CNPJ: —
            // mas quando o CNPJ está VAZIO, valorAposRotulo devolveria a IE.
            // Guarda: só aceita o que parecer documento.
            atual.cnpjCpf = cnpj;
            continue;
        }
        const codigo = valorAposRotulo(row, 'código:') ?? valorAposRotulo(row, 'codigo:');
        if (codigo != null) {
            // Célula seguinte pode ser o marcador X/Cliente quando o código
            // está vazio — rótulos não são código.
            const c = /^(x|cliente|fornecedor)$/i.test(codigo) ? '' : codigo;
            atual.codigo = c || undefined;
        }
    }
    fecharBloco();

    // Conflito: mesmo documento, códigos diferentes. Mesmo documento com o
    // MESMO código (blocos repetidos por página) não é conflito.
    const porDoc = new Map<string, ParticipanteEfiscal[]>();
    for (const p of participantes) {
        if (!porDoc.has(p.cnpjCpf)) porDoc.set(p.cnpjCpf, []);
        porDoc.get(p.cnpjCpf)!.push(p);
    }
    const conflitos: CadastroEfiscalParseado['conflitos'] = [];
    const codigos: Record<string, string> = {};
    for (const [docKey, lista] of porDoc) {
        const unicos = Array.from(new Set(lista.map(p => p.codigo)));
        if (unicos.length > 1) {
            conflitos.push({
                cnpjCpf: docKey,
                nomes: Array.from(new Set(lista.map(p => p.nome))),
                codigos: unicos,
            });
        } else {
            codigos[docKey] = unicos[0];
        }
    }

    return { empresaCodigo, empresaNome, participantes, ignorados, conflitos, codigos };
}
