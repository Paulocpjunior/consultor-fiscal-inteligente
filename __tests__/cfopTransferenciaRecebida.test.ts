// ============================================================================
// 🚨 TRANSFERÊNCIA RECEBIDA: o CFI escriturava 1151 onde a tabela diz 1152.
//
// Paulo, 17/08, colocando lado a lado o livro de Entradas do E-Fiscal e o
// Resumo por CFOP do CFI, para a NOVA ERA (COMERCIO DE FRUTAS): *"precisamos
// trabalhar a correlação dos CFOPs com maior detalhe, melhor amarração de
// acordo com o ramo da empresa que adquire a mercadoria"*.
//
// No E-Fiscal: **1.152**. No CFI: **1151**.
//
// ═══ E QUEM DECIDE AQUI NÃO É O E-FISCAL — É A TABELA ═══════════════════════
//
// (A régua de 11/08 continua valendo: o E-Fiscal é REFERÊNCIA, nunca gabarito.
// Divergir dele é uma PERGUNTA. Neste caso a pergunta tem resposta na norma.)
//
//   SAÍDA — o sufixo descreve a ORIGEM de quem envia
//     5151  transferência de PRODUÇÃO do estabelecimento
//     5152  transferência de mercadoria adquirida de TERCEIROS
//   ENTRADA — o sufixo descreve o DESTINO de quem recebe
//     1151  transferência para INDUSTRIALIZAÇÃO
//     1152  transferência para COMERCIALIZAÇÃO
//     1154  transferência para utilização na PRESTAÇÃO DE SERVIÇO
//
// O sufixo MUDA DE SIGNIFICADO ao atravessar a operação — exatamente como
// 101/102, que a correlação já tratava. Preservá-lo escritura "recebi para
// industrializar" num comércio de frutas que vai revender.
// ============================================================================
import {
    correlacionarCfop, SUFIXOS_TRANSFERENCIA_RECEBIDA, PARES_DEVOLUCAO_RECEBIDA,
} from '../sefaz-backend/cfop-correlacao.js';

const entrada = (cfop: string, naturezaAtividade?: string, cfopOverrides?: Record<string, string>) =>
    correlacionarCfop(cfop, 'entrada', { naturezaAtividade, cfopOverrides });

describe('🚨 o caso NOVA ERA — comércio recebendo transferência', () => {
    it('5151 (produção do remetente) vira 1152 num COMÉRCIO', () => {
        expect(entrada('5151', 'comercio')).toBe('1152');
    });

    it('5152 também vira 1152 — o que manda é o destino de quem recebe', () => {
        expect(entrada('5152', 'comercio')).toBe('1152');
    });

    it('interestadual segue o mesmo caminho: 6151/6152 → 2152', () => {
        expect(entrada('6151', 'comercio')).toBe('2152');
        expect(entrada('6152', 'comercio')).toBe('2152');
    });
});

describe('e o ramo da empresa decide, que é o pedido do Paulo', () => {
    it('INDÚSTRIA recebe para industrializar → 151', () => {
        expect(entrada('5151', 'industria')).toBe('1151');
        expect(entrada('5152', 'industria')).toBe('1151');
    });

    it('SERVIÇO recebe para usar na prestação → 154', () => {
        expect(entrada('5151', 'servicos')).toBe('1154');
    });

    it('MISTO/indefinido NÃO força — e aqui isso é seguro', () => {
        // Diferente da família ST, a conversão mecânica da transferência
        // produz CFOP que EXISTE (1151/1152/1154). Forçar sem saber o ramo
        // seria escolher por conta própria; preservar é a escolha honesta.
        expect(entrada('5151', 'misto')).toBe('1151');
        expect(entrada('5152')).toBe('1152');
    });
});

describe('🚨 o que NÃO entra na família — inventar operação é o defeito de origem', () => {
    it('153 (energia elétrica para distribuição) fica de fora', () => {
        // Mandar energia elétrica para 152 porque o cliente é comércio seria
        // inventar operação — é família própria.
        expect(SUFIXOS_TRANSFERENCIA_RECEBIDA).not.toContain('153');
        expect(entrada('5153', 'comercio')).toBe('1153');
    });

    it('a família de COMPRA continua como estava', () => {
        expect(entrada('5102', 'comercio')).toBe('1102');
        expect(entrada('5101', 'industria')).toBe('1101');
    });

    it('a família ST continua como estava — 1405 não pode voltar', () => {
        expect(entrada('5405', 'comercio')).toBe('1403');
        expect(entrada('5405', 'industria')).toBe('1401');
    });

    it('override manual da empresa continua vencendo tudo', () => {
        expect(entrada('5151', 'comercio', { '5151': '1949' })).toBe('1949');
    });

    it('saída não é tocada — o CFOP da nota própria já é o certo', () => {
        expect(correlacionarCfop('5151', 'saida', { naturezaAtividade: 'comercio' })).toBe('5151');
    });
});

// ============================================================================
// 🚨 DEVOLUÇÃO RECEBIDA — o sufixo espelha O QUE EU VENDI.
//
// Paulo, 17/08, confirmando a pergunta que eu tinha deixado aberta: *"a sua
// questão está correta quanto à devolução — as devoluções de mercadorias devem
// sempre se basear em COMO FOI DADO ENTRADA na NF"*.
//
// O cliente devolve emitindo pelo lado DELE (5201 "devolução de compra para
// industrialização", 5202 "para comercialização") — isso descreve o destino que
// ELE tinha dado. Do meu lado o que vale é se eu vendi PRODUÇÃO PRÓPRIA (201) ou
// MERCADORIA DE TERCEIROS (202). Mesma assimetria de 101/102 e 151/152.
// ============================================================================
describe('🚨 devolução: o par fica DENTRO da família', () => {
    it('devolução de venda — indústria 201, comércio 202', () => {
        expect(entrada('5201', 'industria')).toBe('1201');
        expect(entrada('5202', 'industria')).toBe('1201');
        expect(entrada('5201', 'comercio')).toBe('1202');
        expect(entrada('5202', 'comercio')).toBe('1202');
    });

    it('devolução de TRANSFERÊNCIA não vira devolução de venda', () => {
        // Trocar de família inventaria operação: 208/209 é remessa em
        // transferência, não venda.
        expect(entrada('5208', 'comercio')).toBe('1209');
        expect(entrada('5209', 'industria')).toBe('1208');
    });

    it('devolução com ST fica na família ST', () => {
        expect(entrada('5410', 'comercio')).toBe('1411');
        expect(entrada('5411', 'industria')).toBe('1410');
    });

    it('interestadual segue igual', () => {
        expect(entrada('6202', 'comercio')).toBe('2202');
        expect(entrada('6201', 'industria')).toBe('2201');
    });

    it('SERVIÇO devolve mercadoria de terceiros — ele não produz', () => {
        expect(entrada('5201', 'servicos')).toBe('1202');
    });

    it('misto/indefinido NÃO força — o par mecânico existe', () => {
        expect(entrada('5201', 'misto')).toBe('1201');
        expect(entrada('5202')).toBe('1202');
    });

    it('a tabela de pares é simétrica: os dois sufixos da família apontam para o mesmo par', () => {
        for (const [suf, par] of Object.entries(PARES_DEVOLUCAO_RECEBIDA as any)) {
            expect((PARES_DEVOLUCAO_RECEBIDA as any)[(par as any).producao]).toEqual(par);
            expect((PARES_DEVOLUCAO_RECEBIDA as any)[(par as any).terceiros]).toEqual(par);
            expect(suf).toMatch(/^\d{3}$/);
        }
    });

    it('⚠️ o limite é conhecido: indústria que REVENDE cai em "produção" por default', () => {
        // Mesmo limite de 101/102 — e é exatamente por isso que o campo por NF
        // existe. O app erra para o lado do ramo declarado, e a pessoa corrige
        // na nota; o que não pode é errar em silêncio.
        expect(entrada('5202', 'industria')).toBe('1201');
    });
});
