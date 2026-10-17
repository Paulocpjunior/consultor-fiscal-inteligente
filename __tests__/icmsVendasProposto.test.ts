/**
 * 🧮 A FICHA PROPÕE O "ICMS SOBRE VENDAS" E O "ICMS-ST + FCP-ST" DAS NOTAS (17/10).
 *
 * Paulo, KROYA 09/2026: o "ICMS sobre vendas" da ficha (13.132,68) era o ICMS
 * próprio (12.882,14) + o ST/FCP interestadual (250,54), e o campo "ICMS ST
 * (Destacado nas Vendas)" — que deduz também IRPJ/CSLL — ficava vazio.
 *
 * Fatos cobrados: o ICMS próprio e o ST + FCP-ST saem SEPARADOS, das saídas
 * válidas; cancelada e entrada ficam de fora; e o CFOP que a pessoa desmarca
 * (remessa/transferência) sai da proposta — o app não decide o que é venda.
 */
import { proporIcmsDasVendas } from '../services/icmsVendasProposto';

const nota = (id: string, over: any, itens: any[]) => ({
    id, chave: id, tipo: 'NFe', modelo: '55', direcao: 'saida', tpNF: '1', status: 'autorizado',
    empresaCnpj: '01961491000108', cnpjEmit: '01961491000108', ...over, itens,
}) as any;

const docs = [
    nota('15595', { ufDest: 'MG' }, [
        { cfop: '6101', vICMS: 92.17 },
        { cfop: '6401', vICMS: 32.52, vICMSST: 235.28 },
    ]),
    nota('15618', { ufDest: 'RJ' }, [{ cfop: '6401', vICMS: 1.49, vICMSST: 13.75, vFCPST: 1.51 }]),
    nota('9001', { ufDest: 'SP' }, [{ cfop: '5401', vICMS: 275.24, vICMSST: 193.64 }]),
    nota('9002', { ufDest: 'SP' }, [{ cfop: '5152', vICMS: 50 }]),
    nota('CANC', { status: 'cancelado' }, [{ cfop: '5101', vICMS: 999 }]),
    nota('ENT', { direcao: 'entrada', tpNF: '0', cnpjEmit: '11111111000191', cnpjDest: '01961491000108' }, [{ cfop: '5102', vICMS: 888 }]),
];

it('ICMS próprio e ST + FCP-ST saem separados, por CFOP', () => {
    const p = proporIcmsDasVendas(docs);
    expect(p.porCfop.map((l) => l.cfop)).toEqual(['5152', '5401', '6101', '6401']);
    expect(p.icmsVendas).toBe(451.42);            // 50 + 275,24 + 92,17 + 32,52 + 1,49
    expect(p.icmsStFcp).toBe(444.18);             // 193,64 + 235,28 + 13,75 + 1,51 (o caso KROYA)
});

it('CFOP desmarcado (transferência 5152) sai da proposta', () => {
    const p = proporIcmsDasVendas(docs, ['5152']);
    expect(p.icmsVendas).toBe(401.42);
    expect(p.icmsStFcp).toBe(444.18);
});

it('cancelada e entrada não entram', () => {
    const p = proporIcmsDasVendas(docs);
    expect(p.porCfop.find((l) => l.cfop === '5101')).toBeUndefined();
    expect(p.porCfop.find((l) => l.cfop === '5102')).toBeUndefined();
});
