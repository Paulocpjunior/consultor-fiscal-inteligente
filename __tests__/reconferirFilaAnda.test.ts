// ============================================================================
// 🚨 "RODE DE NOVO PARA CONTINUAR" — E A RODADA REFAZIA A MESMA FATIA.
//
// Paulo, 20/08 (MV LIDER 639 · 07/2026): *"não mudou! já tínhamos dado como
// ajustada"*. A tela mostrava 20 notas `[indeterminado]` com **cStat 640** e,
// logo abaixo, *"a rodada parou em 60 de 162 — rode de novo para continuar,
// são 3 rodadas"*.
//
// Dois defeitos somados, e os dois deixavam a ferramenta parecendo quebrada:
//
// 1. **A FILA NÃO ANDAVA.** Só a nota CANCELADA era carimbada, então a seleção
//    não tinha como saber quem já havia sido perguntada — ordenava por número,
//    cortava no teto e devolvia exatamente as MESMAS 60, rodada após rodada.
//    A promessa de progresso era do app, e ele não a cumpria.
//
// 2. **cStat 640 NÃO É SILÊNCIO, É RESPOSTA.** Em 18/08, nesta MESMA empresa e
//    com o MESMO certificado (o do escritório, que não é parte de nenhum
//    daqueles documentos), três chaves canceladas voltaram **653**. Ou seja, a
//    SEFAZ informa o cancelamento ANTES de barrar por permissão. Se ela barrou
//    por permissão (640), não havia cancelamento a informar.
// ============================================================================
import {
    selecionarParaReconferir, lerRespostaCancelamento, resumirReconferencia,
} from '../sefaz-backend/reconferir-cancelamento.js';
import * as fs from 'fs';
import * as path from 'path';

const CH55 = (n: number) => `3526073194734900016955001${String(n).padStart(9, '0')}1705547508`;
const saida = (numero: number, over: any = {}) => ({
    id: `d${numero}`, chave: CH55(numero), numero, direcao: 'saida',
    status: 'autorizado', valorTotal: 100, ...over,
});
const opts = (limite: number) => ({
    jaCancelado: () => false,
    direcaoEfetiva: (d: any) => d.direcao,
    limite,
    conferidaEm: (d: any) => Number(d?.reconferenciaSefazEm) || 0,
});

describe('🚨 a fila ANDA — quem nunca foi perguntada vem primeiro', () => {
    const docs = [3736, 3737, 3738, 3739].map((n) => saida(n));

    it('sem carimbo nenhum, a ordem é por número (a conferência segue o talão)', () => {
        const s = selecionarParaReconferir(docs, opts(2));
        expect(s.aConsultar.map((x: any) => x.numero)).toEqual([3736, 3737]);
        expect(s.nuncaConferidas).toBe(4);
    });

    it('🚨 na rodada seguinte vêm as OUTRAS — era isto que não acontecia', () => {
        const depois = docs.map((d) => (d.numero < 3738 ? { ...d, reconferenciaSefazEm: 1_000 } : d));
        const s = selecionarParaReconferir(depois, opts(2));
        expect(s.aConsultar.map((x: any) => x.numero)).toEqual([3738, 3739]);
        expect(s.nuncaConferidas).toBe(2);
    });

    it('com todas já perguntadas, volta pelas MAIS ANTIGAS — não some da fila', () => {
        // Nota válida hoje pode ser cancelada amanhã: exclusão definitiva seria
        // trocar um defeito por outro.
        const todas = [
            saida(3736, { reconferenciaSefazEm: 5_000 }),
            saida(3737, { reconferenciaSefazEm: 1_000 }),
            saida(3738, { reconferenciaSefazEm: 3_000 }),
        ];
        const s = selecionarParaReconferir(todas, opts(2));
        expect(s.aConsultar.map((x: any) => x.numero)).toEqual([3737, 3738]);
        expect(s.nuncaConferidas).toBe(0);
    });

    it('o aviso diz quantas AINDA nunca foram perguntadas — descontando a própria rodada', () => {
        // 21/08 (MV LIDER): a seleção conta ANTES de consultar, e o texto dizia
        // o número velho ("102") com o cabeçalho da tela já mostrando o novo
        // ("82"). O aviso fala do DEPOIS: nunca-perguntadas − consultadas.
        const s = selecionarParaReconferir(docs, opts(2));
        const r = resumirReconferencia({ selecao: s, resultados: [{ situacao: 'nao-cancelada' }] });
        expect(r.avisos.join(' ')).toMatch(/Depois desta rodada, 3 nota\(s\) ainda nunca foram perguntadas/);
    });

    it('e quando todas já foram, ele DIZ que a fila volta nas mais antigas', () => {
        const todas = [3736, 3737, 3738].map((n) => saida(n, { reconferenciaSefazEm: n }));
        const s = selecionarParaReconferir(todas, opts(2));
        const r = resumirReconferencia({ selecao: s, resultados: [{ situacao: 'nao-cancelada' }] });
        expect(r.avisos.join(' ')).toMatch(/volta nas mais antigas/);
    });
});

describe('🚨 cStat 640 é RESPOSTA, não silêncio', () => {
    const resp640 = {
        cStat: '640',
        xMotivo: 'Rejeicao: CNPJ/CPF do interessado nao possui permissao para consultar esta NF-e',
        xmls: [],
    };

    it('a nota fica NÃO CANCELADA, com a prova de 18/08 citada no motivo', () => {
        const r = lerRespostaCancelamento(resp640);
        expect(r.situacao).toBe('nao-cancelada-por-recusa');
        expect(r.motivo).toMatch(/653/);
        expect(r.motivo).toMatch(/NÃO está cancelada/);
    });

    it('⚠️ mas NÃO se funde com a prova positiva — o nome e a contagem são outros', () => {
        // Lá a SEFAZ entregou o documento e nós lemos que não há evento; aqui a
        // prova é NEGATIVA (ela não disse 653). Fundir apagaria a diferença.
        const r = resumirReconferencia({
            selecao: { total: 2 },
            resultados: [
                lerRespostaCancelamento(resp640),
                lerRespostaCancelamento({ cStat: '138', xmls: [{ xml: '<nfeProc><infNFe/></nfeProc>' }] }),
            ],
        });
        expect(r.naoCanceladasPorRecusa).toBe(1);
        expect(r.naoCanceladas).toBe(1);
        expect(r.indeterminadas).toBe(0);
        expect(r.avisos.join(' ')).toMatch(/recusou por PERMISSÃO/);
    });

    it('640 com xMotivo de OUTRA coisa continua indeterminado (corrobora pelo texto)', () => {
        // Um cStat isolado pode ser reaproveitado por uma NT futura — a mesma
        // trava que o 653 já tinha.
        const r = lerRespostaCancelamento({ cStat: '640', xMotivo: 'Rejeicao: outra coisa qualquer', xmls: [] });
        expect(r.situacao).toBe('indeterminado');
    });

    it('e a SEFAZ calada continua indeterminada — silêncio nunca vira resposta', () => {
        expect(lerRespostaCancelamento({ erro: 'timeout' }).situacao).toBe('indeterminado');
        expect(lerRespostaCancelamento({ cStat: '137', xmls: [] }).situacao).toBe('indeterminado');
    });
});

// ─── A TRAVA: núcleo sem o carimbo do lado não faz a fila andar ──────────────
describe('🚨 a rota tem que CARIMBAR e tem que LER o carimbo', () => {
    const rota = fs.readFileSync(
        path.resolve(__dirname, '../sefaz-backend/conferencia-chaves-routes.js'), 'utf8',
    );

    it('carimba TODA nota perguntada, não só a cancelada — pela gravação ÚNICA', () => {
        // 21/08: a escrita mudou de casa (cancelamento-gravacao.js) para o 🔎
        // Consultar NFe por chave gravar o MESMO evento — era a rota que via o
        // cStat 653 e não gravava nada (o "erro persistente" da MV LIDER).
        expect(rota).toMatch(/carimbarPerguntaSefaz\(\{ db, docId: alvo\.id/);
        const gravacao = fs.readFileSync(
            path.resolve(__dirname, '../sefaz-backend/cancelamento-gravacao.js'), 'utf8',
        );
        expect(gravacao).toMatch(/reconferenciaSefazEm: Date\.now\(\)/);
        // E o 🔎 usa a MESMA gravação — segunda cópia é como as duas divergem.
        const sync = fs.readFileSync(
            path.resolve(__dirname, '../sefaz-backend/sync-routes.js'), 'utf8',
        );
        expect(sync).toMatch(/gravarCancelamentoConfirmado\(/);
        expect(sync).toMatch(/from '\.\/cancelamento-gravacao\.js'/);
    });

    it('e passa o carimbo para a seleção — senão a ordem nova não vale nada', () => {
        expect(rota).toMatch(/conferidaEm: \(d\) => Number\(d\?\.reconferenciaSefazEm\)/);
    });

    it('🚨 o campo entra no .select() — campo fora da projeção some da leitura', () => {
        // A mesma armadilha que já sumiu com a contraparte dos participantes:
        // sem isto o carimbo é gravado e nunca lido, e a fila volta a repetir.
        // Recorta a projeção DESTA rota (a que alimenta selecionarParaReconferir),
        // não a primeira do arquivo — há outras rotas com .select() antes.
        const fim = rota.indexOf('selecionarParaReconferir(docs');
        const ini = rota.lastIndexOf(".select('chave'", fim);
        expect(rota.slice(ini, fim)).toMatch(/reconferenciaSefazEm/);
    });
});
