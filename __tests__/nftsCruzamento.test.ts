// @ts-nocheck — módulo .js do backend (sem tipos)
import { exigeNfts, cruzarServicosComNfts } from '../sefaz-backend/nfts-cruzamento.js';

/**
 * SERVIÇO TOMADO × NFTS: onde falta NFTS.
 *
 * O caso real (07/2026) tem prestadores em BARUERI e FLORIANÓPOLIS — os dois
 * exigem NFTS, e o de Barueri mostra por quê a régua olha MUNICÍPIO e não UF:
 * Barueri é SP no estado e não emite NFS-e paulistana.
 */
const servico = (over = {}) => ({ doc: '54402122000133', base: 690, issRetido: 0, municipio: 'Barueri', ...over });
const nfts = (over = {}) => ({ numero: '66', docPrestador: '54402122000133', valorServicos: 690, cancelada: false, ...over });

describe('exigeNfts — município decide, não a UF', () => {
    it('prestador em São Paulo NÃO exige (emite NFS-e paulistana)', () => {
        expect(exigeNfts(servico({ municipio: 'São Paulo' })).veredito).toBe('nao-exige');
        expect(exigeNfts(servico({ municipio: '', codMunIBGE: '3550308' })).veredito).toBe('nao-exige');
    });

    it('Barueri é SP no estado e EXIGE NFTS — não emite NFS-e paulistana', () => {
        expect(exigeNfts(servico({ municipio: 'Barueri' })).veredito).toBe('exige');
    });

    it('outro estado exige', () => {
        expect(exigeNfts(servico({ municipio: 'Florianópolis' })).veredito).toBe('exige');
    });

    // A resposta que impede o falso verde.
    it('município ausente vira INDETERMINADO, nunca "não exige"', () => {
        const r = exigeNfts({ doc: '1', base: 100 });
        expect(r.veredito).toBe('indeterminado');
        expect(r.motivo).toMatch(/não dá pra dizer/i);
    });
});

describe('cruzamento', () => {
    it('serviço com NFTS emitida fica coberto', () => {
        const r = cruzarServicosComNfts([servico()], [nfts()]);
        expect(r.semNfts).toEqual([]);
        expect(r.cobertos[0].nftsNumero).toBe('66');
    });

    it('serviço de fora de SP SEM NFTS vira LACUNA com o ISS não declarado', () => {
        const r = cruzarServicosComNfts([servico({ issRetido: 34.5 })], []);
        expect(r.semNfts).toHaveLength(1);
        expect(r.resumo.issRetidoNaoDeclarado).toBe(34.5);
        expect(r.resumo.totalSemNfts).toBe(690);
    });

    it('NFTS cancelada não cobre nada', () => {
        const r = cruzarServicosComNfts([servico()], [nfts({ cancelada: true })]);
        expect(r.semNfts).toHaveLength(1);
    });

    it('uma NFTS cobre UM serviço — a segunda continua descoberta', () => {
        const r = cruzarServicosComNfts([servico(), servico()], [nfts()]);
        expect(r.cobertos).toHaveLength(1);
        expect(r.semNfts).toHaveLength(1);
    });

    it('mesmo prestador com várias NFTS: o VALOR desempata', () => {
        const r = cruzarServicosComNfts(
            [servico({ base: 5000 })],
            [nfts({ numero: '66', valorServicos: 690 }), nfts({ numero: '67', valorServicos: 5000 })],
        );
        expect(r.cobertos[0].nftsNumero).toBe('67');
    });

    it('NFTS sem serviço correspondente NÃO é erro do cliente — é captura faltando', () => {
        const r = cruzarServicosComNfts([], [nfts()]);
        expect(r.nftsSemServico).toHaveLength(1);
        expect(r.semNfts).toEqual([]);
    });

    // ⚠️ A regra que impede o pior farol: o que dá verde por não ter olhado.
    it('SEMPRE declara que a cobertura é PARCIAL, inclusive sem lacuna nenhuma', () => {
        const r = cruzarServicosComNfts([servico()], [nfts()]);
        expect(r.semNfts).toEqual([]);
        expect(r.semLacunaMasParcial).toBe(true);
        expect(r.cobertura).toMatch(/PARCIAL/);
        expect(r.cobertura).toMatch(/nunca conformidade/i);
    });
});
