// ============================================================================
// 🚨 O EXPORTAR SAGE DECIDIA O LADO DO LIVRO PELO CAMPO CRU
//
// A nota PRÓPRIA DE ENTRADA (art. 136, I, "a" do RICMS/SP — a compra de
// produtor rural PF, que o adquirente é quem emite) fica gravada como
// `direcao: 'saida'` até o backfill do sync-cron passar. Quem decide na
// LEITURA é `direcaoEfetivaDoc`, pelo `tpNF` — e este arquivo lia o campo cru
// em quase todo lugar:
//
//   · o **E/S** da linha do .FML — o lado do livro;
//   · o participante cadastrado como **cliente × fornecedor** no E-Fiscal;
//   · a **direção passada à correlação de CFOP**, que escolhe entre 5xxx e 1xxx.
//
// É o caso EDUARDO GUERRA de 31/07 (#384): corrigido no import e na régua, e
// deixado vivo no leitor que GERA O ARQUIVO. Só o participante tinha a
// exceção — escrita à mão, ali dentro.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { participanteDoDoc, cfopParaEscriturar } from '../services/iobSageExportService';
import type { DocumentoFiscal } from '../types';

const RAIZ = join(__dirname, '..');
const CNPJ_EMPRESA = '31947349000169';

/** A nota que o CLIENTE emite da própria compra: tpNF=0, ele no emitente. */
const notaPropriaDeEntrada = (): DocumentoFiscal => ({
    id: 'x1',
    chave: '35260731947349000169550010000034853106861510',
    numero: '3485',
    dhEmi: '2026-07-10T10:00:00-03:00',
    // 🔴 O CAMPO MENTE — é assim que ela fica gravada até o backfill passar.
    direcao: 'saida',
    tpNF: '0',
    status: 'autorizado',
    empresaCnpj: CNPJ_EMPRESA,
    cnpjEmit: CNPJ_EMPRESA,
    emitente: { cnpjCpf: CNPJ_EMPRESA, nome: 'CLIENTE LTDA' },
    // O produtor vai no bloco DESTINATÁRIO nessa nota.
    destinatario: { cnpjCpf: '12345678901', nome: 'JOSE PRODUTOR', uf: 'SP' },
    cnpjDest: '12345678901',
    xNomeDest: 'JOSE PRODUTOR',
    ufDest: 'SP',
} as unknown as DocumentoFiscal);

describe('🚨 nota própria de entrada — o livro do cliente', () => {
    it('o participante é o PRODUTOR, não a própria empresa', () => {
        const p = participanteDoDoc(notaPropriaDeEntrada());
        expect(p?.cnpjCpf).toBe('12345678901');
    });

    // O CFOP de entrada é 1xxx/2xxx. Passando 'saida' cru, a correlação
    // escolheria a família 5xxx — e o E-Fiscal recusa o lançamento.
    it('a correlação de CFOP recebe ENTRADA, e o código sai da família 1xxx', () => {
        const cfop = cfopParaEscriturar('5102', 'entrada', undefined, notaPropriaDeEntrada());
        expect(String(cfop).charAt(0)).toBe('1');
    });

    // Saída de verdade continua saída — a régua não pode inverter o caso comum.
    it('venda normal continua SAÍDA', () => {
        const venda = { ...notaPropriaDeEntrada(), tpNF: '1' } as unknown as DocumentoFiscal;
        const cfop = cfopParaEscriturar('5102', 'saida', undefined, venda);
        expect(String(cfop).charAt(0)).toBe('5');
    });
});

describe('🚨 o gerador do .FML lê a direção pelo DONO', () => {
    const src = readFileSync(join(RAIZ, 'services/iobSageExportService.ts'), 'utf8');

    it('importa a régua da direção, não só a do cancelamento', () => {
        expect(src).toContain('direcaoEfetivaDoc');
    });

    it('o E/S da linha e o cliente × fornecedor saem da régua', () => {
        expect(src).toMatch(/es:\s*direcaoDoDoc\(d\) === 'entrada'/);
        expect(src).toMatch(/const isCliente = direcaoDoDoc\(d\) === 'saida'/);
        expect(src).toMatch(/const isFornecedor = direcaoDoDoc\(d\) === 'entrada'/);
    });

    it('e a correlação de CFOP também', () => {
        expect((src.match(/cfopParaEscriturar\(it\.cfop, direcaoDoDoc\(d\)/g) || []).length).toBe(2);
        expect(src).not.toMatch(/cfopParaEscriturar\(it\.cfop, d\.direcao/);
    });

    // ⚠️ O QUE FICOU DE PROPÓSITO, com o motivo — para não virar correção cega
    // numa próxima varredura:
    //
    //  · `usaDestinatario` (participanteDoDoc) pergunta em QUAL BLOCO está a
    //    contraparte, não qual é o lado do livro — e a exceção da nota própria
    //    já está escrita ali ao lado, explícita;
    //  · a derivação da UF da empresa procura uma nota com chave cujo `direcao`
    //    gravado seja 'saida'. A nota própria de entrada também foi EMITIDA
    //    pela empresa, então a chave dela carrega a MESMA UF — usar a régua ali
    //    só reduziria os candidatos, sem mudar a resposta.
    it('as duas leituras cruas que sobraram são as declaradas acima', () => {
        const cruas = (src.match(/d\.direcao/g) || []).length;
        expect(cruas).toBe(3); // usaDestinatario + os dois `find` da UF
    });
});
