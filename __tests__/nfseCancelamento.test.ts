// ============================================================================
// 🚨 NOTA CANCELADA CONTANDO NO FATURAMENTO
//
// 02/09, MARCOS ANTONIO ZAMBOLIN INFORMATICA · 08/2026. A NFS-e 205 de Santo
// André tem o carimbo **CANCELADA** na cara do PDF ("Motivo Cancelamento:
// Preenchimento incompleto da NFS-e") e o app a mostrava como 🟢 Vigente. O
// relatório de Serviços Prestados somou **R$ 27.219,10** num mês cuja receita
// é **R$ 13.609,55** — a 206 substitui a 205, e as duas foram contadas.
//
// Na NFS-e o cancelamento está DENTRO do documento (não há evento). O leitor
// conhecia duas tags e a de Santo André não é nenhuma delas.
// ============================================================================
import { cancelamentoDeclarado, nomeLocal } from '../services/nfseCancelamento';

describe('cancelamentoDeclarado — lê o vocabulário, não uma lista de nomes', () => {
    it('a forma que o leitor JÁ conhecia continua valendo', () => {
        const r = cancelamentoDeclarado([
            { tag: 'DataHoraCancelamento', texto: '2026-08-06T21:32:32' },
        ]);
        expect(r.cancelada).toBe(true);
        expect(r.tag).toBe('DataHoraCancelamento');
    });

    // O caso REAL do print: a prefeitura declara pelo MOTIVO.
    it('o motivo de Santo André cancela — e era ele que passava batido', () => {
        const r = cancelamentoDeclarado([
            { tag: 'MotivoCancelamento', texto: 'Preenchimento incompleto da NFS-e' },
        ]);
        expect(r.cancelada).toBe(true);
        expect(r.texto).toBe('Preenchimento incompleto da NFS-e');
    });

    // ⚠️ Trava por LISTA cobre o que alguém lembrou: qualquer prefeitura nova
    // entra sozinha, sem ninguém acrescentar nome nenhum.
    it('prefeitura com outro nome de tag entra sozinha', () => {
        expect(cancelamentoDeclarado([{ tag: 'JustificativaCancelamento', texto: 'erro de digitação' }]).cancelada).toBe(true);
        expect(cancelamentoDeclarado([{ tag: 'ns2:CodigoCancelamento', texto: '1' }]).cancelada).toBe(true);
    });

    // 🚨 O LADO CARO DO ERRO: marcar nota VÁLIDA como cancelada apaga receita
    // de um livro fiscal — pior que deixar cancelada passar. Por isso a régua
    // é conservadora.
    it('tag vazia NÃO cancela', () => {
        expect(cancelamentoDeclarado([{ tag: 'MotivoCancelamento', texto: '   ' }]).cancelada).toBe(false);
    });

    it('valor negativo NÃO cancela — `PodeCancelamento=false` não é cancelamento', () => {
        for (const v of ['false', '0', 'N', 'não', 'nao', 'no']) {
            expect(cancelamentoDeclarado([{ tag: 'PermiteCancelamento', texto: v }]).cancelada).toBe(false);
        }
    });

    // 🚨 SUBSTITUIÇÃO FICA DE FORA, e é decisão: `NfseSubstituida` e
    // `NfseSubstituidora` apontam para lados OPOSTOS (uma diz "fui
    // substituída", a outra "eu substituo"). Trocar as duas apagaria a nota
    // BOA — sem o XML na mão, não se decide isso.
    it('substituição não é lida como cancelamento', () => {
        expect(cancelamentoDeclarado([{ tag: 'NfseSubstituidora', texto: '206' }]).cancelada).toBe(false);
        expect(cancelamentoDeclarado([{ tag: 'NfseSubstituida', texto: '205' }]).cancelada).toBe(false);
    });

    it('nota normal continua vigente', () => {
        const r = cancelamentoDeclarado([
            { tag: 'Numero', texto: '206' },
            { tag: 'ValorServicos', texto: '13609.55' },
        ]);
        expect(r).toEqual({ cancelada: false, tag: null, texto: null });
    });
});

describe('nomeLocal', () => {
    it('tira o prefixo de namespace', () => {
        expect(nomeLocal('ns2:MotivoCancelamento')).toBe('MotivoCancelamento');
        expect(nomeLocal('MotivoCancelamento')).toBe('MotivoCancelamento');
    });
});
