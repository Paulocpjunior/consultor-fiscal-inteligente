// @ts-nocheck
import { mapearParaDocumentoFiscal, gerarChaveAbrasf } from '../sefaz-backend/abrasf/importer.js';

const nfseExemplo = {
    numero: '123',
    codigoVerificacao: 'ABC1234567',
    dataEmissao: '2026-06-15T10:00:00',
    naturezaOperacao: '1',
    optanteSimples: false,
    servico: {
        valorServicos: 1000, baseCalculo: 1000, aliquota: 5, valorIss: 50, valorIssRetido: 0,
        valorPis: 0, valorCofins: 0, valorInss: 0, valorIr: 0, valorCsll: 0, valorLiquidoNfse: 950,
        issRetido: false,
        itemListaServico: '1.07',
        codigoTributacaoMunicipio: '12345',
        discriminacao: 'Servico de consultoria',
        codigoMunicipio: '3505708',
    },
    prestador: { cnpj: '11222333000181', inscricaoMunicipal: '999', nome: 'Prestador Demo' },
    tomador: { cnpj: '99888777000165', inscricaoMunicipal: '111', nome: 'Tomador Demo' },
};

const contextoTomado = {
    empresaId: 'emp1',
    empresaCnpj: '99888777000165',
    tipo: 'tomado',
    codMunIBGE: '3505708',
    codMunNome: 'Barueri',
};

describe('gerarChaveAbrasf', () => {
    it('gera chave deterministica baseada em prestador+numero+municipio+verif', () => {
        const k1 = gerarChaveAbrasf(nfseExemplo, '3505708');
        const k2 = gerarChaveAbrasf(nfseExemplo, '3505708');
        expect(k1).toBe(k2);
        expect(k1).toMatch(/^abrasf-11222333000181-123-[a-f0-9]{16}$/);
    });

    it('chave muda se municipio diferente', () => {
        const k1 = gerarChaveAbrasf(nfseExemplo, '3505708');
        const k2 = gerarChaveAbrasf(nfseExemplo, '3548500');
        expect(k1).not.toBe(k2);
    });

    it('chave muda se numero diferente', () => {
        const k1 = gerarChaveAbrasf(nfseExemplo, '3505708');
        const k2 = gerarChaveAbrasf({ ...nfseExemplo, numero: '124' }, '3505708');
        expect(k1).not.toBe(k2);
    });
});

describe('mapearParaDocumentoFiscal', () => {
    it('servico TOMADO -> direcao=entrada', () => {
        const doc = mapearParaDocumentoFiscal(nfseExemplo, contextoTomado);
        expect(doc.direcao).toBe('entrada');
        expect(doc.tipo).toBe('NFSe');
        expect(doc.fonte).toBe('abrasf-adapter');
    });

    it('servico PRESTADO -> direcao=saida', () => {
        const doc = mapearParaDocumentoFiscal(nfseExemplo, { ...contextoTomado, tipo: 'prestado' });
        expect(doc.direcao).toBe('saida');
    });

    it('emitente eh o prestador', () => {
        const doc = mapearParaDocumentoFiscal(nfseExemplo, contextoTomado);
        expect(doc.emitente.cnpjCpf).toBe('11222333000181');
        expect(doc.emitente.nome).toBe('Prestador Demo');
        expect(doc.emitente.codMunIBGE).toBe('3505708');
    });

    it('destinatario eh o tomador', () => {
        const doc = mapearParaDocumentoFiscal(nfseExemplo, contextoTomado);
        expect(doc.destinatario.cnpjCpf).toBe('99888777000165');
        expect(doc.destinatario.nome).toBe('Tomador Demo');
    });

    it('totais agregam valores do servico', () => {
        const doc = mapearParaDocumentoFiscal(nfseExemplo, contextoTomado);
        expect(doc.totais.vProd).toBe(1000);
        expect(doc.totais.vNF).toBe(950);
        expect(doc.totais.vISS).toBe(50);
    });

    it('item unico com discriminacao + impostos', () => {
        const doc = mapearParaDocumentoFiscal(nfseExemplo, contextoTomado);
        expect(doc.itens).toHaveLength(1);
        const it = doc.itens[0];
        expect(it.xProd).toBe('Servico de consultoria');
        expect(it.aliquotaIss).toBe(5);
        expect(it.vISS).toBe(50);
        expect(it.itemListaServico).toBe('1.07');
    });

    it('chave eh determinada por gerarChaveAbrasf', () => {
        const doc = mapearParaDocumentoFiscal(nfseExemplo, contextoTomado);
        expect(doc.chave).toBe(gerarChaveAbrasf(nfseExemplo, '3505708'));
    });

    it('createdBy = system:abrasf-adapter (rastreabilidade)', () => {
        const doc = mapearParaDocumentoFiscal(nfseExemplo, contextoTomado);
        expect(doc.createdBy).toBe('system:abrasf-adapter');
    });
});
