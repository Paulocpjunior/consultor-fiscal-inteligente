// ============================================================================
// 🚨 A COLUNA PRESTADOR/TOMADOR SAÍA "—" NUM MÊS E CHEIA NO OUTRO
//
// 28/08, Paulo, no modal de Relatórios: *"veja a diferença de um mês para o
// outro com relação ao campo prestador de serviços"*.
//
// A causa é a armadilha das DUAS FORMAS, agora no relatório de Serviços
// tomados/prestados: `linhasServicos` escolhia a contraparte com
// `d.tomador || d.destinatario` / `d.prestador || d.emitente` — **só o bloco
// ANINHADO**. E a NFS-e do **portal de SP**, que é o trilho da maioria das
// notas, grava `prestadorNome`/`tomadorNome` e `xNomeEmit`/`xNomeDest`
// ACHATADOS e **não grava bloco aninhado nenhum**.
//
// Então: mês importado pelo NAVEGADOR (que grava `{prestador, tomador}`) →
// coluna cheia. Mês capturado pelo PORTAL → coluna "—" na competência inteira.
// Mesma tela, mesmo cliente, dois meses contando histórias diferentes.
//
// ⚠️ E a régua já existia NO MESMO ARQUIVO: `contraparteDoc`, que lê as duas
// formas e conhece a nota própria de entrada. `linhasRetencoes` e
// `servicosPorCodigo` já a chamavam — `linhasServicos` era a única que ainda
// perguntava sozinha.
// ============================================================================
import { contraparteDoc, linhasServicos } from '../services/relatoriosAgregacoes';
import type { DocumentoFiscal } from '../types';

const CNPJ_EMPRESA = '13344638000191';

/**
 * A NFS-e como o **CSV do portal de SP** a grava (`nfse-sp-csv-importer.js`):
 * nenhum bloco aninhado, os dois lados achatados em DOIS vocabulários.
 */
const doPortalSp = (over: Partial<DocumentoFiscal> = {}): DocumentoFiscal => ({
    id: 'p1',
    tipo: 'NFSe',
    tipoDoc: 'NFSe',
    fonte: 'csv-portal-sp',
    numero: '55758',
    dhEmi: '2026-07-15T09:00:00-03:00',
    direcao: 'entrada',
    status: 'autorizado',
    empresaCnpj: CNPJ_EMPRESA,
    prestadorCnpj: '62465117000106',
    prestadorNome: 'ATLAS SCHINDLER LTDA',
    tomadorCnpj: CNPJ_EMPRESA,
    tomadorNome: 'CLINICA MEDICA MANTOAN',
    cnpjEmit: '62465117000106',
    xNomeEmit: 'ATLAS SCHINDLER LTDA',
    cnpjDest: CNPJ_EMPRESA,
    xNomeDest: 'CLINICA MEDICA MANTOAN',
    valorTotal: 1000,
    ...over,
} as any);

/** A MESMA nota como o import pelo NAVEGADOR a grava: bloco ANINHADO. */
const doNavegador = (over: Partial<DocumentoFiscal> = {}): DocumentoFiscal => ({
    id: 'n1',
    tipo: 'NFSe',
    tipoDoc: 'NFSe',
    numero: '55758',
    dhEmi: '2026-07-15T09:00:00-03:00',
    direcao: 'entrada',
    status: 'autorizado',
    empresaCnpj: CNPJ_EMPRESA,
    prestador: { cnpjCpf: '62465117000106', nome: 'ATLAS SCHINDLER LTDA' },
    tomador: { cnpjCpf: CNPJ_EMPRESA, nome: 'CLINICA MEDICA MANTOAN' },
    valorTotal: 1000,
    ...over,
} as any);

describe('🚨 o caso do print — os dois meses têm de dizer a MESMA coisa', () => {
    it('a nota do PORTAL nomeia o prestador (era o mês que saía "—")', () => {
        const [l] = linhasServicos([doPortalSp()], 'entrada');
        expect(l.participante).toBe('ATLAS SCHINDLER LTDA');
        expect(l.doc).toBe('62465117000106');
    });

    it('a nota do NAVEGADOR nomeia o mesmo prestador — nada regride', () => {
        const [l] = linhasServicos([doNavegador()], 'entrada');
        expect(l.participante).toBe('ATLAS SCHINDLER LTDA');
        expect(l.doc).toBe('62465117000106');
    });

    // 🚨 É ISTO que o Paulo viu: as duas formas na MESMA lista, e a coluna
    // respondendo diferente para o mesmo fato.
    it('as duas formas juntas devolvem a MESMA contraparte', () => {
        const linhas = linhasServicos([doPortalSp(), doNavegador()], 'entrada');
        expect(linhas).toHaveLength(2);
        expect(new Set(linhas.map((l) => l.participante))).toEqual(new Set(['ATLAS SCHINDLER LTDA']));
        expect(linhas.every((l) => l.doc === '62465117000106')).toBe(true);
    });

    // Do lado PRESTADO a contraparte é o TOMADOR — e o vocabulário achatado
    // dele é outro (`tomadorNome`), que era a segunda metade do buraco.
    it('em Serviços prestados a coluna traz o TOMADOR, nas duas formas', () => {
        const portal = linhasServicos([doPortalSp({ direcao: 'saida' } as any)], 'saida');
        const nav = linhasServicos([doNavegador({ direcao: 'saida' } as any)], 'saida');
        expect(portal[0].participante).toBe('CLINICA MEDICA MANTOAN');
        expect(nav[0].participante).toBe('CLINICA MEDICA MANTOAN');
    });
});

describe('o aninhado PELA METADE não apaga o achatado', () => {
    // 🚨 A NFS-e do **ADN** grava `prestador: { cnpjCpf }` — bloco COM
    // documento e SEM NOME. Um `temLado ? aninhado : chato` puro daria esse
    // bloco por resposta e a coluna sairia vazia com o nome gravado no campo
    // do lado. O aninhado vence CAMPO A CAMPO, não em bloco.
    it('bloco do ADN sem nome ainda assim nomeia o prestador pelo campo achatado', () => {
        const doAdn = doPortalSp({
            id: 'adn1',
            tipo: 'nfseNacional',
            prestador: { cnpjCpf: '62465117000106' },
        } as any);
        const [l] = linhasServicos([doAdn], 'entrada');
        expect(l.participante).toBe('ATLAS SCHINDLER LTDA');
    });

    it('o valor do ANINHADO vence quando ele existe — não é o achatado que manda', () => {
        const d = doPortalSp({
            prestador: { cnpjCpf: '62465117000106', nome: 'NOME DO XML' },
        } as any);
        expect(contraparteDoc(d).nome).toBe('NOME DO XML');
    });
});

describe('sem contraparte legível, DIZ que não sabe', () => {
    // Ausência continua sendo dita: '—' aqui é honesto, e é diferente de '—'
    // sobre um nome que estava gravado no campo do lado.
    it('nota sem nenhum lado gravado sai com "—", nunca com nome inventado', () => {
        const [l] = linhasServicos([{
            id: 'x', tipo: 'NFSe', tipoDoc: 'NFSe', numero: '1',
            dhEmi: '2026-07-01T09:00:00-03:00', direcao: 'entrada',
            status: 'autorizado', empresaCnpj: CNPJ_EMPRESA, valorTotal: 10,
        } as any], 'entrada');
        expect(l.participante).toBe('—');
        expect(l.doc).toBe('');
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 A CÓPIA NÃO VOLTA. Esta é a 3ª vez que a contraparte é reescrita neste
// arquivo (o Livro em 12/08, os relatórios em 22/08, agora os serviços): a
// varredura barra a escolha do lado feita à mão, que é a forma como ela sempre
// renasce.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 quem escolhe o lado é o dono', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const src: string = fs.readFileSync(
        path.resolve(__dirname, '..', 'services/relatoriosAgregacoes.ts'), 'utf8',
    );
    // Só CÓDIGO — comentário que EXPLICA a correção não pode reprovar a
    // correção (a trava do ISS mordeu assim em 22/08).
    const codigo = src
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
        .join('\n');

    it('nenhuma linha escolhe a contraparte com `d.tomador || d.destinatario`', () => {
        expect(codigo).not.toMatch(/d\.tomador\s*\|\|\s*d\.destinatario/);
        expect(codigo).not.toMatch(/d\.prestador\s*\|\|\s*d\.emitente/);
    });

    it('`linhasServicos` chama o dono', () => {
        const i = codigo.indexOf('export function linhasServicos');
        expect(i).toBeGreaterThan(-1);
        expect(codigo.slice(i, i + 2500)).toMatch(/contraparteDoc\(d\)/);
    });
});
