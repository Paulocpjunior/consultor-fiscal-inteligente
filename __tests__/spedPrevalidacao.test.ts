// ============================================================================
// 🚦 O "PVA DE BOLSO" — as recusas do PVA conferidas antes de abrir o PVA.
//
// Paulo, 20/08: *"um dos maiores gargalos que vem consumindo tempo e retrabalho
// é o EFD-ICMS/IPI… evitando o vai e vem o dia todo"*.
//
// Cada caso abaixo é uma recusa REAL, com o cliente e a data. O arquivo da PWR
// 07/2026 (12 erros) e o relatório da PS VIDROS 0896 (187) são o gabarito —
// nenhuma regra aqui foi deduzida de memória.
// ============================================================================
import { prevalidarSpedFiscal, resumoPrevalidacao } from '../sefaz-backend/sped-prevalidacao.js';

const L = (s: string) => s;
/** Chave real da PWR (mod 55) e uma de NFC-e (mod 65). */
const CH55 = '35260731947349000169550010000000031705547508';
const CH65 = '35260707590894000166650203000007870001234567';

const acha = (r: any, regra: string) => r.erros.filter((e: any) => e.regra === regra);

describe('R1 — COD_MOD tem que casar com o modelo da CHAVE', () => {
    it('NFC-e declarada como 55 é acusada, com o nº da nota e a ação', () => {
        const r = prevalidarSpedFiscal([
            L(`|C100|1|0||55|00|203|787|${CH65}|13072026|13072026|17,90|0|||17,90|9||||17,90|3,22||||||||`),
        ]);
        const e = acha(r, 'cod-mod-x-chave');
        expect(e).toHaveLength(1);
        expect(e[0].valor).toBe('55');
        expect(e[0].esperado).toBe('65');
        expect(e[0].mensagem).toMatch(/nº 787/);
        expect(e[0].fonte).toMatch(/O modelo da chave do documento eletrônico não confere/);
    });

    it('coerente não vira erro', () => {
        const r = prevalidarSpedFiscal([
            L(`|C100|1|0|15438711000110|55|00|1|3|${CH55}|13072026|13072026|8562,54|0|0,00||8562,54|9|0,00|0,00|0,00|8562,54|1541,26|0,00|0,00|0,00|55,66|256,87|||`),
            L('|C190|000|5101|18,00|8562,54|8562,54|1541,26|0,00|0,00|0,00|0,00||'),
        ]);
        expect(acha(r, 'cod-mod-x-chave')).toHaveLength(0);
    });
});

describe('R2 — NFC-e não informa COD_PART nem tributos no C100', () => {
    it('acusa exatamente os campos proibidos que vieram preenchidos', () => {
        const r = prevalidarSpedFiscal([
            L(`|C100|1|0|12345678909|65|00|203|787|${CH65}|13072026|13072026|17,90|0|||17,90|9||||17,90|3,22|0,00|0,00|1,50|0,30|1,40|||`),
        ]);
        const e = acha(r, 'nfce-campos-proibidos');
        expect(e).toHaveLength(1);
        expect(e[0].campo).toMatch(/4 - COD_PART/);
        expect(e[0].campo).toMatch(/25 - VL_IPI/);
        expect(e[0].fonte).toMatch(/COD_MOD = 65/);
    });

    it('NFC-e com os campos em branco passa', () => {
        const r = prevalidarSpedFiscal([
            L(`|C100|1|0||65|00|203|787|${CH65}|13072026|13072026|17,90|0|||17,90|9||||17,90|3,22|||||||`),
            L('|C190|000|5102|18,00|17,90|17,90|3,22|0,00|0,00|0,00|0,00||'),
        ]);
        expect(acha(r, 'nfce-campos-proibidos')).toHaveLength(0);
    });
});

describe('R3/R4/R5 — nada de órfão no bloco 0', () => {
    const base = [
        L(`|C100|1|0|15438711000110|55|00|1|3|${CH55}|13072026|13072026|100,00|0|||100,00|9||||100,00|18,00|||||||`),
        L('|C190|000|5101|18,00|100,00|100,00|18,00|0,00|0,00|0,00|0,00||'),
    ];

    it('participante que nenhum C100/D100 referencia é acusado (caso PWR)', () => {
        const r = prevalidarSpedFiscal([
            L('|0150|02235305000108|GLOBAL COMPANY INDUSTRIA LTDA|1058|02235305000108||004|3125101||ROD|S/N||DOS PIRES|'),
            ...base,
        ]);
        const e = acha(r, '0150-orfao');
        expect(e).toHaveLength(1);
        expect(e[0].mensagem).toMatch(/GLOBAL COMPANY/);
        expect(e[0].fonte).toMatch(/Não informar participante/);
    });

    it('participante referenciado não é acusado', () => {
        const r = prevalidarSpedFiscal([
            L('|0150|15438711000110|AC LASER|1058|15438711000110||225|3507605||RUA|400||NUCLEO|'),
            ...base,
        ]);
        expect(acha(r, '0150-orfao')).toHaveLength(0);
    });

    it('item do 0200 sem C170 e unidade do 0190 sem uso (caso PWR, 4 itens)', () => {
        const r = prevalidarSpedFiscal([
            L('|0190|CX|CAIXA|'),
            L('|0200|84814|TELHA EM EPS|||UN|00|39259010||00||||'),
            ...base,
        ]);
        expect(acha(r, '0200-orfao')).toHaveLength(1);
        expect(acha(r, '0190-orfao')).toHaveLength(1);
    });
});

describe('R6 — C100 regular sem C190', () => {
    it('acusa a nota e manda importar o XML completo', () => {
        const r = prevalidarSpedFiscal([
            L(`|C100|0|1|02235305000108|55|00|1|34853|${CH55}|13072026|13072026|100,00|0|||100,00|9||||||||||||`),
            L('|C990|3|'),
        ]);
        const e = acha(r, 'c100-sem-c190');
        expect(e).toHaveLength(1);
        expect(e[0].acao).toMatch(/Reler XMLs guardados|XML completo/);
    });

    it('CANCELADA sai com o C100 sozinho e NÃO é acusada', () => {
        const r = prevalidarSpedFiscal([
            L(`|C100|1|0|15438711000110|55|02|1|9|${CH55}|13072026|13072026|0,00|0|||0,00|9||||||||||||`),
            L('|C990|3|'),
        ]);
        expect(acha(r, 'c100-sem-c190')).toHaveLength(0);
    });
});

describe('R7/R8 — a apuração tem que bater com os C190 (as duas recusas da PWR)', () => {
    // Arquivo da PWR: E110 com 3.459,19 de crédito e NENHUM C190 de entrada;
    // E520 com 2.200,45 de crédito de IPI, idem.
    const pwr = [
        L(`|C100|1|0|15438711000110|55|00|1|3|${CH55}|13072026|13072026|8562,54|0|||8562,54|9||||8562,54|1541,26|||||||`),
        L('|C190|000|5101|18,00|8562,54|8562,54|1541,26|0,00|0,00|0,00|0,00||'),
        L('|E110|6795,83|0,00|0,00|0,00|3459,19|0,00|0,00|0,00|0,00|3336,64|0,00|3336,64|0,00|0,00|'),
        L('|E520|0,00|0,00|2200,45|0,00|0,00|2200,45|0,00|'),
    ];

    it('E110 campo 6 divergente é acusado com os dois números', () => {
        const e = acha(prevalidarSpedFiscal(pwr), 'e110-creditos');
        expect(e).toHaveLength(1);
        expect(e[0].valor).toBe('3459.19');
        expect(e[0].esperado).toBe('0.00');
        expect(e[0].fonte).toMatch(/exceto 1605/);
    });

    it('E520 crédito de IPI divergente idem', () => {
        const e = acha(prevalidarSpedFiscal(pwr), 'e520-credito-ipi');
        expect(e).toHaveLength(1);
        expect(e[0].valor).toBe('2200.45');
        expect(e[0].esperado).toBe('0.00');
    });

    it('com os C190 de entrada no lugar, os dois fecham e ninguém é acusado', () => {
        const r = prevalidarSpedFiscal([
            ...pwr,
            L('|C190|000|2101|12,00|69906,65|28826,58|3459,19|0,00|0,00|0,00|2200,45||'),
        ]);
        expect(acha(r, 'e110-creditos')).toHaveLength(0);
        expect(acha(r, 'e520-credito-ipi')).toHaveLength(0);
    });

    it('CFOP 1605 fica FORA da soma e o 5605 entra — a exceção é literal do PVA', () => {
        const r = prevalidarSpedFiscal([
            L('|C190|000|1605|0,00|100,00|100,00|10,00|0,00|0,00|0,00|0,00||'),
            L('|C190|000|5605|0,00|100,00|100,00|5,00|0,00|0,00|0,00|0,00||'),
            L('|E110|0,00|0,00|0,00|0,00|5,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|'),
        ]);
        expect(acha(r, 'e110-creditos')).toHaveLength(0);
    });
});

describe('R9/R10 — o bloco de IPI e o cadastro', () => {
    const comIpi = [L('|E520|0,00|0,00|100,00|0,00|0,00|100,00|0,00|')];

    it('E520 sem 0002 acusa e manda ao cadastro (o código é de tabela oficial)', () => {
        const e = acha(prevalidarSpedFiscal(comIpi), '0002-ausente');
        expect(e).toHaveLength(1);
        expect(e[0].acao).toMatch(/Classificação do estab. industrial/);
    });

    it('com o 0002 presente, não acusa', () => {
        expect(acha(prevalidarSpedFiscal([L('|0002|01|'), ...comIpi]), '0002-ausente')).toHaveLength(0);
    });

    it('empresa marcada como NÃO contribuinte não pode ter E500 (caso PS VIDROS)', () => {
        const e = acha(prevalidarSpedFiscal(comIpi, { contribuinteIpi: 'nao' }), 'e500-nao-contribuinte');
        expect(e).toHaveLength(1);
        expect(e[0].fonte).toMatch(/não for contribuinte do IPI/);
    });
});

describe('R11/R12/R13 — ST, CFOP e o contabilista', () => {
    it('ST nos C190 sem bloco E200 é acusada com o valor', () => {
        const e = acha(prevalidarSpedFiscal([
            L('|C190|060|5405|0,00|100,00|0,00|0,00|150,00|27,00|0,00|0,00||'),
        ]), 'st-sem-e200');
        expect(e).toHaveLength(1);
        expect(e[0].valor).toBe('27.00');
    });

    it('CFOP fora da tabela em vigor é acusado com a contagem (família 1103/1929)', () => {
        const e = acha(prevalidarSpedFiscal([
            L('|C190|000|1929|0,00|10,00|0,00|0,00|0,00|0,00|0,00|0,00||'),
            L('|C190|000|1929|0,00|10,00|0,00|0,00|0,00|0,00|0,00|0,00||'),
        ]), 'cfop-inexistente');
        expect(e).toHaveLength(1);
        expect(e[0].valor).toBe('1929');
        expect(e[0].mensagem).toMatch(/2 linha\(s\)/);
        expect(e[0].acao).toMatch(/NÃO escolhe o substituto/);
    });

    it('CFOP válido não é acusado', () => {
        expect(acha(prevalidarSpedFiscal([
            L('|C190|000|5102|18,00|10,00|10,00|1,80|0,00|0,00|0,00|0,00||'),
        ]), 'cfop-inexistente')).toHaveLength(0);
    });

    it('0100 sem EMAIL e sem COD_MUN é acusado nos dois campos (caso PWR)', () => {
        const e = acha(prevalidarSpedFiscal([
            L('|0100|Paulo Cesar Pereira Junior|26819016859|1SP238285/O-5|||||||||||'),
        ]), '0100-campos');
        expect(e).toHaveLength(1);
        expect(e[0].campo).toMatch(/13 - EMAIL/);
        expect(e[0].campo).toMatch(/14 - COD_MUN/);
    });

    it('0100 completo passa', () => {
        expect(acha(prevalidarSpedFiscal([
            L('|0100|PAULO|70646236849|SP216809O0|44388152000189|01042001|RUA|221|3 ANDAR|CENTRO|1133371554||spcontabil@sp.com.br|3550308|'),
        ]), '0100-campos')).toHaveLength(0);
    });
});

describe('o resultado é acionável, não um número solto', () => {
    it('arquivo limpo diz que está limpo', () => {
        // 🐛 FIXTURE TROCADA (29/08): a linha antiga tinha **16** campos e o
        // 0000 tem 15 — ela descrevia um arquivo que o PVA recusaria, e a
        // trava de contagem (R42) a pegou no dia em que nasceu. Este é o
        // 0000 que o `buildBloco0` de fato emite.
        const r = prevalidarSpedFiscal([L('|0000|020|0|01072026|31072026|X|123||SP|1|3550308|||A|0|')]);
        expect(r.erros).toHaveLength(0);
        expect(r.resumo).toMatch(/Nenhuma das recusas/);
        expect(resumoPrevalidacao(r)).toEqual([]);
    });

    it('cada erro carrega registro, campo, mensagem, ação e FONTE', () => {
        const r = prevalidarSpedFiscal([
            L(`|C100|1|0||55|00|203|787|${CH65}|13072026|13072026|17,90|0|||17,90|9||||17,90|3,22|||||||`),
        ]);
        for (const e of r.erros) {
            expect(e.registro).toBeTruthy();
            expect(e.campo).toBeTruthy();
            expect(e.mensagem.length).toBeGreaterThan(20);
            expect(e.acao.length).toBeGreaterThan(20);
            // Regra sem fonte é chute com cara de validação. As duas fontes
            // legítimas são a recusa LITERAL do PVA e a citação do Guia Prático
            // — nunca memória.
            expect(e.fonte).toMatch(/PVA:|Guia Prático/);
        }
        expect(resumoPrevalidacao(r)[0]).toMatch(/Pré-validação/);
    });
});

// ═══════════════════════════════════════════════════════════════════════════
// R14 — VL_DOC do C100 tem que fechar com a Σ VL_OPR dos C190 filhos.
//
// Guia Prático 3.2.3, C100 Campo 12: em 2026 os dois têm que bater. Foi esta
// igualdade que denunciou o VL_OPR sem o IPI (PWR, 20/08): o livro somava
// 71.960,81 e o relatório do PVA, 69.760,36 — a diferença era o IPI.
//
// ⚠️ O PVA NÃO RECUSA por isso, só imprime um total menor. É por isso que a
// regra tem que morar aqui: erro que o validador aceita é o que sai do
// escritório e só aparece na fiscalização.
// ═══════════════════════════════════════════════════════════════════════════
describe('R14 — C100 VL_DOC × Σ VL_OPR dos C190', () => {
    /** Os números reais da PWR 07/2026, agregados. */
    const c100 = (vlDoc: string, codSit = '00') =>
        L(`|C100|0|1|15438711000110|55|${codSit}|001|3|${CH55}|13072026|13072026|${vlDoc}|0|0,00||69760,36|9|0,00|0,00|0,00|69760,36|3459,19|0,00|0,00|2200,45|0,00|0,00|||`);
    const c190 = (vlOpr: string) => L(`|C190|000|1102|4,96|${vlOpr}|69760,36|3459,19|0,00|0,00|0,00|2200,45||`);

    it('acusa quando o VL_OPR esquece o IPI — e nomeia a diferença', () => {
        const r = prevalidarSpedFiscal([c100('71960,81'), c190('69760,36')]);
        const e = acha(r, 'c100-x-c190-vl-opr');
        expect(e).toHaveLength(1);
        expect(e[0].valor).toBe('71960.81');
        expect(e[0].esperado).toBe('69760.36');
        expect(e[0].mensagem).toMatch(/2200\.45/);
        expect(e[0].acao).toMatch(/não é a soma dos vProd/);
        expect(e[0].fonte).toMatch(/Guia Prático EFD ICMS\/IPI 3\.2\.3/);
    });

    it('com o IPI dentro, não acusa nada', () => {
        expect(acha(prevalidarSpedFiscal([c100('71960,81'), c190('71960,81')]), 'c100-x-c190-vl-opr'))
            .toHaveLength(0);
    });

    it('centavo de arredondamento entre grupos não vira alarme', () => {
        const r = prevalidarSpedFiscal([c100('71960,81'), c190('71960,80')]);
        expect(acha(r, 'c100-x-c190-vl-opr')).toHaveLength(0);
    });

    it('CANCELADA não é comparada — ela sai sem filhos e com VL_DOC vazio', () => {
        const r = prevalidarSpedFiscal([L(`|C100|0|1||55|02|001|9|${CH55}|||||||||||||||||||`)]);
        expect(acha(r, 'c100-x-c190-vl-opr')).toHaveLength(0);
    });

    it('nota SEM nenhum C190 é a R6 — um defeito não gera dois alarmes', () => {
        const r = prevalidarSpedFiscal([c100('71960,81')]);
        expect(acha(r, 'c100-x-c190-vl-opr')).toHaveLength(0);
        expect(acha(r, 'c100-sem-c190')).toHaveLength(1);
    });

    it('os C190 são somados por NOTA, não no arquivo inteiro', () => {
        // Duas notas: a primeira fecha, a segunda não. Somar tudo junto faria
        // as duas se compensarem e o defeito passaria.
        const r = prevalidarSpedFiscal([
            c100('71960,81'), c190('71960,81'),
            c100('69760,36'), c190('67559,91'),
        ]);
        expect(acha(r, 'c100-x-c190-vl-opr')).toHaveLength(1);
    });
});

// ─── A TRAVA: a rota que gera o arquivo TEM que rodar isto ──────────────────
describe('🚨 núcleo sem leitor não protege', () => {
    const fonte = require('fs').readFileSync(
        require('path').resolve(__dirname, '../sefaz-backend/sped-fiscal-routes.js'), 'utf8',
    );

    it('a rota do SPED Fiscal pré-valida o arquivo e devolve no header', () => {
        expect(fonte).toMatch(/prevalidarSpedFiscal\(linhasDoArquivo/);
        expect(fonte).toMatch(/X-SPED-Prevalidacao/);
    });

    it('e o resultado entra nos warnings, que é onde a pessoa lê', () => {
        expect(fonte).toMatch(/resumoPrevalidacao\(prevalidacao\)/);
    });

    it('confere as LINHAS do arquivo, nunca o objeto em memória', () => {
        // Auditar a intenção foi o que deixou o C100 sair com modelo 55 e
        // chave 65 sem nenhum teste acusar.
        expect(fonte).toMatch(/const linhasDoArquivo = txt\.split/);
    });
});

describe('R15 — linha malformada: tudo no arquivo é |REG|…| (caso REALITY 0899)', () => {
    // A linha REAL do arquivo gerado em 21/08: E200/E210 de 4 UFs + E500
    // GRUDADOS, sem o | inicial e sem quebra — invisíveis para o PVA, para o
    // 9900 e para a própria prevalidação.
    const grudada = 'E200|MG|01072026|31072026|E210|1|0,00|0,00|0,00|0,00|0,00|2,03|0,00|0,00|0,00|0,00|2,03'
        + '|0,00|0,00|E200|SP|01072026|31072026||E500|0|01072026|31072026|';

    it('a linha grudada da REALITY vira ERRO nomeado', () => {
        const r = prevalidarSpedFiscal([L('|E110|0,00|'), L(grudada)]);
        const e = acha(r, 'linha-malformada');
        expect(e).toHaveLength(1);
        expect(e[0].mensagem).toContain('grudado');
        expect(e[0].acao).toContain('defeito de GERAÇÃO');
    });

    it('linha sem o | final também é acusada; linha bem formada passa', () => {
        const r = prevalidarSpedFiscal([L('|E110|0,00|'), L('|E200|MG|01072026|31072026')]);
        expect(acha(r, 'linha-malformada')).toHaveLength(1);
        const ok = prevalidarSpedFiscal([L('|E200|MG|01072026|31072026|')]);
        expect(acha(ok, 'linha-malformada')).toHaveLength(0);
    });
});
