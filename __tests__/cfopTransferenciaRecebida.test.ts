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
import { correlacionarCfop, SUFIXOS_TRANSFERENCIA_RECEBIDA } from '../sefaz-backend/cfop-correlacao.js';

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
