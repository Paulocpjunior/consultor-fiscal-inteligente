/**
 * F0 automático da migração (03/08): as notas dizem quem tem ST/IPI/
 * interestadual, e o painel aponta candidatos a piloto do SPED.
 */
import { montarProntidaoMigracao } from '../sefaz-backend/migracao-prontidao.js';

// IE preenchida = contribuinte de ICMS (entrega EFD ICMS/IPI). Empresa de
// SERVIÇO não tem IE e por isso NÃO é alvo do piloto do SPED Fiscal —
// Paulo, 05/08: "essas empresas são prestadoras de serviços, não têm
// Inscrição Estadual".
const EMP = [
    { id: 'a', nome: 'LIMPA LTDA', cnpj: '11111111000111', regime: 'lucro', uf: 'SP', inscricaoEstadual: '111222333444' },
    { id: 'b', nome: 'SUBSTITUTA', cnpj: '22222222000122', regime: 'lucro', uf: 'SP', inscricaoEstadual: '222333444555' },
    { id: 'c', nome: 'INDUSTRIA', cnpj: '33333333000133', regime: 'lucro', uf: 'SP', inscricaoEstadual: '333444555666', industriaCadastro: true },
    { id: 'd', nome: 'SIMPLES', cnpj: '44444444000144', regime: 'simples', uf: 'SP', inscricaoEstadual: '444555666777' },
    { id: 'e', nome: 'SEM MOVIMENTO', cnpj: '55555555000155', regime: 'lucro', uf: 'SP', inscricaoEstadual: '555666777888' },
    { id: 'f', nome: 'ADVOGADOS S/S', cnpj: '66666666000166', regime: 'lucro', uf: 'SP' },            // sem IE
    { id: 'g', nome: 'CLINICA ISENTA', cnpj: '77777777000177', regime: 'lucro', uf: 'SP', inscricaoEstadual: 'ISENTO' },
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

describe('sem Inscrição Estadual não há SPED Fiscal para migrar', () => {
    // Paulo, 05/08, derrubando meu piloto: "essas empresas são prestadoras de
    // serviços, não têm Inscrição Estadual". Sem IE a empresa não é
    // contribuinte de ICMS e NÃO entrega EFD ICMS/IPI — piloto ali seria
    // comparar dois arquivos que não existem em sistema nenhum.
    const servico = (id: string) => ({
        empresaId: id, direcao: 'saida', status: 'autorizado', totais: {},
        cnpjEmit: EMP.find(e => e.id === id)!.cnpj, tipoDoc: 'NFSe',
    });

    it('prestadora de serviço (sem IE) NÃO é candidata a piloto', () => {
        const r = montarProntidaoMigracao([servico('f')] as any, EMP as any);
        const f = r.linhas.find(l => l.empresaId === 'f')!;
        expect(f.contribuinteIcms).toBe(false);
        expect(f.candidataPiloto).toBe(false);
    });

    it('IE "ISENTO" também não é contribuinte', () => {
        const r = montarProntidaoMigracao([servico('g')] as any, EMP as any);
        expect(r.linhas.find(l => l.empresaId === 'g')!.contribuinteIcms).toBe(false);
    });

    it('com IE de verdade, segue candidata', () => {
        const r = montarProntidaoMigracao([doc('a')] as any, EMP as any);
        const a = r.linhas.find(l => l.empresaId === 'a')!;
        expect(a.contribuinteIcms).toBe(true);
        expect(a.candidataPiloto).toBe(true);
    });

    it('o resumo separa quem entrega EFD ICMS/IPI de quem não entrega', () => {
        const r = montarProntidaoMigracao([doc('a'), servico('f'), servico('g')] as any, EMP as any);
        expect(r.resumo.contribuintesIcms).toBe(1);
        expect(r.resumo.semInscricaoEstadual).toBe(2);
    });
});

describe('sinal de BLOCO só bloqueia quem entrega EFD ICMS/IPI', () => {
    // Caso real 05/08: MV LIDER (Simples) apareceu com 58 vendas a não
    // contribuinte marcadas como BLOQUEIO de E310. Mas Simples Nacional não
    // entrega EFD ICMS/IPI — a escrituração dele é o PGDAS-D. O sinal é
    // informativo, e tratá-lo como bloqueio inflava a lista de problemas com
    // empresa que nunca vai gerar aquele arquivo.
    const comSt = (id: string) => ({
        empresaId: id, direcao: 'saida', tpNF: '1', status: 'autorizado',
        totais: { vST: 100 }, cnpjEmit: EMP.find(e => e.id === id)!.cnpj,
        ufEmit: 'SP', chave: `352607${EMP.find(e => e.id === id)!.cnpj}55` + '0'.repeat(22),
    });

    it('Lucro contribuinte: ST em saída é BLOQUEIO', () => {
        const r = montarProntidaoMigracao([comSt('b')] as any, EMP as any);
        const b = r.linhas.find(l => l.empresaId === 'b')!;
        expect(b.entregaEfdIcms).toBe(true);
        expect(b.bloqueios.join(' ')).toMatch(/E220/);
    });

    it('SIMPLES: o mesmo sinal vira ATENÇÃO, não bloqueio', () => {
        const r = montarProntidaoMigracao([comSt('d')] as any, EMP as any);
        const d = r.linhas.find(l => l.empresaId === 'd')!;
        expect(d.entregaEfdIcms).toBe(false);       // Simples não entrega EFD
        expect(d.bloqueios).toHaveLength(0);
        expect(d.atencoes.join(' ')).toMatch(/E220/);
    });

    it('prestadora sem IE também não é bloqueada por bloco do SPED', () => {
        const r = montarProntidaoMigracao([comSt('f')] as any, EMP as any);
        const f = r.linhas.find(l => l.empresaId === 'f')!;
        expect(f.bloqueios).toHaveLength(0);
        expect(f.atencoes.join(' ')).toMatch(/E220/);
    });
});

describe('as DUAS formas do documento (achatado × objeto)', () => {
    // Caso 05/08, com a carteira real: os 198 clientes apareceram com
    // "emissão própria 0" — inclusive um com 4.527 notas. A captura SEFAZ
    // grava ACHATADO (cnpjEmit/ufEmit); o núcleo lia só `emitente.*`, então
    // "a empresa é a emitente?" dava NÃO para todo mundo, e ST em saída, IPI,
    // E310 e compra interestadual saíam ZERADOS. Números falsos que quase
    // viraram decisão ("descartar o E310").
    const achatado = (empresaId: string, over: any = {}) => ({
        empresaId, direcao: 'saida', tpNF: '1', status: 'autorizado', modelo: '55',
        totais: {},
        cnpjEmit: EMP.find(e => e.id === empresaId)!.cnpj,   // sem `emitente`
        ufEmit: 'SP',
        ...over,
    });

    it('emissão própria é contada na forma ACHATADA', () => {
        const r = montarProntidaoMigracao([achatado('a'), achatado('a')] as any, EMP as any);
        expect(r.linhas.find(l => l.empresaId === 'a')!.emiteProprio).toBe(2);
    });

    it('SEM o campo `modelo`, o modelo vem da CHAVE (pos. 21-22)', () => {
        // 2º achado do mesmo caso: `modelo` NÃO é campo gravado — a captura
        // deriva da chave. Ler `d.modelo` direto dava undefined pra toda nota
        // capturada, e "emissão própria" ficou 0 mesmo com o CNPJ já correto.
        const cnpj = EMP.find(e => e.id === 'a')!.cnpj;
        const chave55 = `352607${cnpj}55` + '0'.repeat(22);
        const chave65 = `352607${cnpj}65` + '0'.repeat(22);
        const r = montarProntidaoMigracao([
            { empresaId: 'a', direcao: 'saida', tpNF: '1', status: 'autorizado',
              totais: {}, cnpjEmit: cnpj, ufEmit: 'SP', chave: chave55 },
            { empresaId: 'a', direcao: 'saida', tpNF: '1', status: 'autorizado',
              totais: {}, cnpjEmit: cnpj, ufEmit: 'SP', chave: chave65 },
        ] as any, EMP as any);
        const a = r.linhas.find(l => l.empresaId === 'a')!;
        expect(a.emiteProprio).toBe(2);
        expect(a.porTipo).toMatchObject({ NFe: 1, NFCe: 1 });
    });

    it('NFS-e não tem chave de 44 dígitos — não pode virar NF-e por fallback', () => {
        const r = montarProntidaoMigracao([
            { empresaId: 'a', direcao: 'saida', status: 'autorizado',
              totais: {}, cnpjEmit: EMP[0].cnpj, tipoDoc: 'NFSe' },
        ] as any, EMP as any);
        const a = r.linhas.find(l => l.empresaId === 'a')!;
        expect(a.porTipo.NFSe).toBe(1);
        expect(a.porTipo.NFe).toBe(0);
        expect(a.emiteProprio).toBe(0);      // NFS-e não é emissão de NF-e
    });

    it('ST em saída própria é detectado na forma ACHATADA', () => {
        const r = montarProntidaoMigracao(
            [achatado('b', { totais: { vST: 100 } })] as any, EMP as any,
        );
        const b = r.linhas.find(l => l.empresaId === 'b')!;
        expect(b.stSaidas).toBe(1);
        expect(b.bloqueios.join(' ')).toMatch(/E220/);
    });

    it('E310 (CFOP 6108) é detectado na forma ACHATADA', () => {
        const r = montarProntidaoMigracao(
            [achatado('a', { itens: [{ cfop: '6108' }] })] as any, EMP as any,
        );
        expect(r.resumo.comVendaNaoContribuinte).toBe(1);
    });

    it('compra interestadual usa a UF do emitente ACHATADA', () => {
        const r = montarProntidaoMigracao([
            { empresaId: 'a', direcao: 'entrada', status: 'autorizado', modelo: '55',
              totais: {}, cnpjEmit: '99999999000199', ufEmit: 'MG' },
        ] as any, EMP as any);
        expect(r.linhas.find(l => l.empresaId === 'a')!.entradasInterestaduais).toBe(1);
    });

    it('e a forma OBJETO continua funcionando (as duas convivem)', () => {
        const r = montarProntidaoMigracao([achatado('a'), doc('a')] as any, EMP as any);
        expect(r.linhas.find(l => l.empresaId === 'a')!.emiteProprio).toBe(2);
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
