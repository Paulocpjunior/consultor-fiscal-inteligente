// @ts-nocheck — módulo .js do backend (sem tipos)
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseCsvNftsSp, mapearColunas } from '../sefaz-backend/nfts-sp-csv-parser.js';

/**
 * PARSER DO EXPORT DE NFTS (portal nfe.prefeitura.sp.gov.br).
 *
 * A fixture é o ARQUIVO REAL enviado pelo Paulo em 12/08/2026
 * (`NFTS_66958369_20260701_20260731.csv`) — e ele está VAZIO: o portal devolveu
 * `Total;0`, zero NFTS no período.
 *
 * Foi esse arquivo que produziu, na aba de NFS-e, a mensagem "NENHUMA linha de
 * nota foi reconhecida" — e mandou a pessoa procurar defeito onde não havia
 * nenhum. Export vazio é RESPOSTA, não falha. Estes testes travam isso, e
 * travam também o contrário: zero NFTS não pode virar um "ok" mudo, porque pode
 * significar obrigação não cumprida.
 */
const arquivoReal = () => readFileSync(join(__dirname, 'fixtures', 'nfts-sp-export-vazio.csv'));

describe('layout real do export de NFTS', () => {
    it('lê o arquivo do portal sem erro e reconhece as 147 colunas', () => {
        const r = parseCsvNftsSp(arquivoReal());
        expect(r.colunas).toBe(147);
        expect(r.colunasFaltando).toEqual([]);
    });

    it('mapeia as colunas por NOME — índice fixo seria inventar leiaute', () => {
        // Só vi export VAZIO: as linhas de nota nunca foram conferidas. Casar por
        // nome faz uma coluna nova no meio (o layout já traz IBS/CBS da reforma)
        // não deslocar nada.
        const cab = arquivoReal().toString('latin1').split(/\r?\n/)[0].split(';');
        const col = mapearColunas(cab);
        expect(col.numero).toBe(1);
        expect(col.valorServicos).toBe(25);
        expect(col.valorIss).toBe(30);
        expect(col.docPrestador).toBe(33);
        expect(col.discriminacao).toBe(146);
    });

    it('acentuação ISO-8859-1 não quebra o casamento das colunas', () => {
        const col = mapearColunas(['Tipo de Registro', 'Nº NFTS', 'Alíquota']);
        expect(col.numero).toBe(1);
        expect(col.aliquota).toBe(2);
    });
});

describe('export VAZIO é resposta, não falha', () => {
    it('reconhece "Total;0" como período SEM NFTS', () => {
        const r = parseCsvNftsSp(arquivoReal());
        expect(r.notas).toEqual([]);
        expect(r.totalDeclarado).toBe(0);
        expect(r.periodoSemNfts).toBe(true);
    });

    it('lê os totais declarados pelo portal', () => {
        const r = parseCsvNftsSp(arquivoReal());
        expect(r.valorServicosDeclarado).toBe(0);
        expect(r.valorIssDeclarado).toBe(0);
    });

    // A parte que importa fiscalmente: zero não encerra o assunto.
    it('a ação diz que o arquivo está certo E que zero NÃO é conclusão', () => {
        const r = parseCsvNftsSp(arquivoReal());
        expect(r.acao).toMatch(/arquivo está correto/i);
        expect(r.acao).toMatch(/DEVERIA ter sido emitida/i);
        expect(r.acao).toMatch(/ISS retido não foi declarado/i);
    });
});

describe('linha de nota', () => {
    const cab = 'Tipo de Registro;Nº NFTS;Data Hora Emissão NFTS;Data da Prestação de Serviços;'
        + 'Inscrição Municipal do Tomador;CPF/CNPJ do Tomador;Razão Social do Tomador;'
        + 'Data de Cancelamento;Valor dos Serviços;Valor das Deduções;'
        + 'Código do Serviço Prestado na NFTS;Código do Subitem da Lista;Alíquota;Valor ISS;ISS Retido;'
        + 'CPF/CNPJ do Prestador;Inscrição Municipal do Prestador;Razão Social do Prestador;'
        + 'UF do Prestador;Cidade do Prestador;Discriminação dos Serviços';

    const linha = (over: string[] = []) => {
        const base = ['2', '1234', '05/07/2026 10:00', '01/07/2026',
            '6.695.836-9', '11.222.333/0001-44', 'TOMADOR LTDA',
            '', '1.500,00', '0,00',
            '07498', '7.02', '5,00', '75,00', 'Sim',
            '99.888.777/0001-11', '', 'PRESTADOR SA',
            'RJ', 'Rio de Janeiro', 'Serviço de manutenção'];
        over.forEach((v, i) => { if (v !== undefined) base[i] = v; });
        return base.join(';');
    };

    it('extrai a nota com prestador, valores e ISS', () => {
        const r = parseCsvNftsSp(`${cab}\n${linha()}\nTotal;1;;;;;;;1.500,00;0,00;;;;75,00`);
        expect(r.notas).toHaveLength(1);
        const n = r.notas[0];
        expect(n.numero).toBe('1234');
        expect(n.valorServicos).toBe(1500);
        expect(n.valorIss).toBe(75);
        expect(n.aliquota).toBe(5);
        expect(n.docPrestador).toBe('99888777000111');   // só dígitos
        expect(n.ufPrestador).toBe('RJ');
        expect(n.issRetido).toBe('Sim');
        expect(n.cancelada).toBe(false);
        expect(r.periodoSemNfts).toBe(false);
    });

    it('data de cancelamento preenchida marca a nota como CANCELADA', () => {
        const r = parseCsvNftsSp(`${cab}\n${linha(['2', '1234', '', '', '', '', '', '10/07/2026'])}`);
        expect(r.notas[0].cancelada).toBe(true);
    });

    // Campo fiscal não recebe default: vazio ≠ zero.
    it('valor VAZIO vira null, não 0', () => {
        const r = parseCsvNftsSp(`${cab}\n${linha(['2', '1234', '', '', '', '', '', '', '', '', '', '', '', ''])}`);
        expect(r.notas[0].valorServicos).toBeNull();
        expect(r.notas[0].valorIss).toBeNull();
    });

    it('arquivo de OUTRO documento (colunas essenciais ausentes) não vira nota', () => {
        const r = parseCsvNftsSp('Coluna A;Coluna B\n2;qualquer coisa');
        expect(r.notas).toEqual([]);
        expect(r.colunasFaltando.length).toBeGreaterThan(0);
        expect(r.colunasFaltando).toContain('Nº NFTS');
    });

    it('arquivo vazio LANÇA — não devolve "zero notas" em silêncio', () => {
        expect(() => parseCsvNftsSp('')).toThrow(/vazio/i);
    });
});
