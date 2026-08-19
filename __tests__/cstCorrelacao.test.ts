/**
 * cstCorrelacao — o CST segue o CFOP escriturado.
 *
 * Paulo, 18/08: *"adiciona o CST para validarmos a operação. Exemplo do consumo:
 * a nota vai vir 5102/5101, vamos registrar como 1556. Aí que está a chave do
 * SPED: o CST do fornecedor vai vir como 00, temos que indicar 90 para essas
 * operações."*
 *
 * É a mesma assimetria do CFOP, um campo adiante — a nota é do FORNECEDOR.
 */
// @ts-ignore — módulo JS do backend
import {
    cstDoLancamento, partesDoCst, resumirCst, CST_POR_DESTINO, DESTINOS_SEM_DECISAO,
    validarCstEscriturado,
// @ts-ignore
} from '../sefaz-backend/cst-correlacao.js';

describe('partesDoCst aceita as duas formas do XML', () => {
    it('2 dígitos assume origem nacional; 3 dígitos separam origem e tributação', () => {
        expect(partesDoCst('00')).toEqual({ origem: '0', tributacao: '00' });
        expect(partesDoCst('000')).toEqual({ origem: '0', tributacao: '00' });
        expect(partesDoCst('100')).toEqual({ origem: '1', tributacao: '00' });
        expect(partesDoCst('060')).toEqual({ origem: '0', tributacao: '60' });
    });

    it('sem CST não inventa nada', () => {
        expect(partesDoCst('')).toBeNull();
        expect(partesDoCst(null)).toBeNull();
        expect(partesDoCst('abc')).toBeNull();
    });
});

describe('o caso do Paulo: 5102 escriturado como 1556', () => {
    it('CST 00 do fornecedor vira 090 na entrada de uso/consumo', () => {
        const r = cstDoLancamento('00', '1556');
        expect(r.situacao).toBe('convertido');
        expect(r.cst).toBe('090');
        expect(r.motivo).toMatch(/é o do FORNECEDOR/);
    });

    it('vale para as três faixas — 1556, 2556 e 3556 têm o mesmo destino', () => {
        for (const cfop of ['1556', '2556', '3556']) {
            expect(cstDoLancamento('000', cfop).cst).toBe('090');
        }
    });

    it('e para a transferência de material de uso/consumo (1557)', () => {
        expect(cstDoLancamento('00', '1557').cst).toBe('090');
    });

    it('CST 20 (base reduzida) é a mesma operação — também converte', () => {
        expect(cstDoLancamento('020', '1556').cst).toBe('090');
    });
});

describe('🚨 a origem da mercadoria NÃO é apagada', () => {
    it('produto importado (origem 1) vira 190, nunca 090', () => {
        const r = cstDoLancamento('100', '1556');
        expect(r.cst).toBe('190');
        // Escrever '090' afirmaria dentro do SPED que um produto importado é
        // nacional — a origem é fato da MERCADORIA, não da operação.
        expect(r.cst).not.toBe('090');
    });

    it('todas as origens da Tabela A sobrevivem à conversão', () => {
        for (const o of ['0', '1', '2', '3', '4', '5', '6', '7', '8']) {
            expect(cstDoLancamento(`${o}00`, '1556').cst).toBe(`${o}90`);
        }
    });
});

describe('o que a régua se RECUSA a converter', () => {
    it('CST que já declara um fato próprio é MANTIDO e dito', () => {
        // 60 = ST cobrada anteriormente. Vira 90 e o livro perde justamente a
        // informação que ele precisa ter.
        for (const cst of ['040', '041', '050', '051', '060', '070']) {
            const r = cstDoLancamento(cst, '1556');
            expect(r.situacao).toBe('preservado-por-situacao');
            expect(r.cst).toBe(cst);
            expect(r.motivo).toMatch(/apagaria/);
        }
    });

    it('CSOSN do Simples não pertence a esta tabela', () => {
        // 102 = Simples sem permissão de crédito. Converter misturaria tabelas.
        expect(cstDoLancamento('102', '1556').situacao).toBe('preservado-por-situacao');
    });

    // ⚠️ ESTE TESTE FOI TROCADO EM 18/08, e a troca é o registro da decisão.
    //
    // A 1ª versão exigia que o ativo NÃO convertesse e voltasse como pergunta —
    // era o comportamento certo enquanto ninguém tinha decidido, porque no ativo
    // existe crédito de ICMS por CIAP e no uso/consumo não existe crédito nenhum.
    // Perguntado, Paulo respondeu **"Sim, CST 90"**. Premissa em aberto fechada
    // por decisão do dono — não por dedução minha.
    it('ATIVO (1551/1552) converte também — decisão do Paulo, 18/08', () => {
        expect(cstDoLancamento('000', '1551').cst).toBe('090');
        expect(cstDoLancamento('000', '2551').cst).toBe('090');
        expect(cstDoLancamento('000', '1552').cst).toBe('090');
        expect(cstDoLancamento('000', '1551').situacao).toBe('convertido');
        // A origem continua intocada aqui também.
        expect(cstDoLancamento('100', '1551').cst).toBe('190');
    });

    it('a fila de "sem decisão" continua de pé para a PRÓXIMA família', () => {
        // Hoje está vazia. O mecanismo fica porque é assim que uma família nova
        // deve entrar: nomeada e contada, nunca convertida por dedução.
        expect(Object.keys(DESTINOS_SEM_DECISAO)).toHaveLength(0);
    });

    it('CFOP de mercadoria comum não é tocado', () => {
        for (const cfop of ['1101', '1102', '1403', '2102']) {
            const r = cstDoLancamento('000', cfop);
            expect(r.situacao).toBe('preservado');
            expect(r.cst).toBe('000');
        }
    });

    it('SAÍDA nunca converte — é a nota que o cliente emitiu', () => {
        expect(cstDoLancamento('000', '5556').situacao).toBe('preservado');
        expect(cstDoLancamento('000', '5102').situacao).toBe('preservado');
    });

    it('item sem CST não recebe CST deduzido do CFOP', () => {
        const r = cstDoLancamento('', '1556');
        expect(r.situacao).toBe('sem-cst');
        expect(r.cst).toBeNull();
        expect(r.motivo).toMatch(/não é deduzido do CFOP/);
    });
});

describe('cada entrada da tabela carrega a FONTE', () => {
    it('nenhum de-para foi escrito de memória', () => {
        for (const k of Object.keys(CST_POR_DESTINO)) {
            expect(String((CST_POR_DESTINO as any)[k].fonte).length).toBeGreaterThan(30);
        }
    });
});

describe('resumo com a causa junto do número', () => {
    it('conta o que converteu e transforma o resto em UMA pergunta', () => {
        const r = resumirCst([
            { cst: '000', cfop: '1556' },
            { cst: '000', cfop: '1556' },
            { cst: '000', cfop: '1551' },   // ativo — agora também converte
            { cst: '000', cfop: '1551' },
            { cst: '000', cfop: '1551' },
            { cst: '060', cfop: '1556' },   // ST já cobrada: preservado e dito
            { cst: '', cfop: '1556' },      // sem CST: nomeado, nunca deduzido
        ]);
        expect(r.convertidos).toBe(5);
        const avisos = r.avisos.join(' | ');
        expect(avisos).toMatch(/1 item\(ns\) reclassificado\(s\) \(uso\/consumo ou ativo\) vieram com CST que não é 00\/20/);
        expect(avisos).toMatch(/1 item\(ns\) sem CST/);
    });

    it('nada a dizer não vira aviso', () => {
        expect(resumirCst([{ cst: '000', cfop: '1102' }]).avisos).toHaveLength(0);
        expect(resumirCst([]).avisos).toHaveLength(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// A TRAVA DOS LEITORES — campo que só a tela honra faria o SPED sair com o
// CST velho, e a conferência daria certo. Mesma regra do cfopPorNota.
// ═══════════════════════════════════════════════════════════════════════════
import * as fs from 'fs';
import * as path from 'path';

describe('o SPED honra o CST escriturado', () => {
    const blocoC = fs.readFileSync(
        path.resolve(__dirname, '../sefaz-backend/sped-fiscal-blocoC.js'), 'utf8',
    );

    it('C170 e C190 passam pela régua — 2 chamadas, nenhuma a menos', () => {
        // A DEFINIÇÃO da função casa com o mesmo texto — só as CHAMADAS contam.
        // ⚠️ A função local chama-se `cstDoItemNoArquivo` de propósito: dar a
        // ela o mesmo nome do CAMPO do documento (`cstEscriturado`) é o começo
        // de duas respostas divergentes — a lição de 18/08.
        const chamadas = blocoC.match(/(?<!function )cstDoItemNoArquivo\(item, /g) || [];
        expect(chamadas).toHaveLength(2);
        expect(blocoC).toContain("import { cstDoLancamento } from './cst-correlacao.js'");
    });

    it('e as duas recebem o DOCUMENTO — sem ele o CST informado na NF não seria honrado', () => {
        // Campo que só a tela honra é pior que não ter campo: a conferência
        // daria certo e o SPED sairia com o CST velho (trava dos LEITORES).
        // A definição casa com o mesmo texto — o lookbehind deixa só as CHAMADAS.
        const chamadas = blocoC.match(/(?<!function )cstDoItemNoArquivo\(item, [^)]*, nota\)/g) || [];
        expect(chamadas).toHaveLength(2);
        expect(blocoC).toMatch(/cstDoLancamento\(cru, cfopLancado, nota\?\.cstEscriturado\)/);
    });

    it('nenhum dos dois volta a formatar o CST cru por conta própria', () => {
        // Era esta linha, duplicada, que existia antes em C170 e C190.
        expect(blocoC).not.toMatch(/const cstFmt = cst\.length === 2/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 O CST INFORMADO NA NOTA — e a armadilha da ORIGEM.
//
// Paulo, 19/08: *"teria a possibilidade de ajustarmos o CST…?"*. O campo é a
// TRIBUTAÇÃO (2 dígitos): a origem mora no 1º dígito e é fato da MERCADORIA.
// Gravar "090" cru faria todo produto IMPORTADO virar NACIONAL no SPED.
// ═══════════════════════════════════════════════════════════════════════════
describe('CST informado por nota', () => {
    it('vence a régua e PRESERVA a origem do item', () => {
        // Item importado (origem 1) com tributação 00; a pessoa informa 90.
        const r = cstDoLancamento('100', '1102', '90');
        expect(r.cst).toBe('190');           // origem 1 preservada
        expect(r.situacao).toBe('informado');
        expect(r.motivo).toMatch(/origem 1 preservada/);
    });

    it('nacional idem — 000 + informado 40 = 040', () => {
        expect(cstDoLancamento('000', '1102', '40').cst).toBe('040');
    });

    it('3 dígitos digitados valem a TRIBUTAÇÃO, nunca a origem digitada', () => {
        // Digitar "090" num item IMPORTADO não pode nacionalizar o produto.
        expect(cstDoLancamento('100', '1102', '090').cst).toBe('190');
    });

    it('sem CST no item não dá para montar o informado (a origem não se deduz)', () => {
        const r = cstDoLancamento(null, '1102', '90');
        expect(r.cst).toBeNull();
        expect(r.situacao).toBe('sem-cst');
        expect(r.motivo).toMatch(/origem é o 1º dígito e não se deduz/);
    });

    it('vazio devolve a nota à régua automática', () => {
        expect(cstDoLancamento('000', '1556', '').situacao).toBe('convertido');
    });
});

describe('validarCstEscriturado — campo fiscal digitado tem trava', () => {
    it('aceita tributação da Tabela B', () => {
        expect(validarCstEscriturado('90')).toEqual({ ok: true, cst: '90' });
        expect(validarCstEscriturado('090')).toEqual({ ok: true, cst: '90' });
        expect(validarCstEscriturado('00')).toEqual({ ok: true, cst: '00' });
    });

    it('vazio é RESPOSTA (volta para a régua), não erro', () => {
        expect(validarCstEscriturado('')).toEqual({ ok: true, cst: '' });
    });

    it('recusa tributação que não existe, dizendo quais valem', () => {
        const r = validarCstEscriturado('99') as any;
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/não existe na Tabela B/);
        expect(r.motivo).toMatch(/00, 10, 20/);
    });

    it('recusa tamanho torto explicando que a origem não se digita', () => {
        const r = validarCstEscriturado('9') as any;
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/ORIGEM da mercadoria/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// A TELA E O ARQUIVO PELA MESMA RÉGUA — e o caminho na interface no mesmo PR.
// Campo novo sem tela é código morto; tela que recalcula é a divergência de
// 12/08 (o modal mostrando 1405 enquanto o arquivo gravava 1403).
// ═══════════════════════════════════════════════════════════════════════════
describe('🚨 o CST informado tem caminho na tela e nenhuma conta própria', () => {
    const tela = fs.readFileSync(
        path.resolve(__dirname, '../components/Relatorios/index.tsx'), 'utf8',
    );
    const service = fs.readFileSync(
        path.resolve(__dirname, '../services/cstEscrituradoService.ts'), 'utf8',
    );

    it('a aba ✏️ CFOP por nota grava pelo service e mostra o campo', () => {
        expect(tela).toMatch(/gravarCstEscriturado\(\{/);
        expect(tela).toMatch(/CST informado/);
    });

    it('a tela passa o informado para a MESMA régua do arquivo', () => {
        expect(tela).toMatch(/cstDoLancamento\(/);
        expect(tela).toMatch(/cstEscriturado/);
    });

    it('a gravação valida pela régua do backend, não por regex da tela', () => {
        expect(service).toMatch(/validarCstEscriturado/);
        expect(service).toMatch(/cst-correlacao\.js/);
    });

    it('e o carimbo de quem informou é obrigatório', () => {
        expect(service).toMatch(/cstEscrituradoPor/);
        expect(service).toMatch(/cstEscrituradoEm/);
        expect(service).toMatch(/Sessão sem usuário identificado/);
    });

    it('🔎 ver a nota: link só aparece com chave de 44 dígitos', () => {
        expect(tela).toMatch(/l\.chave\.length === 44/);
        expect(tela).toMatch(/nfe\.fazenda\.gov\.br/);
    });
});
