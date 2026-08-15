// ============================================================================
// NOTA DIGITADA — a terceira porta, no MESMO trilho dos XMLs.
//
// Paulo, 15/08: *"importação de XML — automática ou manual — tem a mesma
// finalidade: abastecer o sistema de lançamentos para que possam ser atendidas
// as obrigações, relatórios, guias. Até mesmo o lançamento de uma nota de
// forma manual, devemos poder fazer."*
//
// ═══ A RÉGUA QUE ESTES TESTES MAIS PROTEGEM: XML VENCE DIGITAÇÃO ════════════
//
// A digitada é o RETRATO que a pessoa fez do documento; o XML é o documento.
// Sem a régua nos DOIS lados, a digitada de hoje travaria como "duplicado" o
// XML verdadeiro de amanhã — a mesma família da lápide que travava a
// reimportação (14/08), só que criada por nós mesmos no dia do lançamento.
// ============================================================================
import {
    validarNotaDigitada, montarNotaDigitada, idNotaDigitada, podeGravarSobre,
    type NotaDigitadaInput,
} from '../services/notaDigitada';
import { decidirGravacaoNFe } from '../sefaz-backend/xml-importer.js';
import { procedenciaDoDocumento } from '../services/documentoProcedencia';
import { classificarNota } from '../sefaz-backend/dipam-produtor-rural.js';

const CHAVE = '3'.repeat(44);
const base = (over: Partial<NotaDigitadaInput> = {}): NotaDigitadaInput => ({
    empresaId: 'emp1',
    empresaCnpj: '29.240.822/0001-21',
    empresaNome: 'NOVA ERA',
    direcao: 'entrada',
    numero: '4512',
    serie: '1',
    dhEmi: '2026-07-10',
    participanteNome: 'FORNECEDOR X',
    participanteDoc: '11.222.333/0001-81',
    participanteUf: 'SP',
    valorTotal: 1500,
    itens: [{ cfop: '1102', vProd: 1500 }],
    digitadaPorEmail: 'colab@spassessoriacontabil.com.br',
    ...over,
});

describe('validação: erros em português, com a ação', () => {
    it('nota completa passa', () => {
        expect(validarNotaDigitada(base())).toEqual([]);
    });

    it('valor não tem default — ausente é recusa, não zero', () => {
        expect(validarNotaDigitada(base({ valorTotal: null })).join(' ')).toMatch(/valor total/i);
    });

    it('CFOP de SAÍDA numa entrada é barrado COM a explicação da correlação', () => {
        // O erro clássico: digitar o 5102 do fornecedor. A mensagem ensina que
        // na entrada se lança o CFOP da ESCRITURAÇÃO.
        const erros = validarNotaDigitada(base({ itens: [{ cfop: '5102', vProd: 100 }] }));
        expect(erros.join(' ')).toMatch(/5102 é de SAÍDA/);
        expect(erros.join(' ')).toMatch(/vira 1102/);
    });

    it('chave incompleta é recusada dizendo QUANTOS dígitos vieram', () => {
        const erros = validarNotaDigitada(base({ chave: '123' }));
        expect(erros.join(' ')).toMatch(/44 dígitos.*tem 3/);
    });

    it('entrada sem fornecedor explica ONDE isso morde (DIPAM)', () => {
        expect(validarNotaDigitada(base({ participanteNome: '' })).join(' ')).toMatch(/fornecedor indefinido/i);
    });
});

describe('a nota digitada tem a MESMA forma que o importer grava', () => {
    it('campos chatos E aninhados — metade dos leitores lê cada forma', () => {
        const d: any = montarNotaDigitada(base());
        expect(d.cnpjEmit).toBe('11222333000181');
        expect(d.emitente.cnpjCpf).toBe('11222333000181');
        expect(d.cnpjDest).toBe('29240822000121');
        expect(d.competencia).toBe('2026-07');
        expect(d.valorTotal).toBe(1500);
        expect(d.totais.vNF).toBe(1500);
        expect(d.itens[0]).toMatchObject({ nItem: '1', cfop: '1102', vProd: 1500 });
    });

    it('na ENTRADA o fornecedor é o emitente — igual ao XML de compra', () => {
        const d: any = montarNotaDigitada(base());
        expect(d.emitente.nome).toBe('FORNECEDOR X');
        expect(d.destinatario.nome).toBe('NOVA ERA');
    });

    it('carimbada com quem e quando — dado fiscal digitado sem autor não se audita', () => {
        const d: any = montarNotaDigitada(base());
        expect(d.origem).toBe('digitada');
        expect(d.digitadaPorEmail).toBe('colab@spassessoriacontabil.com.br');
        expect(d.digitadaEm).toBeTruthy();
    });

    it('e os leitores REAIS a enxergam: a DIPAM classifica sem código novo', () => {
        // A prova do "mesmo trilho": classificarNota é um leitor de produção.
        const d: any = montarNotaDigitada(base({
            participanteNome: 'PRODUTOR Y', participanteDoc: '003.419.241-72',
        }));
        const n = classificarNota(d, { empresa: { cnpj: '29240822000121' } });
        expect(n.direcao).toBe('entrada');
        expect(n.fornecedor.doc).toBe('00341924172');
        expect(n.valor).toBe(1500);
    });
});

describe('o id é determinístico — relançar corrige, não duplica', () => {
    it('sem chave: empresa+número+série+competência', () => {
        expect(idNotaDigitada(base())).toBe('digitada_emp1_4512_1_2026-07');
        expect(idNotaDigitada(base())).toBe(idNotaDigitada(base()));
    });

    it('com chave, o id É a chave — é isso que faz o XML futuro cair no mesmo doc', () => {
        expect(idNotaDigitada(base({ chave: CHAVE }))).toBe(CHAVE);
    });
});

// ─── XML VENCE DIGITAÇÃO — nos DOIS sentidos ────────────────────────────────

describe('XML vence digitação', () => {
    it('digitada NÃO sobrescreve documento com XML — e a recusa diz a saída', () => {
        const r = podeGravarSobre({ origem: 'sefaz', xmlHash: 'abc' });
        expect(r.ok).toBe(false);
        expect(r.motivo).toMatch(/XML vence a digitação/);
        expect(r.motivo).toMatch(/Substituir/);
    });

    it('digitada sobre digitada regrava — corrigir a digitação é o uso normal', () => {
        expect(podeGravarSobre({ origem: 'digitada' }).ok).toBe(true);
        expect(podeGravarSobre(null).ok).toBe(true);
    });

    it('🚨 o XML que chega DEPOIS faz upgrade da digitada — nunca "duplicado"', () => {
        // O outro lado da régua, no importer. Sem isto, lançar a nota hoje
        // travaria a captura do XML verdadeiro amanhã — para sempre.
        const digitada: any = montarNotaDigitada(base({ chave: CHAVE }));
        const r = decidirGravacaoNFe({
            existingData: digitada, tipoDoc: 'nfe', schema: 'procNFe_v4.00.xsd', chave: CHAVE,
        });
        expect(r.upgrade).toBe(true);
        expect(r.duplicado).toBe(false);
    });

    it('mas RESUMO não rebaixa a digitada — resumo tem menos que o lançamento', () => {
        const digitada: any = montarNotaDigitada(base({ chave: CHAVE }));
        const r = decidirGravacaoNFe({
            existingData: digitada, tipoDoc: 'resNFe', schema: 'resNFe_v1.01.xsd', chave: CHAVE,
        });
        expect(r.upgrade).toBe(false);
    });
});

describe('a procedência DIZ o que a nota é', () => {
    it('digitada sem XML é natureza, não buraco — com autor e com a régua', () => {
        const p = procedenciaDoDocumento(montarNotaDigitada(base()));
        expect(p.temXml).toBe(false);
        expect(p.explicacao).toMatch(/lançada à mão/);
        expect(p.explicacao).toMatch(/colab@spassessoriacontabil\.com\.br/);
        expect(p.explicacao).toMatch(/SUBSTITUI/);
    });
});
