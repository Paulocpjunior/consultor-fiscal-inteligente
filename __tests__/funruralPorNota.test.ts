// ============================================================================
// 🚨 "QUANDO EU TIRO DO FUNRURAL ELE APAGA TODAS DESSE COSME"
//
// 30/08, Paulo: *"Ao excluir as notas de produtor emitidas pelo fornecedor, o
// sistema apaga TODAS as notas vinculadas a esse produtor, incluindo a nota de
// entrada própria da Nova Era, que deveria ser mantida. Como consequência, não
// consigo conferir nem conciliar corretamente os valores do produtor."*
//
// O caso, com os números do print — COSME QUEIROZ DE SANTANA (013.099.925-33):
//
//   · nº 256121 · **nota própria de entrada (art. 136)** · CFOP 2102 ·
//     R$ 49.500,00 → **TEM DE FICAR**
//   · nº 39971326 · NF-e do produtor · CFOP 6101 · R$ 15.750,00 → sai
//   · nº 41510126 · NF-e do produtor · CFOP 6101 · R$ 60.500,00 → sai
//
// 🔴 O botão `✕ tirar do FUNRURAL` está na **linha da NOTA** e gravava
// `funrural: 'nao_aplica'` no **PRODUTOR** — então tirar uma tirava as três. É
// a promessa que a tela não cumpre, a família do ✕ de 14/08.
//
// 📌 São DUAS decisões e só existia uma: *"este fornecedor não gera
// sub-rogação"* (natureza — vale para todas as notas dele) e *"esta nota não
// entra"*, que é a que faltava.
// ============================================================================
// A função nova entra no `.d.ts` no MESMO PR (regra do #382) — por isso aqui
// não há silenciador.
import { notaForaDoFunruralPorDecisao } from '../sefaz-backend/dipam-produtor-rural.js';
// (sem @ts-expect-error: este módulo TEM .d.ts — silenciar devolveria o módulo
// a `any` e o tipo pararia de valer, o defeito do deploy 799.)
import { montarRegistroProdutor } from '../sefaz-backend/dipam-store.js';

const CHAVE_NOTA_PROPRIA = '35260613099925330155001000002561211178456640';
const CHAVE_NFE_PRODUTOR_1 = '29260613099925330155001000399713261178456641';
const CHAVE_NFE_PRODUTOR_2 = '29260613099925330155001000415101261178456642';

describe('🚨 a decisão é da NOTA, não do produtor inteiro', () => {
    // O cadastro do COSME com as DUAS NF-e do produtor tiradas — e a nota
    // própria intacta.
    const cosme = { doc: '01309992533', notasForaDoFunrural: [CHAVE_NFE_PRODUTOR_1, CHAVE_NFE_PRODUTOR_2] };

    it('as NF-e do produtor saem', () => {
        expect(notaForaDoFunruralPorDecisao(cosme, CHAVE_NFE_PRODUTOR_1)).toBe(true);
        expect(notaForaDoFunruralPorDecisao(cosme, CHAVE_NFE_PRODUTOR_2)).toBe(true);
    });

    // 🚨 O CORAÇÃO DO CASO: a nota própria de entrada FICA.
    it('e a nota própria de entrada (art. 136) FICA — é ela que ele precisa conciliar', () => {
        expect(notaForaDoFunruralPorDecisao(cosme, CHAVE_NOTA_PROPRIA)).toBe(false);
    });

    // ⚠️ SEM CHAVE NÃO AFIRMA NADA: dizer "foi tirada" sobre documento sem
    // chave legível tiraria do total de um imposto uma nota que ninguém tirou.
    it('sem chave legível não tira nada', () => {
        expect(notaForaDoFunruralPorDecisao(cosme, '')).toBe(false);
        expect(notaForaDoFunruralPorDecisao(cosme, null)).toBe(false);
        expect(notaForaDoFunruralPorDecisao(cosme, undefined)).toBe(false);
    });

    it('produtor sem decisão nenhuma não tira nada', () => {
        expect(notaForaDoFunruralPorDecisao({ doc: '01309992533' }, CHAVE_NOTA_PROPRIA)).toBe(false);
        expect(notaForaDoFunruralPorDecisao(null, CHAVE_NOTA_PROPRIA)).toBe(false);
        expect(notaForaDoFunruralPorDecisao({ notasForaDoFunrural: 'nao-e-array' }, CHAVE_NOTA_PROPRIA)).toBe(false);
    });
});

describe('🚨 a gravação preserva o resto do cadastro', () => {
    // ⚠️ É a lição de 13/08 (o CPF que "não salvava" e na verdade APAGAVA o
    // cadastro inteiro): presença no payload é o sinal. Gravar a decisão de uma
    // nota não pode zerar natureza, IE, município nem o regime do produtor.
    it('gravar notasForaDoFunrural não menciona os outros campos', () => {
        const r = montarRegistroProdutor('01309992533', {
            notasForaDoFunrural: [CHAVE_NFE_PRODUTOR_1],
        }, { email: 'a@b.com' });
        expect(r.notasForaDoFunrural).toEqual([CHAVE_NFE_PRODUTOR_1]);
        expect('natureza' in r).toBe(false);
        expect('funrural' in r).toBe(false);
        expect('seguradoEspecial' in r).toBe(false);
        expect(r.confirmadoPor).toBe('a@b.com');
    });

    it('a mesma nota tirada duas vezes é UMA decisão', () => {
        const r = montarRegistroProdutor('01309992533', {
            notasForaDoFunrural: [CHAVE_NFE_PRODUTOR_1, CHAVE_NFE_PRODUTOR_1, ' ' + CHAVE_NFE_PRODUTOR_1 + ' '],
        });
        expect(r.notasForaDoFunrural).toEqual([CHAVE_NFE_PRODUTOR_1]);
    });

    it('lista vazia APAGA as decisões — é o caminho de volta', () => {
        const r = montarRegistroProdutor('01309992533', { notasForaDoFunrural: [] });
        expect(r.notasForaDoFunrural).toEqual([]);
    });

    it('chave em branco não vira decisão', () => {
        const r = montarRegistroProdutor('01309992533', { notasForaDoFunrural: ['', null, '  '] });
        expect(r.notasForaDoFunrural).toEqual([]);
    });
});

// ============================================================================
// 🚨 O CASO INTEIRO, com os números do print — e é aqui que ele se prova.
// ============================================================================
// (sem @ts-expect-error: o módulo TEM .d.ts — a trava dtsNaoPrometeFantasma
// pega isso, e silenciar devolveria o módulo a `any`.)
import { montarDipamCompetencia } from '../sefaz-backend/dipam-produtor-rural.js';

const notaDoProdutor = (chave: string, numero: string, valor: number) => ({
    chave, id: chave, numero, dhEmi: '2026-06-15T10:00:00-03:00', competencia: '2026-06',
    status: 'autorizado', direcao: 'entrada', tpNF: '1',
    cnpjEmit: '01309992533', xNomeEmit: 'COSME QUEIROZ DE SANTANA',
    cnpjDest: '11111111000191', xNomeDest: 'NOVA ERA', valorTotal: valor,
    itens: [{ nItem: '1', cProd: 'BAN', xProd: 'BANANA', NCM: '08039000', CFOP: '6101', vProd: valor }],
});
const EMPRESA = { adquireDeProdutor: true, funruralSubRogacao: 'automatico', cnpj: '11111111000191' };
const COSME = { doc: '01309992533', nome: 'COSME QUEIROZ DE SANTANA', natureza: 'produtor_rural_pf', uf: 'BA' };

const apurar = (cadastro: any) => montarDipamCompetencia({
    documentos: [
        notaDoProdutor(CHAVE_NFE_PRODUTOR_1, '39971326', 15750),
        notaDoProdutor(CHAVE_NFE_PRODUTOR_2, '41510126', 60500),
    ],
    competencia: '2026-06',
    empresa: EMPRESA,
    fornecedores: { '01309992533': cadastro },
});

describe('🚨 tirar UMA nota tira UMA nota', () => {
    it('sem decisão, as duas contam', () => {
        const r = apurar(COSME);
        expect(r.funrural.notas.map((n: any) => n.numero)).toEqual(['39971326', '41510126']);
    });

    // 🔴 O DEFEITO: antes, tirar uma tirava as duas (a decisão era do produtor).
    it('tirando a 39971326, a 41510126 CONTINUA contando', () => {
        const r = apurar({ ...COSME, notasForaDoFunrural: [CHAVE_NFE_PRODUTOR_1] });
        expect(r.funrural.notas.map((n: any) => n.numero)).toEqual(['41510126']);
        expect(r.funrural.total).toBeGreaterThan(0);
    });

    // ⚠️ E O CAMINHO DE VOLTA EXISTE, COM O NÚMERO NA FRENTE — a régua de
    // 14/08: total que muda sozinho faz desconfiar do número certo, e botão
    // que tira coisa do total nasce com o botão que desfaz.
    it('a nota tirada aparece com o ↩ e com o que volta ao total', () => {
        const r = apurar({ ...COSME, notasForaDoFunrural: [CHAVE_NFE_PRODUTOR_1] });
        const g = (r.funrural.tiradosPorDecisao || [])[0];
        expect(g).toBeTruthy();
        expect(g.decisao).toBe('nota-nao-aplica');
        expect(g.notas).toBe(1);
        expect(g.chaves).toEqual([CHAVE_NFE_PRODUTOR_1]);
        expect(g.reversivelNaLinha).toBe(true);
        expect(g.funruralPotencial).toBeGreaterThan(0);
        // O rótulo precisa DIZER que as outras continuam — senão quem lê acha
        // que o produtor inteiro saiu, que era exatamente o defeito.
        expect(g.rotulo).toMatch(/demais notas deste produtor continuam/i);
    });

    // ⚠️ A decisão do PRODUTOR continua existindo e continua valendo para todas
    // — ela é outra pergunta ("este fornecedor não gera sub-rogação").
    it('a decisão do PRODUTOR segue tirando todas', () => {
        const r = apurar({ ...COSME, funrural: 'nao_aplica' });
        expect(r.funrural.notas).toHaveLength(0);
    });
});
