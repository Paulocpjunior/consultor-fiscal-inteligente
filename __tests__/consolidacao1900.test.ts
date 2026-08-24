// ============================================================================
// 🚨 HAVENDO F550, O 1900 É OBRIGATÓRIO — e o bloco 1 saía SEMPRE vazio
//
// Recusa do PVA na AFFITTARE 17.213.641/0001-27 · 07/2026 (Paulo, 24/08,
// urgente), literal:
//
//   "Se o somatório do campo Valor Total da Receita Auferida do registro F550
//    e F560 for maior que zero o registro 1900 deve ser preenchido."
//
// O arquivo REAL que ele mandou (SPED_CONTRIB_17213641000127_202607) tem
// `|F550|21811,34|...|` e o bloco 1 inteiro em `|1001|1|` — sem dados.
//
// O `buildBloco1_Contrib` nasceu vazio quando o 1010 de ação judicial foi
// removido (17/08, MANTOAN) e nunca ganhou conteúdo. Com o F550 no ar desde
// 21/08, bloco 1 vazio virou recusa: o arquivo declara receita e não a
// consolida.
//
// ⚠️ **O QUE A RÉGUA SE RECUSA A FAZER.** `COD_MOD` (Tabela 4.1.1) e `COD_SIT`
// (Tabela 4.1.2) são código de TABELA OFICIAL e dependem de QUAL documento a
// empresa emite pelo aluguel. Sem cadastro o registro NÃO SAI e a falta vira
// aviso nomeado com a recusa literal — o desenho do 0002 e do código 9 do ISS
// fixo. Carimbá-los de memória é a família do 1405 e do PARTSEM: código
// inventado que o PVA às vezes ACEITA, e aí o erro só aparece na fiscalização.
// ============================================================================
// @ts-expect-error — módulo backend .js sem .d.ts
import { montar1900 } from '../sefaz-backend/receita-sem-documento-f550.js';
import { buildBloco1_Contrib } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error — módulo backend .js sem .d.ts
import { conferirConsolidacao1900 } from '../sefaz-backend/sped-contrib-campos.js';

const CNPJ = '17213641000127';
const RECEITA = 21811.34;

describe('🚨 o 1900 só sai com os códigos de tabela — nunca inventados', () => {
    it('sem COD_MOD e COD_SIT o registro NÃO sai, e diz o que falta', () => {
        const r = montar1900({ cnpj: CNPJ, receita: RECEITA });
        expect(r.campos).toBeUndefined();
        expect(r.falta.join(' ')).toMatch(/COD_MOD/);
        expect(r.falta.join(' ')).toMatch(/COD_SIT/);
    });

    it('faltando só um dos dois, também não sai — e nomeia o que falta', () => {
        const r = montar1900({ cnpj: CNPJ, receita: RECEITA, codMod: '99' });
        expect(r.campos).toBeUndefined();
        expect(r.falta.join(' ')).toMatch(/COD_SIT/);
        expect(r.falta.join(' ')).not.toMatch(/COD_MOD/);
    });

    // O que a régua DERIVA com certeza, e por quê.
    it('com os códigos, o resto sai do próprio arquivo', () => {
        const { campos } = montar1900({ cnpj: CNPJ, receita: RECEITA, codMod: '99', codSit: '00' });
        // O valor é a Σ do F550 — é a PRÓPRIA recusa do PVA que define isso.
        expect(campos.valorTotalReceita).toBeCloseTo(RECEITA, 2);
        expect(campos.cnpj).toBe(CNPJ);
        // Os CST são os MESMOS do F550: lê-los de outro lugar faria o 1900 e o
        // F550 discordarem dentro do mesmo arquivo.
        expect(campos.cstPis).toBe('01');
        expect(campos.cstCofins).toBe('01');
    });

    // ⚠️ Contagem que ninguém fez não vira número.
    it('QUANT_DOC sai VAZIO — não temos os documentos', () => {
        const { campos } = montar1900({ cnpj: CNPJ, receita: RECEITA, codMod: '99', codSit: '00' });
        expect(campos.quantDoc).toBe('');
        expect(campos.cfop).toBe('');
    });

    it('sem receita não há 1900 — bloco sem dados não se inventa', () => {
        expect(montar1900({ cnpj: CNPJ, receita: 0, codMod: '99', codSit: '00' })).toBeNull();
    });
});

describe('🚨 o bloco 1 deixa de sair sempre vazio', () => {
    const dados = (extra: Record<string, unknown> = {}) => ({
        empresa: { cnpj: CNPJ },
        receitaSemDocumento: RECEITA,
        warnings: [] as string[],
        ...extra,
    });

    // ⚠️ `buildLine` já anexa o CRLF (é ele que monta a linha do arquivo, a
    // trava R15 de 21/08) — a asserção compara a linha SEM a quebra.
    const semQuebra = (l: string) => String(l).replace(/\r?\n$/, '');

    it('com cadastro, o 1900 entra e o IND_MOV vira 0', () => {
        const linhas = buildBloco1_Contrib(dados({ contrib1900CodMod: '99', contrib1900CodSit: '00' }));
        expect(semQuebra(linhas[0])).toBe('|1001|0|');
        const l1900 = linhas.find((l: string) => l.startsWith('|1900|'));
        expect(l1900).toBeTruthy();
        expect(l1900).toContain(`|${CNPJ}|`);
        expect(l1900).toContain('21811,34');
        // 1001 + 1900 + 1990 = 3
        expect(semQuebra(linhas[linhas.length - 1])).toBe('|1990|3|');
    });

    // ⚠️ Sem cadastro NÃO sai registro torto — sai aviso, e o aviso aponta um
    // lugar que EXISTE (o campo entrou no modal no mesmo PR).
    it('sem cadastro o bloco fica sem dados E o aviso nomeia a recusa e o lugar', () => {
        const d = dados();
        const linhas = buildBloco1_Contrib(d);
        expect(semQuebra(linhas[0])).toBe('|1001|1|');
        expect(linhas.some((l: string) => l.startsWith('|1900|'))).toBe(false);
        const aviso = (d.warnings as string[]).join(' ');
        expect(aviso).toMatch(/1900/);
        expect(aviso).toMatch(/Dados Fiscais/);
        expect(aviso).toMatch(/PVA/);
    });

    it('sem receita nenhuma, nada muda — bloco 1 segue sem dados e sem aviso', () => {
        const d = dados({ receitaSemDocumento: 0 });
        const linhas = buildBloco1_Contrib(d);
        expect(linhas.map(semQuebra)).toEqual(['|1001|1|', '|1990|2|']);
        expect(d.warnings).toHaveLength(0);
    });
});

// ============================================================================
// A recusa aprendida entra na PREVALIDAÇÃO no MESMO PR — senão a próxima
// empresa gasta a mesma volta de PVA com outro CNPJ.
// ============================================================================
describe('🚨 a prevalidação pega o arquivo REAL da AFFITTARE antes do PVA', () => {
    // As linhas exatas do arquivo que o Paulo mandou em 24/08.
    const ARQUIVO_REAL = [
        '|0000|006|0|||01072026|31072026|AFFITTARE IMOVEIS ADMINISTRACAO LTDA|17213641000127|SP|3550308||00|1|',
        '|F001|0|',
        '|F010|17213641000127|',
        '|F550|21811,34|01|0,00|21811,34|0,65|141,77|01|0,00|21811,34|3,00|654,34|||||',
        '|F990|4|',
        '|1001|1|',
        '|1990|2|',
    ];

    it('acusa o arquivo real, com a recusa literal e o lugar de preencher', () => {
        const { erros } = conferirConsolidacao1900(ARQUIVO_REAL);
        expect(erros).toHaveLength(1);
        expect(erros[0].registro).toBe('1900');
        expect(erros[0].mensagem).toMatch(/F550/);
        expect(erros[0].mensagem).toMatch(/Dados Fiscais/);
        expect(erros[0].fonte).toMatch(/AFFITTARE/);
    });

    it('fica MUDA quando o 1900 está lá', () => {
        const ok = [...ARQUIVO_REAL, '|1900|17213641000127|99|||00|21811,34||01|01||||'];
        expect(conferirConsolidacao1900(ok).erros).toHaveLength(0);
    });

    // ⚠️ Arquivo sem F550 não é assunto dela — acusar seria alarme sobre
    // escrituração correta, que é o que faz a equipe desligar a prevalidação.
    it('fica MUDA no arquivo detalhado, que não tem F550', () => {
        const detalhado = ['|C001|0|', '|C100|0|1|...|', '|1001|1|', '|1990|2|'];
        expect(conferirConsolidacao1900(detalhado).erros).toHaveLength(0);
    });

    it('o F560 conta junto com o F550 — a recusa fala dos dois', () => {
        const comF560 = ['|F560|1000,00|01|', '|1001|1|'];
        expect(conferirConsolidacao1900(comF560).erros).toHaveLength(1);
    });
});
