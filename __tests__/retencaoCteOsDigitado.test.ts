/**
 * 🚨 O CT-e OS DA J.P. PISSATO — retenção que o documento DIZ e o app não tinha
 * onde receber.
 *
 * Paulo, 04/09: *"essa empresa tem uma particularidade na nota de retenção, ela
 * não é formato 55, 65 e sim 67 DACTE-OS, com isso o cliente só envia o PDF da
 * mesma… quando gero o relatório de retenções ela puxa a NF porém os campos que
 * deveriam estar informados, que é o IR, não está."*
 *
 * Os números são do DACTE-OS real (CT-e OS 114.924, série 316):
 *   · prestação  3.901,37
 *   · IRRF          39,02  ("SUJEITO A RETENÇÃO DE 1,0% IRRF, ARTIGO 55, LEI
 *                            7713 DE 22/12/1988 - R$ 39,02")
 *   · a receber   3.862,35  (= 3.901,37 − 39,02, fecha ao centavo)
 *   · ICMS         468,16  (CST 00, base 3.901,37, 12%)
 *
 * ⚠️ Os CNPJs aqui são FICTÍCIOS: dado de cliente não entra no repositório.
 */
import {
    montarNotaDigitada, validarNotaDigitada, especieDe, MODELOS_TRANSPORTE,
} from '../services/notaDigitada';
import {
    camposDaRetencaoDigitada, validarRetencaoDigitada, temRetencaoDigitada,
    ecoDaRetencaoDigitada,
} from '../services/retencaoFederalDigitada';
import { linhasRetencoes, linhasServicos } from '../services/relatoriosAgregacoes';
import {
    ehConhecimentoDeTransporte, ehNotaDeServico,
} from '../sefaz-backend/sped-selecao-documentos.js';
import { lerRetencoesFederaisDoDoc } from '../sefaz-backend/reinf-retencoes-pj.js';
import {
    validarParametroRetencao, parametrosAplicaveis, sugerirRetencoes,
} from '../sefaz-backend/retencao-parametros.js';

const EMPRESA = '00593774000173';
const TRANSPORTADOR = '43035146000185';

const cteOs = (over: any = {}) => ({
    especie: 'transporte' as const,
    transporte: { modelo: '67' as const, cfop: '1357', descricao: 'Transporte de Valores', cst: '00', vBC: 3901.37, aliqIcms: 12, vICMS: 468.16 },
    retencao: { ir: '39,02' },
    empresaId: 'emp1',
    empresaCnpj: EMPRESA,
    empresaNome: 'JP PISSATO LOTERIAS LTDA',
    direcao: 'entrada' as const,
    numero: '114924',
    serie: '316',
    dhEmi: '2026-08-31',
    participanteNome: 'PROTEGE PROTECAO E TRANSPORTE DE VALORES LTDA',
    participanteDoc: TRANSPORTADOR,
    participanteUf: 'SP',
    valorTotal: 3901.37,
    itens: [],
    digitadaPorEmail: 'colab@sp.com.br',
    createdByUid: 'uid-1',
    ...over,
});

describe('🚨 AUSENTE ≠ ZERO — o "?" existe para não afirmar que não houve retenção', () => {
    it('campo em branco fica FORA do objeto, nunca como undefined/null', () => {
        const campos = camposDaRetencaoDigitada({ ir: '39,02', inss: '', csll: null, pis: undefined });
        expect(campos).toEqual({ valorIr: 39.02 });
        // A chave NÃO existe — emiti-la com undefined viraria `null` na
        // gravação, e `null !== undefined` é true: a nota passaria a dizer
        // "0,00 retido" no relatório (o defeito de 01/09).
        expect('valorInss' in campos).toBe(false);
        expect('valorCsll' in campos).toBe(false);
        expect(Object.keys(campos)).toEqual(['valorIr']);
    });

    it('ZERO DIGITADO é resposta e ENTRA — "conferi, não houve IR" é um fato', () => {
        const campos = camposDaRetencaoDigitada({ ir: '0' });
        expect(campos).toEqual({ valorIr: 0 });
    });

    it('Number(null)/Number("") não colapsam ausência em zero', () => {
        expect(camposDaRetencaoDigitada({ ir: null, inss: '', csll: '   ' })).toEqual({});
        expect(temRetencaoDigitada({ ir: null, inss: '' })).toBe(false);
        expect(temRetencaoDigitada({ ir: '0' })).toBe(true);
    });

    it('lê a forma brasileira com milhar', () => {
        expect(camposDaRetencaoDigitada({ csll: '1.234,56' })).toEqual({ valorCsll: 1234.56 });
    });
});

describe('recusas da retenção digitada', () => {
    it('retenção MAIOR que a nota é recusada com a ação (vírgula no lugar errado)', () => {
        const erros = validarRetencaoDigitada({ ir: '3902' }, 3901.37);
        expect(erros.join(' ')).toMatch(/MAIOR que o valor da nota/i);
        expect(erros.join(' ')).toMatch(/vírgula/i);
    });

    it('negativo é recusado', () => {
        expect(validarRetencaoDigitada({ inss: '-10' }, 1000).join(' ')).toMatch(/negativa/i);
    });

    it('o eco DIZ que o que ficou em branco não vira zero', () => {
        const eco = ecoDaRetencaoDigitada({ ir: '39,02' }, 3901.37);
        expect(eco).toMatch(/IR R\$ 39,02/);
        expect(eco).toMatch(/1,00%/);
        expect(eco).toMatch(/NÃO são gravados como zero/i);
    });

    it('sem nada preenchido não há eco (e a tela mostra o aviso do "?")', () => {
        expect(ecoDaRetencaoDigitada({}, 100)).toBeNull();
    });
});

describe('🚚 A espécie TRANSPORTE — o CT-e OS não é NF-e nem NFS-e', () => {
    it('a espécie existe e os modelos são 57 e 67', () => {
        expect(especieDe({ especie: 'transporte' })).toBe('transporte');
        expect([...MODELOS_TRANSPORTE]).toEqual(['57', '67']);
    });

    it('o documento montado é reconhecido como CONHECIMENTO DE TRANSPORTE, não serviço', () => {
        const doc = montarNotaDigitada(cteOs() as any) as any;
        expect(doc.modelo).toBe('67');
        expect(doc.tipo).toBe('CTe');
        expect(ehConhecimentoDeTransporte(doc)).toBe(true);
        // 🚨 É isto que o tira do bloco A do EFD-Contribuições e do Livro de
        // Serviços — lançado como NFS-e ele iria para o bloco errado.
        expect(ehNotaDeServico(doc)).toBe(false);
    });

    it('grava nos campos que o BLOCO D lê — cfop na RAIZ, aliqIcms, totais', () => {
        const doc = montarNotaDigitada(cteOs() as any) as any;
        // `cfopDoCte` lê `nota.cfop` antes de olhar o item.
        expect(doc.cfop).toBe('1357');
        expect(doc.aliqIcms).toBe(12);
        expect(doc.totais.vBC).toBe(3901.37);
        expect(doc.totais.vICMS).toBe(468.16);
        expect(doc.valorTotal).toBe(3901.37);
    });

    it('a retenção do documento chega ao DONO da leitura', () => {
        const doc = montarNotaDigitada(cteOs() as any) as any;
        const fed = lerRetencoesFederaisDoDoc(doc);
        expect(fed.ir).toBe(39.02);
        // Os demais continuam AUSENTES — o documento não os declara.
        expect(fed.pis).toBeUndefined();
        expect(fed.csllOuTotal).toBeUndefined();
    });

    it('AUSENTE ≠ ZERO também no ICMS: campo vazio não vira 0', () => {
        const doc = montarNotaDigitada(cteOs({
            transporte: { modelo: '67', cfop: '1357', vBC: null, aliqIcms: null, vICMS: null },
        }) as any) as any;
        expect(doc.totais.vBC).toBeUndefined();
        expect(doc.aliqIcms).toBeUndefined();
    });

    it('modelo fora de 57/67 é RECUSADO — o app não escolhe o modelo por ninguém', () => {
        const erros = validarNotaDigitada(cteOs({ transporte: { modelo: '55', cfop: '1357' } }) as any);
        expect(erros.join(' ')).toMatch(/57 \(CT-e\) ou 67 \(CT-e OS\)/);
    });

    it('CFOP de SAÍDA numa entrada é recusado, com o de-para na frase', () => {
        const erros = validarNotaDigitada(cteOs({ transporte: { modelo: '67', cfop: '5357' } }) as any);
        expect(erros.join(' ')).toMatch(/5357 é de SAÍDA/);
        expect(erros.join(' ')).toMatch(/1357/);
    });

    it('ICMS maior que a prestação é recusado', () => {
        const erros = validarNotaDigitada(cteOs({
            transporte: { modelo: '67', cfop: '1357', vICMS: 46816 },
        }) as any);
        expect(erros.join(' ')).toMatch(/MAIOR que o valor da prestação/);
    });

    it('o caso REAL do print passa sem erro', () => {
        expect(validarNotaDigitada(cteOs() as any)).toEqual([]);
    });

    it('a retenção vale também nas outras espécies (NFS-e digitada)', () => {
        const doc = montarNotaDigitada(cteOs({
            especie: 'servico',
            servico: { discriminacao: 'Serviço' },
            retencao: { ir: '15,00', csll: '10,00' },
        }) as any) as any;
        expect(doc.valorIr).toBe(15);
        expect(doc.valorCsll).toBe(10);
    });
});

describe('🚨 O relatório de RETENÇÕES tem de enxergar o CT-e — senão a correção o ESCONDE', () => {
    const doc = () => montarNotaDigitada(cteOs() as any) as any;

    it('o CT-e OS com retenção APARECE na aba Retenções, com o IR', () => {
        const linhas = linhasRetencoes([doc()], 'entrada');
        expect(linhas).toHaveLength(1);
        expect(linhas[0].ir).toBe(39.02);
        expect(linhas[0].retencoesFederaisGravadas).toBe(true);
        expect(linhas[0].numero).toBe('114924');
    });

    it('…e NÃO aparece nas abas de Serviços — lá é NFS-e/ISS', () => {
        expect(linhasServicos([doc()], 'entrada')).toHaveLength(0);
    });

    it('CT-e SEM retenção não entra — frete comum é o caso NORMAL e encheria a aba de "?"', () => {
        const semRetencao = montarNotaDigitada(cteOs({ retencao: {} }) as any) as any;
        expect(linhasRetencoes([semRetencao], 'entrada')).toHaveLength(0);
    });

    it('a NFS-e SEM os campos continua entrando com "?" — ausente ≠ zero retido', () => {
        const nfse = montarNotaDigitada(cteOs({
            especie: 'servico', servico: { discriminacao: 'X' }, retencao: {},
        }) as any) as any;
        const linhas = linhasRetencoes([nfse], 'entrada');
        expect(linhas).toHaveLength(1);
        expect(linhas[0].retencoesFederaisGravadas).toBe(false);
    });
});

describe('🧠 O parâmetro por prestador — SUGERE, nunca grava', () => {
    const base = {
        empresaId: 'emp1',
        cnpjPrestador: TRANSPORTADOR,
        tributo: 'ir' as const,
        aliquota: 1,
        fundamento: 'Art. 55 da Lei 7.713/1988',
        vigenciaInicio: '2026-08',
        criadoPor: 'colab@sp.com.br',
    };

    it('o parâmetro do caso real é válido', () => {
        expect(validarParametroRetencao(base)).toEqual([]);
    });

    it('SEM base legal é RECUSADO — alíquota órfã não se confere depois', () => {
        const erros = validarParametroRetencao({ ...base, fundamento: '' });
        expect(erros.join(' ')).toMatch(/base legal/i);
    });

    it('sem vigência é recusado, e a frase diz que ele não retroage', () => {
        const erros = validarParametroRetencao({ ...base, vigenciaInicio: '' });
        expect(erros.join(' ')).toMatch(/não retroage/i);
    });

    it('alíquota fora de 0–100 e tributo fora do vocabulário são recusados', () => {
        expect(validarParametroRetencao({ ...base, aliquota: 0 }).join(' ')).toMatch(/entre 0 e 100/);
        // `as any`: o vocabulário FECHADO é o que se prova aqui — o tipo já barra
        // em compilação, e a régua tem de barrar em execução também (dado que vem
        // do banco não passa pelo TypeScript).
        expect(validarParametroRetencao({ ...base, tributo: 'iss' as any }).join(' ')).toMatch(/Tributo inválido/);
    });

    it('NÃO RETROAGE: competência anterior à vigência não recebe o parâmetro', () => {
        expect(parametrosAplicaveis([base], { cnpjPrestador: TRANSPORTADOR, competencia: '2026-07' })).toHaveLength(0);
        expect(parametrosAplicaveis([base], { cnpjPrestador: TRANSPORTADOR, competencia: '2026-08' })).toHaveLength(1);
    });

    it('entre duas vigências do mesmo tributo vence a mais RECENTE', () => {
        const novo = { ...base, aliquota: 1.5, vigenciaInicio: '2026-09' };
        const [p] = parametrosAplicaveis([base, novo], { cnpjPrestador: TRANSPORTADOR, competencia: '2026-09' });
        expect(p.aliquota).toBe(1.5);
    });

    it('desligado não se aplica, e prestador diferente também não', () => {
        expect(parametrosAplicaveis([{ ...base, ativo: false }], { cnpjPrestador: TRANSPORTADOR, competencia: '2026-08' })).toHaveLength(0);
        expect(parametrosAplicaveis([base], { cnpjPrestador: '11111111111111', competencia: '2026-08' })).toHaveLength(0);
    });

    it('🚨 A SUGESTÃO DIVERGE DO DOCUMENTO EM UM CENTAVO — e por isso ela não grava', () => {
        const s = sugerirRetencoes([base], {
            cnpjPrestador: TRANSPORTADOR, competencia: '2026-08', base: 3901.37,
        });
        // 1% de 3.901,37 = 39,0137 → 39,01. O documento declara 39,02, e é ele
        // que fecha o líquido impresso (3.901,37 − 39,02 = 3.862,35).
        expect(s.ir!.valor).toBe(39.01);
        expect(s.ir!.aliquota).toBe(1);
        expect(s.ir!.fundamento).toMatch(/7\.713/);
        // Ou seja: gravar a sugestão declararia um centavo A MENOS do que foi
        // retido. Quem manda é o papel — a régua do R-2055.
        expect(s.ir!.valor).not.toBe(39.02);
    });

    it('sem base não há sugestão (não se calcula sobre nada)', () => {
        expect(sugerirRetencoes([base], { cnpjPrestador: TRANSPORTADOR, competencia: '2026-08', base: 0 })).toEqual({});
    });
});
