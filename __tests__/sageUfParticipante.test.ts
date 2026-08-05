import { ufValida } from '../services/ufsBrasil';
import { conferirAntesDeGerar } from '../services/iobSagePreflight';
import type { DocumentoFiscal } from '../types';

describe('ufValida — UF errada no E010 é escrituração errada', () => {
    it('aceita as 27 UFs e EX (exterior)', () => {
        expect(ufValida('SP')).toBe(true);
        expect(ufValida('mg')).toBe(true);
        expect(ufValida('EX')).toBe(true);
    });

    it('recusa sigla inventada, vazio e nome por extenso', () => {
        expect(ufValida('XX')).toBe(false);
        expect(ufValida('')).toBe(false);
        expect(ufValida('São Paulo')).toBe(false);
    });
});

const nfce = (numero: string, over: any = {}): DocumentoFiscal => ({
    id: `d-${numero}`,
    tipo: 'NFCe',
    tipoDoc: 'NFCe',
    direcao: 'saida',
    status: 'autorizado',
    numero,
    serie: '1',
    chave: `3526072924082200012165001000005${numero}0205176`,
    dhEmi: '2026-07-10T10:00:00',
    competencia: '2026-07',
    itens: [{ cProd: '1', xProd: 'PRODUTO', CFOP: '5102', vProd: 10, qCom: 1, uCom: 'UN' }],
    totais: { vNF: 10 },
    emitente: { cnpjCpf: '29240822000121', uf: 'SP', nome: 'NOVA ERA' },
    ...over,
} as any);

describe('NFC-e de balcão com o código do Consumidor preenchido', () => {
    // Paulo, 05/08: "desconsiderem os cadastros que estão em branco, pois essa
    // informação não é obrigatória". Com o código do Consumidor cadastrado não
    // há nada a corrigir — e o texto não pode dizer que a nota fica de fora.
    const docs = [nfce('5229'), nfce('5228')];

    it('não bloqueia e a ação diz que não há o que fazer', () => {
        const r = conferirAntesDeGerar(docs, {
            numeroEmpresaEfiscal: '0304',
            codigoParticipanteConsumidor: 'CONS01',
        } as any);
        const balde = r.problemas.find(b => /NFC-e a consumidor final/.test(b.causa));
        expect(balde?.gravidade).toBe('atencao');
        expect(balde?.acao).toMatch(/Nenhuma ação/);
        expect(balde?.oQueAconteceLa).toMatch(/Nada a corrigir/);
    });

    it('SEM o código do Consumidor volta a bloquear, com a ação de cadastro', () => {
        const r = conferirAntesDeGerar(docs, { numeroEmpresaEfiscal: '0304' } as any);
        const balde = r.problemas.find(b => /NFC-e a consumidor final/.test(b.causa));
        expect(balde?.gravidade).toBe('bloqueia');
        expect(balde?.acao).toMatch(/Consumidor final \(NFC-e\)/);
    });
});
