/**
 * F0 automático da migração (03/08): as notas dizem quem tem ST/IPI/
 * interestadual, e o painel aponta candidatos a piloto do SPED.
 */
import { montarProntidaoMigracao } from '../sefaz-backend/migracao-prontidao.js';

const EMP = [
    { id: 'a', nome: 'LIMPA LTDA', cnpj: '11111111000111', regime: 'lucro', uf: 'SP' },
    { id: 'b', nome: 'SUBSTITUTA', cnpj: '22222222000122', regime: 'lucro', uf: 'SP' },
    { id: 'c', nome: 'INDUSTRIA', cnpj: '33333333000133', regime: 'lucro', uf: 'SP', industriaCadastro: true },
    { id: 'd', nome: 'SIMPLES', cnpj: '44444444000144', regime: 'simples', uf: 'SP' },
    { id: 'e', nome: 'SEM MOVIMENTO', cnpj: '55555555000155', regime: 'lucro', uf: 'SP' },
];

const doc = (empresaId: string, over: any = {}) => ({
    empresaId, direcao: 'saida', tpNF: '1', status: 'autorizado', modelo: '55',
    totais: {}, emitente: { cnpjCpf: EMP.find(e => e.id === empresaId)!.cnpj, uf: 'SP' },
    ...over,
});

describe('EC 87/15 — venda interestadual a NÃO CONTRIBUINTE (E310/E316)', () => {
    // Antes de construir o E310 é preciso saber se ALGUÉM faz essa operação —
    // a mesma disciplina que descartou o SAT e o regime de caixa. O CFOP é a
    // prova: 6107/6108 só existem pra venda a não contribuinte.
    const comCfop = (id: string, cfop: string) =>
        doc(id, { itens: [{ cfop }] });

    it('CFOP 6108 numa saída própria vira BLOQUEIO nomeando o E310', () => {
        const r = montarProntidaoMigracao([comCfop('a', '6108')] as any, EMP as any);
        const a = r.linhas.find(l => l.empresaId === 'a')!;
        expect(a.saidasNaoContribuinte).toBe(1);
        expect(a.bloqueios.join(' ')).toMatch(/E310\/E316/);
        expect(a.candidataPiloto).toBe(false);   // não migra sem o bloco
        expect(r.resumo.comVendaNaoContribuinte).toBe(1);
    });

    it('venda interestadual a CONTRIBUINTE (6102) NÃO é EC 87/15', () => {
        const r = montarProntidaoMigracao([comCfop('a', '6102')] as any, EMP as any);
        const a = r.linhas.find(l => l.empresaId === 'a')!;
        expect(a.saidasNaoContribuinte).toBe(0);
        expect(a.candidataPiloto).toBe(true);
    });

    it('ENTRADA com 6108 (o fornecedor é que vendeu assim) não conta pra nós', () => {
        const r = montarProntidaoMigracao([
            doc('a', { direcao: 'entrada', emitente: { cnpjCpf: '9', uf: 'MG' }, itens: [{ cfop: '6108' }] }),
        ] as any, EMP as any);
        expect(r.linhas.find(l => l.empresaId === 'a')!.saidasNaoContribuinte).toBe(0);
    });

    it('carteira COM itens e sem 6107/6108 = zero — autoriza DESCARTAR o bloco', () => {
        const r = montarProntidaoMigracao(
            [comCfop('a', '5102'), comCfop('b', '6102')] as any, EMP as any,
        );
        expect(r.resumo.comVendaNaoContribuinte).toBe(0);
        expect(r.resumo.vendaNaoContribuinteApurada).toBe(true);
        expect(r.perguntasEquipe.join(' ')).toMatch(/ZERO empresa marcada/);
    });

    it('SEM itens na leitura é "NÃO APURADO" (null), NUNCA zero', () => {
        // O bug que isto impede: a rota busca com projeção e, se `itens` não
        // vier, o detector diria "ninguém faz essa operação" — e o bloco seria
        // descartado com base num número que só significa "não se olhou".
        const r = montarProntidaoMigracao([doc('a'), doc('b')] as any, EMP as any);
        expect(r.resumo.comVendaNaoContribuinte).toBeNull();
        expect(r.resumo.vendaNaoContribuinteApurada).toBe(false);
        expect(r.linhas.find(l => l.empresaId === 'a')!.saidasNaoContribuinte).toBeNull();
        // E não pode bloquear piloto por um sinal que não foi medido.
        expect(r.linhas.find(l => l.empresaId === 'a')!.candidataPiloto).toBe(true);
    });
});

describe('cobertura documental — o que a ponte .FML NÃO leva', () => {
    // Paulo, 05/08: "o que mais o e-fiscal importa hoje? nada". Se nada mais
    // entra lá e a ponte só manda NF-e/NFC-e, então CT-e (crédito de frete) e
    // NFS-e (retenções) não estão no livro do E-Fiscal — no mês corrente.
    const docTipo = (id: string, over: any) => doc(id, over);

    it('conta CT-e e NFS-e separados e marca o que fica fora da ponte', () => {
        const r = montarProntidaoMigracao([
            docTipo('a', { modelo: '55' }),
            docTipo('a', { modelo: '65' }),
            docTipo('a', { modelo: '57' }),                    // CT-e
            docTipo('a', { modelo: null, tipoDoc: 'NFSe' }),   // NFS-e
        ] as any, EMP as any);
        const a = r.linhas.find(l => l.empresaId === 'a')!;
        expect(a.porTipo).toMatchObject({ NFe: 1, NFCe: 1, CTe: 1, NFSe: 1 });
        expect(a.foraDaPonte).toBe(2);                          // CT-e + NFS-e
        expect(r.resumo.comCte).toBe(1);
        expect(r.resumo.comNfse).toBe(1);
        expect(r.resumo.docsForaDaPonte).toBe(2);
    });

    it('vira ATENÇÃO nomeando o que o E-Fiscal não recebeu', () => {
        const r = montarProntidaoMigracao([
            docTipo('a', { modelo: '57' }), docTipo('a', { modelo: '57' }),
        ] as any, EMP as any);
        const txt = r.linhas.find(l => l.empresaId === 'a')!.atencoes.join(' ');
        expect(txt).toMatch(/2 documento\(s\) que a ponte .FML NÃO leva/);
        expect(txt).toMatch(/2 CT-e/);
    });

    it('resumo de CT-e/NFS-e é ausente ≠ zero só quando não há documento', () => {
        const r = montarProntidaoMigracao([docTipo('a', { modelo: '55' })] as any, EMP as any);
        expect(r.resumo.comCte).toBe(0);       // olhamos e não há — zero legítimo
        expect(r.linhas.find(l => l.empresaId === 'a')!.foraDaPonte).toBe(0);
    });

    it('resumo do tipo vem do MODELO (fonte forte), não só do campo tipo', () => {
        const r = montarProntidaoMigracao([
            docTipo('a', { modelo: '57', tipoDoc: 'NFe' }),   // modelo manda
        ] as any, EMP as any);
        expect(r.linhas.find(l => l.empresaId === 'a')!.porTipo.CTe).toBe(1);
    });
});

describe('montarProntidaoMigracao', () => {
    it('aponta candidata a piloto: Lucro com movimento e sem bloqueio', () => {
        const r = montarProntidaoMigracao([
            doc('a'), doc('a', { direcao: 'entrada', emitente: { cnpjCpf: '9', uf: 'SP' } }),
        ] as any, EMP as any);
        const a = r.linhas.find(l => l.empresaId === 'a')!;
        expect(a.candidataPiloto).toBe(true);
        expect(a.emiteProprio).toBe(1);
        expect(r.resumo.candidatasPiloto).toBe(1);
    });

    it('ST em SAÍDA bloqueia (substituto → E220); ST em entrada é só atenção', () => {
        const r = montarProntidaoMigracao([
            doc('b', { totais: { vST: 120 } }),
            doc('a', { direcao: 'entrada', emitente: { cnpjCpf: '9', uf: 'SP' }, totais: { vST: 50 } }),
        ] as any, EMP as any);
        const b = r.linhas.find(l => l.empresaId === 'b')!;
        expect(b.candidataPiloto).toBe(false);
        expect(b.bloqueios[0]).toMatch(/E220/);
        const a = r.linhas.find(l => l.empresaId === 'a')!;
        expect(a.candidataPiloto).toBe(true);
        expect(a.atencoes.some(x => /substituído/.test(x))).toBe(true);
    });

    it('IPI em saída ou indústria no cadastro barram o piloto (bloco K/CIAP)', () => {
        const r = montarProntidaoMigracao([
            doc('c'),
            doc('a', { totais: { vIPI: 10 } }),
        ] as any, EMP as any);
        expect(r.linhas.find(l => l.empresaId === 'c')!.candidataPiloto).toBe(false);
        expect(r.linhas.find(l => l.empresaId === 'a')!.bloqueios[0]).toMatch(/bloco K/);
    });

    it('compra interestadual vira atenção (DIFAL), não bloqueio', () => {
        const r = montarProntidaoMigracao([
            doc('a', { direcao: 'entrada', emitente: { cnpjCpf: '9', uf: 'MG' } }),
        ] as any, EMP as any);
        const a = r.linhas.find(l => l.empresaId === 'a')!;
        expect(a.entradasInterestaduais).toBe(1);
        expect(a.candidataPiloto).toBe(true);
        expect(a.atencoes[0]).toMatch(/DIFAL/);
    });

    it('Simples e sem-movimento ficam fora do piloto; cancelada não conta', () => {
        const r = montarProntidaoMigracao([
            doc('d'),
            doc('a', { status: 'cancelado' }),
        ] as any, EMP as any);
        expect(r.linhas.find(l => l.empresaId === 'd')!.candidataPiloto).toBe(false);
        expect(r.linhas.find(l => l.empresaId === 'a')).toBeUndefined();  // só a cancelada → sem movimento
        expect(r.linhas.find(l => l.empresaId === 'e')).toBeUndefined();
    });

    it('nota própria de entrada (tpNF=0) não conta como saída própria', () => {
        const r = montarProntidaoMigracao([
            doc('a', { tpNF: '0', direcao: 'entrada', totais: { vIPI: 5, vST: 5 } }),
        ] as any, EMP as any);
        const a = r.linhas.find(l => l.empresaId === 'a')!;
        expect(a.ipiSaidas).toBe(0);
        expect(a.stSaidas).toBe(0);
        expect(a.stEntradas).toBe(1);
    });
});
