// ============================================================================
// 🚨 A TELA DIZIA "PRONTO" E O BOTÃO RECUSAVA — mesma tela, mesma empresa
//
// Print do Paulo (27/08, REGINA CELIA PIRES SERVIÇOS ADMINISTRATIVOS 07/2026):
//
//   · o cabeçalho: `5/5 etapas`
//   · os cinco selos: ✓ Capturar · ✓ Validar · ✓ Apurar · ✓ Entregar · – Guias
//   · o bloco: **"✓ Pronto para dar fim de mês"**
//   · e, ao clicar: **"3 etapa(s) da rotina ainda não fecharam"**, com CAPTURA,
//     APURAÇÃO e GUIAS abertas.
//
// ═══ A CAUSA, E ELA É SUTIL ═════════════════════════════════════════════════
//
// Em 26/08 eu extraí `montarRotinasDaCompetencia` justamente para o painel e o
// ato não divergirem — e escrevi, no comentário da rota do ato, que *"uma
// segunda montagem divergiria no pior lugar"*. O dono da MONTAGEM foi
// respeitado. O que eu esqueci foi o dono do **CARREGAMENTO**: a rota montava o
// objeto da empresa **à mão**, com nove campos, e deixava de fora justamente os
// que decidem três etapas.
//
//   · `ccmSp` ausente          ⇒ ISS responde `sem-ccm` ⇒ piora a CAPTURA
//   · `fichaFinanceira` e as duas fontes do Simples ausentes
//                              ⇒ `acharApuracaoDaCompetencia` devolve **null**
//                              ⇒ APURAÇÃO pendente, e a GUIA — que fecha em
//                                'na' quando o mês apurou ZERO — volta a
//                                'pendente'.
//
// 📌 REGRA QUE FICA: **dono de montagem não basta — quem CARREGA o insumo dela
// é dono também.** Objeto montado à mão para alimentar uma régua é uma segunda
// cópia com outra roupa, e ela envelhece em silêncio no primeiro campo novo.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error — módulo .js puro
import { empresaDaRotina, COLECOES_DA_ROTINA } from '../sefaz-backend/rotina-empresa-insumo.js';
// @ts-expect-error — módulo .js puro
import { acharApuracaoDaCompetencia } from '../sefaz-backend/rotina-fiscal.js';

const RAIZ = join(__dirname, '..');
const fonte = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

const docCru = (over: any = {}) => ({
    razaoSocial: 'REGINA CELIA PIRES SERVICOS ADMINISTRATIVOS LTDA',
    cnpj: '35.999.996/0001-75',
    dadosFiscais: { codMunIBGE: '3550308', ccmSp: '1.234.567-8', uf: 'SP' },
    faturamentoManual: { '2026-07': 0 },
    ...over,
});

describe('o dono do insumo da rotina', () => {
    // 🔒 OS QUATRO CAMPOS QUE PRODUZIRAM O PRINT. Cada um derruba uma etapa —
    // e a etapa cai como "aberta", que é indistinguível de trabalho não feito.
    it('carrega o CCM (sem ele o ISS diz "sem-ccm" e a CAPTURA piora)', () => {
        expect(empresaDaRotina('e1', 'simples_empresas', docCru()).ccmSp).toBe('12345678');
    });

    it('carrega as TRÊS fontes de apuração — é delas que a etapa 3 vive', () => {
        const e = empresaDaRotina('e1', 'simples_empresas', docCru({
            fichaFinanceira: [{ mesReferencia: '2026-07', totalImpostos: 0 }],
            faturamentoMensalDetalhado: { '07-2026': { x: 1 } },
        }));
        expect(e.fichaFinanceira).toHaveLength(1);
        expect(e.faturamentoManual).toEqual({ '2026-07': 0 });
        expect(e.faturamentoMensalDetalhado).toEqual({ '07-2026': { x: 1 } });
        // …e a régua que as lê responde, que é o que importa de verdade.
        expect(acharApuracaoDaCompetencia(e, '2026-07')).not.toBeNull();
    });

    it('o regime sai da COLEÇÃO — a empresa não guarda esse campo', () => {
        expect(empresaDaRotina('e1', 'simples_empresas', docCru()).regime).toBe('simples');
        expect(empresaDaRotina('e1', 'lucro_empresas', docCru()).regime).toBe('lucro');
    });

    // A recusa é a MESMA que a carteira sempre fez — lápide, fundida e CNPJ
    // ilegível não entram na rotina.
    it.each([
        ['lápide', { _deleted: true }],
        ['fundida', { _merged_into: 'outra' }],
        ['CNPJ ilegível', { cnpj: '123' }],
    ])('recusa empresa %s', (_rotulo, over) => {
        expect(empresaDaRotina('e1', 'simples_empresas', docCru(over))).toBeNull();
    });
});

// ============================================================================
// 🔒 A TRAVA É POR VARREDURA, não por lista de arquivos.
//
// Rota nova que monte o objeto da empresa à mão reintroduz o defeito — e ele
// não quebra nada: ele só faz a tela e o botão contarem histórias diferentes,
// que é o jeito mais caro de errar nesta casa.
// ============================================================================
describe('ninguém alimenta a rotina com objeto montado à mão', () => {
    const ARQUIVOS = [
        'sefaz-backend/rotina-fiscal-routes.js',
        'sefaz-backend/fim-de-mes-routes.js',
    ];

    it('todo arquivo que monta rotina de carteira conhece o dono do insumo', () => {
        for (const rel of ARQUIVOS) {
            const src = fonte(rel);
            if (!/montarRotinasDaCompetencia\s*\(/.test(src)) continue;
            expect({ rel, temDono: /empresaDaRotina\s*\(/.test(src) }).toEqual({ rel, temDono: true });
        }
    });

    // A assinatura do defeito: passar um OBJETO LITERAL como lista de empresas.
    it('nenhuma chamada recebe objeto literal no lugar da empresa', () => {
        for (const rel of ARQUIVOS) {
            const achado = fonte(rel).match(/montarRotinasDaCompetencia\s*\([^,]+,\s*\[\s*\{/);
            expect({ rel, achado: achado?.[0] || null }).toEqual({ rel, achado: null });
        }
    });

    // As duas coleções vêm da MESMA constante nos dois lados: uma lista escrita
    // à mão na rota do ato inverteria a ordem de busca sem ninguém notar.
    it('as coleções da rotina têm dono único', () => {
        expect(COLECOES_DA_ROTINA.map((c: string[]) => c[0]))
            .toEqual(['simples_empresas', 'lucro_empresas']);
        expect(fonte('sefaz-backend/fim-de-mes-routes.js')).toMatch(/COLECOES_DA_ROTINA/);
        expect(fonte('sefaz-backend/fim-de-mes-routes.js'))
            .not.toMatch(/\[\s*'lucro_empresas'\s*,\s*'simples_empresas'\s*\]/);
    });
});
