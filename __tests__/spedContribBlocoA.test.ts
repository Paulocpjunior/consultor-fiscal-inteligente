/**
 * spedContribBlocoA — as 143 recusas de CONTEÚDO da MANTOAN 07/2026.
 *
 * Paulo, 18/08, com o 2º recibo do PVA (o de estrutura já tinha saído):
 * *"Erro de estrutura saiu, agora deu esses erros por dentro; alguns erros como
 * COD MUN eu arrumava manual mesmo, pq na nota não tinha mesmo"*.
 *
 *   37 · Registro filho obrigatório não foi informado ....... A170
 *   37 · Campo de preenchimento obrigatório ................. A100 · 5 COD_SIT
 *   37 · Campo de preenchimento obrigatório ................. A100 · 13 IND_PGTO
 *   30 · Campo obrigatório para domiciliados no Brasil ...... 0150 · COD_MUN
 *    1 · Inscrição Estadual inválida ("ISENTO") ............. 0140 · IE
 *    1 · Valor informado deve ser maior que zero ............ A100 · VL_DOC
 *
 * 🚨 A CAUSA DO MAIOR GRUPO É A ARMADILHA DAS DUAS FORMAS, PELA NONA VEZ: o laço
 * do A170 percorria `nota.itens`, e a NFS-e do portal de SP entra SEM itens (ela
 * grava `valorTotal`). O laço nunca rodava — 37 A100 órfãos.
 */
import { buildBlocoA, filtrarNotasBlocoA } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-ignore
import { buildBloco0Contrib, ieDoArquivo } from '../sefaz-backend/sped-contrib-bloco0.js';
// @ts-ignore
import { camposDaLinha, conferirContagemDeCampos } from '../sefaz-backend/sped-contrib-campos.js';

/** Notas na forma ACHATADA da NFS-e do portal — a real do arquivo da MANTOAN. */
const notaPrestada = (numero: string, valor: number) => ({
    numero, tipo: 'NFSe', direcao: 'saida', valorTotal: valor,
    dataEmissao: '2026-07-16', cpfDest: '01056860855', xNomeDest: 'SONIA A V SCHNAIDMAN',
});
const notaTomada = (numero: string, valor: number) => ({
    numero, tipo: 'NFSe', direcao: 'entrada', valorTotal: valor,
    dataEmissao: '2026-07-28', cnpjEmit: '05059447000150', xNomeEmit: 'QUALILOG',
});

const dadosBase = (notas: any[]) => ({
    empresa: { cnpj: '13344638000191', nome: 'CLINICA MEDICA MANTOAN LTDA' },
    competencia: '2026-07',
    regimeApuracao: '2',   // cumulativo (Presumido)
    notas,
    itens: [],
    participantes: [],
    warnings: [] as string[],
});

describe('🚨 A170 — o registro filho que nunca saía', () => {
    const dados = dadosBase([notaPrestada('7870', 1450)]);
    const linhas: string[] = buildBlocoA(dados);

    it('todo A100 passa a ter A170 — 37 recusas do PVA de uma vez', () => {
        expect(linhas.filter(l => l.startsWith('|A100|'))).toHaveLength(1);
        expect(linhas.filter(l => l.startsWith('|A170|'))).toHaveLength(1);
    });

    it('o item único carrega o VALOR DO DOCUMENTO — mesma leitura do A100', () => {
        const a170 = camposDaLinha(linhas.find(l => l.startsWith('|A170|'))!);
        expect(a170[1]).toBe('1');            // NUM_ITEM
        expect(a170[4]).toBe('1450,00');      // VL_ITEM
        expect(a170[9]).toBe('1450,00');      // VL_BC_PIS
        expect(a170[13]).toBe('1450,00');     // VL_BC_COFINS
    });

    it('CST de saída é 01, e os campos de crédito ficam VAZIOS', () => {
        const a170 = camposDaLinha(linhas.find(l => l.startsWith('|A170|'))!);
        expect(a170[8]).toBe('01');           // CST_PIS
        expect(a170[12]).toBe('01');          // CST_COFINS
        // NAT_BC_CRED e IND_ORIG_CRED só existem quando HÁ crédito. O código
        // antigo cravava NAT_BC_CRED = '0', que nem pertence à tabela (01-18).
        expect(a170[6]).toBe('');
        expect(a170[7]).toBe('');
    });

    it('o A170 tem os 18 campos do leiaute (faltava IND_ORIG_CRED)', () => {
        const a170 = camposDaLinha(linhas.find(l => l.startsWith('|A170|'))!);
        expect(a170).toHaveLength(18);
    });

    it('nota COM itens continua saindo item a item — o caminho antigo não regride', () => {
        const comItens = dadosBase([{
            numero: '900', tipo: 'NFSe', direcao: 'saida', valorTotal: 300,
            dataEmissao: '2026-07-10', cpfDest: '01056860855',
            itens: [
                { nItem: '1', xProd: 'Consulta', vProd: 200 },
                { nItem: '2', xProd: 'Exame', vProd: 100 },
            ],
        }]);
        const l: string[] = buildBlocoA(comItens);
        expect(l.filter(x => x.startsWith('|A170|'))).toHaveLength(2);
    });
});

describe('A100 — os dois campos obrigatórios que saíam vazios', () => {
    const dados = dadosBase([notaPrestada('7870', 1450)]);
    const a100 = camposDaLinha(buildBlocoA(dados).find((l: string) => l.startsWith('|A100|'))!);

    it('COD_SIT (campo 5) = 00, documento regular', () => {
        // Afirmável por CONSTRUÇÃO: a cancelada já sai em filtrarNotasBlocoA.
        expect(a100[4]).toBe('00');
    });

    it('IND_PGTO (campo 13) preenchido', () => {
        expect(a100[12]).toBe('0');
    });

    it('🚨 e o IND_PGTO é DITO, porque a nota não responde por ele', () => {
        const d = dadosBase([notaPrestada('7870', 1450)]);
        buildBlocoA(d);
        const aviso = d.warnings.find(w => w.includes('IND_PGTO'));
        expect(aviso).toBeDefined();
        // Escolher em silêncio é o que a casa não faz: o aviso diz o que foi
        // afirmado em nome do cliente e que isso não mexe em nenhum número.
        expect(aviso).toMatch(/à vista/);
        expect(aviso).toMatch(/Não afeta base, PIS, COFINS nem o bloco M/);
    });

    it('a linha continua com os 21 campos que o PVA valida', () => {
        expect(a100).toHaveLength(21);
        expect(conferirContagemDeCampos([`|A100|${a100.slice(1).join('|')}|`]).ok).toBe(true);
    });
});

describe('A100 com VL_DOC zero — o caso PLUXEE', () => {
    it('sai do arquivo (o PVA recusa) mas volta NOMEADO', () => {
        const d = dadosBase([notaPrestada('7870', 1450), notaTomada('8450858', 0)]);
        const linhas: string[] = buildBlocoA(d);
        expect(linhas.filter(l => l.startsWith('|A100|'))).toHaveLength(1);
        const aviso = d.warnings.find(w => w.includes('R$ 0,00'));
        expect(aviso).toBeDefined();
        expect(aviso).toContain('8450858');
        // Some da CONTA não pode virar some da TELA — regra de 14/08.
        expect(aviso).toMatch(/Não muda base nenhuma/);
    });

    it('documento SEM valor legível também não vira zero silencioso', () => {
        const d = dadosBase([{ numero: '99', tipo: 'NFSe', direcao: 'saida', dataEmissao: '2026-07-01' }]);
        const linhas: string[] = buildBlocoA(d);
        expect(linhas.filter(l => l.startsWith('|A100|'))).toHaveLength(0);
        expect(d.warnings.some(w => w.includes('99'))).toBe(true);
    });
});

describe('0140 — "ISENTO" não é inscrição estadual', () => {
    it('texto de cadastro vira campo VAZIO', () => {
        expect(ieDoArquivo('ISENTO')).toBe('');
        expect(ieDoArquivo('NÃO CONTRIBUINTE')).toBe('');
        expect(ieDoArquivo('')).toBe('');
        expect(ieDoArquivo(null)).toBe('');
    });

    it('IE de verdade sobrevive, com ou sem máscara', () => {
        expect(ieDoArquivo('123.456.789.012')).toBe('123456789012');
        expect(ieDoArquivo('110042490114')).toBe('110042490114');
    });

    it('o 0140 do arquivo real sai sem o "ISENTO" que o PVA recusou', () => {
        const linhas: string[] = buildBloco0Contrib({
            ...dadosBase([]),
            empresa: {
                cnpj: '13344638000191', nome: 'CLINICA MEDICA MANTOAN LTDA',
                dadosFiscais: { uf: 'SP', inscricaoEstadual: 'ISENTO', codMunIBGE: '3550308' },
            },
        });
        const c = camposDaLinha(linhas.find(l => l.startsWith('|0140|'))!);
        expect(c[5]).toBe('');
    });
});

describe('0150 COD_MUN — o app DENUNCIA, não preenche', () => {
    const dados = {
        ...dadosBase([]),
        participantes: [
            { codPart: '01056860855', nome: 'SONIA APARECIDA VIOLLIN SCHNAIDMAN', cpf: '01056860855' },
            { codPart: '05059447000150', nome: 'QUALILOG', cnpj: '05059447000150', codMunIBGE: '3550308' },
        ],
    };

    it('avisa ANTES do PVA, com o nome e a contagem', () => {
        buildBloco0Contrib(dados);
        const aviso = dados.warnings.find(w => w.includes('COD_MUN'));
        expect(aviso).toBeDefined();
        expect(aviso).toContain('1 participante(s)');
        expect(aviso).toContain('SONIA');
    });

    it('🚨 e NÃO inventa: nem município, nem o "9999999" que o PVA sugere', () => {
        const linhas: string[] = buildBloco0Contrib(dados);
        const semMun = camposDaLinha(linhas.find(l => l.includes('SONIA'))!);
        expect(semMun[7]).toBe('');
        // '9999999' quer dizer NÃO domiciliado no Brasil — falso para um
        // paciente de São Paulo. Decisão do Paulo: ele arruma à mão.
        expect(semMun[7]).not.toBe('9999999');
        // Quem TEM município continua com ele.
        const comMun = camposDaLinha(linhas.find(l => l.includes('QUALILOG'))!);
        expect(comMun[7]).toBe('3550308');
    });

    it('empresa sem participante órfão não ganha aviso — alarme sem alvo, não', () => {
        const d = {
            ...dadosBase([]),
            participantes: [{ codPart: '1', nome: 'X', cnpj: '05059447000150', codMunIBGE: '3550308' }],
        };
        buildBloco0Contrib(d);
        expect(d.warnings.some(w => w.includes('COD_MUN'))).toBe(false);
    });
});

// ═══ A NFS-e COMO ELA CHEGA — e não como o fixture a inventa ════════════════
//
// 21/08, varredura dos leitores de DOCUMENTO. `filtrarNotasBlocoA` perguntava
// `n.tipo === 'NFSe' || String(n.modelo) === 'NFSE'` — as DUAS formas mais
// raras. A NFS-e do portal de SP entra por CSV/TXT gravando prestador/tomador
// e a do ADN grava `tipoDoc`: documento desses trilhos SUMIA do bloco A, e
// sumir do bloco A é sumir da apuração de PIS/COFINS, calada.
describe('🚨 bloco A — a NFS-e entra pelas formas REAIS de captura', () => {
    it('NFS-e do portal (prestador/tomador, sem `tipo`) entra', () => {
        const doPortal = { prestador: { cnpj: '1' }, tomador: { cnpj: '2' }, valorTotal: 100 };
        expect(filtrarNotasBlocoA([doPortal])).toHaveLength(1);
    });

    it('NFS-e do ADN (tipoDoc, sem `tipo`) entra', () => {
        expect(filtrarNotasBlocoA([{ tipoDoc: 'NFSe', valorTotal: 100 }])).toHaveLength(1);
    });

    it('documento com código de serviço municipal entra', () => {
        expect(filtrarNotasBlocoA([{ codigoServicoMunicipal: '07498', valorTotal: 50 }])).toHaveLength(1);
    });

    it('⚠️ CT-e NÃO entra no bloco A — ele é do bloco D', () => {
        expect(filtrarNotasBlocoA([{ tipoDoc: 'CTe', modelo: '57' }])).toHaveLength(0);
        expect(filtrarNotasBlocoA([{ tipo: 'CTe', chave: '3'.repeat(44) }])).toHaveLength(0);
    });

    it('NF-e de mercadoria continua fora, e cancelada também', () => {
        expect(filtrarNotasBlocoA([{ tipo: 'NFe', modelo: '55' }])).toHaveLength(0);
        const canceladaPorEvento = {
            tipoDoc: 'NFSe', status: 'autorizado',
            eventos: [{ tpEvento: '110111', cStat: '135' }],
        };
        expect(filtrarNotasBlocoA([canceladaPorEvento])).toHaveLength(0);
    });
});
