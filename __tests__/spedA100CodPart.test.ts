// ============================================================================
// 🚨 SERVIÇO TOMADO SEM COD_PART BARRA O ARQUIVO INTEIRO
//
// 03/09, INSTITUTO HAYAY CIENCIA E FE · 08/2026, recibo do PVA:
//   `Total de Erros 1 — "Campo obrigatório na entrada."`
//   `Linha 16 · Campo 4 - COD_PART · Registro A100`
//   `|A100|0|1||00|||23||25082026|25082026|3000,00|0||3000,00|19,50|...`
//
// A NFS-e era um serviço TOMADO que entrou pelo importador de PDF no leiaute
// DANFSe que o leitor não sabe nomear (o caso RADIO E TV SUL AMERICANA, 02/09
// — *"o PDF veio com prestador e tomador VAZIOS"*), e o gerador emitiu a linha
// assim mesmo. **O PVA não importa o arquivo** — é o arquivo inteiro barrado na
// porta por causa de UMA nota, e nada avisava antes.
// ============================================================================
// @ts-expect-error modulo JS puro
import { conferirA100Declaravel, separarDeclaraveisNoBlocoA, avisoDoBlocoASemParticipante } from '../sefaz-backend/sped-a100-declaravel.js';
import { buildBlocoA } from '../sefaz-backend/sped-contrib-blocos.js';
// @ts-expect-error modulo JS puro
import { conferirCodPartDoA100, avisosDaPrevalidacaoContrib } from '../sefaz-backend/sped-contrib-campos.js';

const EMPRESA = { cnpj: '35658906000182', nome: 'INSTITUTO HAYAY CIENCIA E FE S/S LTDA' };

/** A nota REAL do recibo: serviço TOMADO, prestador VAZIO, sem itens. */
const tomadaSemPrestador = (over: any = {}) => ({
    id: 'tomada', tipo: 'NFSe', direcao: 'entrada', numero: '23',
    dataEmissao: '2026-08-25', valorTotal: 3000,
    prestador: { cnpj: '', nome: '' }, tomador: { cnpj: EMPRESA.cnpj, nome: EMPRESA.nome },
    ...over,
});

/** A saída da MESMA competência, que tem participante e sai normalmente. */
const prestada = (over: any = {}) => ({
    id: 'prestada', tipo: 'NFSe', direcao: 'saida', numero: '45',
    dataEmissao: '2026-08-28', valorTotal: 6000,
    itens: [{ nItem: '1', cProd: 'ITEM-1', xProd: 'Servico', vProd: 6000 }],
    tomador: { cnpj: '00621930000162', nome: 'FED NACIONAL COMUNIDADE EVANGELICA SARA NOSSA TERRA' },
    ...over,
});

describe('conferirA100Declaravel — o COD_PART que o PVA cobra na entrada', () => {
    it('entrada sem o CNPJ do prestador NÃO é declarável', () => {
        const r = conferirA100Declaravel(tomadaSemPrestador(), EMPRESA.cnpj);
        expect(r.declaravel).toBe(false);
        expect(r.causa).toBe('entrada-sem-participante');
        expect(r.identificacao).toBe('23');
    });

    it('entrada COM prestador é declarável — a correção não tira nota boa', () => {
        const r = conferirA100Declaravel(
            tomadaSemPrestador({ prestador: { cnpj: '11222333000181', nome: 'PRESTADOR' } }),
            EMPRESA.cnpj,
        );
        expect(r.declaravel).toBe(true);
        expect(r.codPart).toBe('11222333000181');
    });

    // 🚨 A FORMA DO DOCUMENTO NÃO PODE DECIDIR: a NFS-e do portal entra
    // ACHATADA (`cnpjEmit`) e a do PDF em `prestador`. Ler uma forma só foi o
    // defeito de 17/08 (37 A100 da MANTOAN com COD_PART vazio).
    it('lê a forma ACHATADA do portal também', () => {
        const r = conferirA100Declaravel(
            { tipo: 'NFSe', direcao: 'entrada', numero: '7', valorTotal: 100, cnpjEmit: '11.222.333/0001-81' },
            EMPRESA.cnpj,
        );
        expect(r.declaravel).toBe(true);
        expect(r.codPart).toBe('11222333000181');
    });

    // ⚠️ SÓ A ENTRADA ACUSA — a recusa é literal ("na entrada"), e na SAÍDA o
    // campo sai vazio há meses em arquivos que o PVA ACEITOU. Acusar ali seria
    // alarme sobre arquivo correto.
    it('SAÍDA sem participante continua saindo — o PVA aceita', () => {
        const r = conferirA100Declaravel(prestada({ tomador: null }), EMPRESA.cnpj);
        expect(r.declaravel).toBe(true);
    });
});

describe('buildBlocoA — a nota fica FORA e sai NOMEADA', () => {
    const gerar = (notas: any[], regimeApuracao = '2') => {
        const warnings: string[] = [];
        const linhas = buildBlocoA({ empresa: EMPRESA, notas, regimeApuracao, warnings });
        return { linhas, warnings, texto: linhas.join('') };
    };

    it('nenhum A100 sai com COD_PART vazio na entrada', () => {
        const { linhas } = gerar([prestada(), tomadaSemPrestador()]);
        const a100 = linhas.filter((l: string) => l.startsWith('|A100|'));
        expect(a100).toHaveLength(1);
        // A que sobrou é a SAÍDA, com o participante dela.
        expect(a100[0]).toContain('|A100|1|0|00621930000162|');
        // E a linha exata do recibo do PVA não aparece mais.
        expect(linhas.join('')).not.toMatch(/\|A100\|0\|1\|\|/);
    });

    it('e o A170 dela sai junto — registro filho não fica órfão', () => {
        const { linhas } = gerar([prestada(), tomadaSemPrestador()]);
        expect(linhas.filter((l: string) => l.startsWith('|A170|'))).toHaveLength(1);
        expect(linhas.join('')).not.toContain('SERV-GENERICO');
    });

    it('sai NOMEADA no aviso, com a recusa e a ação', () => {
        const { warnings } = gerar([prestada(), tomadaSemPrestador()]);
        const aviso = warnings.find(w => /COD_PART/.test(w));
        expect(aviso).toBeTruthy();
        expect(aviso).toMatch(/nota 23/);
        expect(aviso).toMatch(/Campo obrigatório na entrada/);
        // ⚠️ A ação nomeia ONDE se resolve (achado 18): reimportar o PDF com o
        // CNPJ do prestador — NÃO "confira o cadastro do cliente", que está certo.
        expect(aviso).toMatch(/NFS-e \(PDF\)/);
        expect(aviso).toMatch(/Substituir/);
    });

    // ⚠️ Competência em que TODAS as notas caem aqui sairia com o bloco vazio e
    // sem uma palavra — o defeito com outra roupa.
    it('avisa mesmo quando o bloco A fica sem nenhuma nota', () => {
        const { linhas, warnings } = gerar([tomadaSemPrestador()]);
        expect(linhas.join('')).toContain('|A001|1|');
        expect(warnings.some(w => /COD_PART/.test(w))).toBe(true);
    });

    // 🚨 O REGIME MUDA O QUE SE PERDE: no cumulativo a aquisição não gera
    // crédito (CST 70, zeros), então nada muda de valor. No NÃO-cumulativo ela
    // geraria — e a exclusão declara a MAIOR, o que vai DITO.
    it('no NÃO-cumulativo o aviso diz que o crédito fica de fora', () => {
        const cum = gerar([tomadaSemPrestador()], '2').warnings.join(' ');
        const naoCum = gerar([tomadaSemPrestador()], '1').warnings.join(' ');
        expect(cum).toMatch(/não gera crédito/);
        expect(naoCum).toMatch(/declara a MAIOR/);
    });
});

describe('a regra da prevalidação nasce VERDE e acusa a linha do recibo', () => {
    // A linha LITERAL do recibo do PVA do INSTITUTO HAYAY (linha 16).
    const LINHA_RECUSADA = '|A100|0|1||00|||23||25082026|25082026|3000,00|0||3000,00|19,50|3000,00|90,00||||\r\n';

    it('acusa o A100 de entrada sem COD_PART', () => {
        const r = conferirCodPartDoA100([LINHA_RECUSADA]);
        expect(r.erros).toHaveLength(1);
        expect(r.erros[0].registro).toBe('A100');
        expect(r.erros[0].fonte).toMatch(/Campo obrigatório na entrada/);
    });

    it('fica MUDA na SAÍDA sem COD_PART — arquivo que o PVA aceita', () => {
        expect(conferirCodPartDoA100([
            '|A100|1|0||00|||45||28082026|28082026|6000,00|0||6000,00|39,00|6000,00|180,00||||\r\n',
        ]).erros).toHaveLength(0);
    });

    it('e nasce VERDE sobre o bloco A que o gerador produz hoje', () => {
        const warnings: string[] = [];
        const linhas = buildBlocoA({
            empresa: EMPRESA, notas: [prestada(), tomadaSemPrestador()],
            regimeApuracao: '2', warnings,
        });
        expect(conferirCodPartDoA100(linhas).erros).toHaveLength(0);
        // E ela está LIGADA na prevalidação — regra escrita não é regra ligada.
        expect(avisosDaPrevalidacaoContrib([LINHA_RECUSADA]).some((a: string) => /COD_PART/.test(a))).toBe(true);
    });
});

// ============================================================================
// 🚨 A EXCLUSÃO SUSTENTA O 0200 — a régua de 24/08 (medir o que o registro
// SUSTENTA). Tirar o A100 tira o A170, e o A170 do documento SEM itens é o
// único que referencia o `SERV-GENERICO`: se o coletor do 0200 continuasse a
// declará-lo, o arquivo trocaria esta recusa pela do item ÓRFÃO.
// ============================================================================
describe('🔗 o coletor do 0200 concorda com o bloco A — pelo DONO', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const orq = readFileSync(join(__dirname, '../sefaz-backend/sped-contrib-orchestrator.js'), 'utf8');

    it('o 0200 decide o SERV-GENERICO pelo mesmo dono, não pela lista crua', () => {
        const janela = orq.slice(orq.indexOf('COD_ITEM_SERVICO_GENERICO)'), orq.indexOf('const itens = Array.from'));
        expect(janela).toMatch(/separarDeclaraveisNoBlocoA/);
        // ⚠️ TRAVA POR INTENÇÃO, não pelo texto antigo: a forma literal
        // `filtrarNotasBlocoA(notas).some(...)` ERA o defeito — ela declarava o
        // item sintético de uma nota que o bloco A não emite mais.
        expect(janela).not.toMatch(/filtrarNotasBlocoA\(notas\)\.some/);
    });

    it('e o bloco A lê o MESMO dono', () => {
        const blocos = readFileSync(join(__dirname, '../sefaz-backend/sped-contrib-blocos.js'), 'utf8');
        expect(blocos).toMatch(/separarDeclaraveisNoBlocoA\(/);
        // 📌 E o recorte do COD_PART passou a ser do dono nos DOIS registros —
        // era a terceira cópia de `cnpjCpf || cnpj || CNPJ`.
        expect(blocos).not.toMatch(/participanteRaw\.cnpjCpf/);
        expect((blocos.match(/codPartDoDocumento\(/g) || []).length).toBeGreaterThanOrEqual(2);
    });
});

describe('separarDeclaraveisNoBlocoA', () => {
    it('separa e nomeia, com o nome do prestador quando o documento o traz', () => {
        const r = separarDeclaraveisNoBlocoA([
            prestada(),
            tomadaSemPrestador({ prestador: { cnpj: '', nome: 'PRESTADOR SEM CNPJ' } }),
        ], EMPRESA.cnpj);
        expect(r.declaraveis).toHaveLength(1);
        expect(r.foras).toHaveLength(1);
        expect(avisoDoBlocoASemParticipante(r.foras, '2')).toMatch(/PRESTADOR SEM CNPJ \(nota 23\)/);
    });

    it('lista vazia não gera aviso — alarme sobre arquivo correto desliga a trava', () => {
        expect(avisoDoBlocoASemParticipante([], '2')).toBeNull();
    });
});
