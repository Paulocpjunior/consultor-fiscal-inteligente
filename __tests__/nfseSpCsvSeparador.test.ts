/**
 * O portal de SP exporta o MESMO layout de 73 colunas em DOIS formatos: CSV
 * com ";" e TXT com TAB.
 *
 * O parser só entendia ";", e a rota ainda rotulava todo .txt de "TXT de
 * largura fixa" — que ele não é. A equipe subia o export do portal e recebia
 * "não sei ler" sobre um arquivo perfeitamente legível (arquivo real do Paulo,
 * 07/08: NFS-e tomadas de 07/2026, 6 notas, separado por TAB).
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { parseCsvNfseSp, detectarSeparador, identificarDocumentoDoPortal } from '../sefaz-backend/nfse-sp-csv-parser';

const CABECALHO = ['Tipo de Registro', 'N NFS-e', 'Data Hora NFE'];
const linha = (sep: string) => CABECALHO.join(sep) + sep + Array(70).fill('x').join(sep);

describe('quem decide o separador é o cabeçalho', () => {
    it('reconhece ponto-e-vírgula', () => {
        expect(detectarSeparador(linha(';'))).toBe(';');
    });

    it('reconhece TAB', () => {
        expect(detectarSeparador(linha('\t'))).toBe('\t');
    });

    it('vence quem produz MAIS colunas — nome com ";" dentro não engana', () => {
        // Uma coluna cujo TEXTO tem ';' daria 2 pedaços; o TAB dá dezenas.
        expect(detectarSeparador('A;B\tC\tD\tE\tF')).toBe('\t');
    });

    it('linha sem separador nenhum devolve null (é o largura fixa)', () => {
        expect(detectarSeparador('CABECALHOSEMSEPARADOR'.repeat(4))).toBeNull();
        expect(detectarSeparador('')).toBeNull();
    });
});

describe('o parser lê os dois formatos', () => {
    // Linha real (encurtada) do arquivo do Paulo: CLINIPAR, base 590,10.
    const detalhe = (sep: string) => {
        const c = Array(73).fill('');
        c[0] = '2'; c[1] = '63549'; c[2] = '06/07/2026 07:42:06';
        c[8] = '9.633.105-4'; c[10] = '60.532.082/0001-47'; c[11] = 'CLINIPAR SERVICOS MEDICOS LTDA';
        c[22] = 'T'; c[26] = '590,10'; c[28] = '4030'; c[29] = '2,00'; c[30] = '11,80';
        c[34] = '51.227.692/0001-46'; c[37] = 'A CASTELLANO INDUSTRIA METALURGICA LTDA';
        c[55] = '3,84'; c[56] = '17,70'; c[59] = '27,44';
        c[72] = 'SERVICOS DE MEDICINA OCUPACIONAL';
        return c.join(sep);
    };
    const arquivo = (sep: string) => Buffer.from(linha(sep) + '\n' + detalhe(sep), 'latin1');

    it.each([[';', 'CSV'], ['\t', 'TXT com TAB']])('lê o export em %s (%s)', (sep) => {
        const r = parseCsvNfseSp(arquivo(sep));
        expect(r.notas).toHaveLength(1);
        expect(r.separador).toBe(sep);
        expect(r.notas[0].valorServicos).toBe(590.1);
        expect(r.notas[0].codigoServico).toBe('4030');
        expect(r.notas[0].pisRetido).toBe(3.84);
    });

    it('arquivo SEM separador nenhum recusa com a AÇÃO, não com "CSV inválido"', () => {
        expect(() => parseCsvNfseSp(Buffer.from('SEMSEPARADOR'.repeat(10) + '\nLINHA', 'latin1')))
            .toThrow(/largura fixa/);
    });
});

describe('zero nota NUNCA é silêncio', () => {
    it('o retorno diz quantas linhas COM CONTEÚDO havia', () => {
        // É esse número que separa "arquivo sem notas" de "não consegui ler":
        // a rota recusa quando há conteúdo e nenhuma linha de nota saiu.
        const r = parseCsvNfseSp(Buffer.from(linha(';') + '\n' + Array(73).fill('lixo').join(';'), 'latin1'));
        expect(r.notas).toHaveLength(0);
        expect(r.linhasComConteudo).toBe(1);
    });

    it('arquivo só com cabeçalho tem zero linha de conteúdo — aí sim é vazio', () => {
        const r = parseCsvNfseSp(Buffer.from(linha(';') + '\n', 'latin1'));
        expect(r.linhasComConteudo).toBe(0);
    });
});

/**
 * QUE DOCUMENTO CHEGOU (11/08, caso do Paulo).
 *
 * Veio um `NFTS_66958369_...csv` e o app respondeu "nenhuma linha reconhecida —
 * confira se é o export de NFS-e". Tecnicamente certo, praticamente inútil:
 * quem exportou não tem como saber que NFTS é OUTRO documento (nota do TOMADOR,
 * a que carrega o ISS retido). Mensagem de erro tem que dizer O QUE aconteceu.
 */
describe('identificarDocumentoDoPortal — o portal exporta mais de um documento', () => {
    it('reconhece NFTS pelo nome do arquivo do portal', () => {
        const d = identificarDocumentoDoPortal('NFTS_66958369_20260701_20260731 (1).csv')!;
        expect(d.tipo).toBe('nfts');
        expect(d.rotulo).toMatch(/TOMADOR/i);
        // A ação não pode culpar quem exportou: o documento é válido, o
        // importador é que ainda não o lê.
        expect(d.acao).toMatch(/ainda não é importado/i);
    });

    it('não confunde NFS-e com NFTS', () => {
        expect(identificarDocumentoDoPortal('NFSE_123_20260701.csv')!.tipo).toBe('nfse');
        expect(identificarDocumentoDoPortal('NFE_123.csv')!.tipo).toBe('nfse');
    });

    it('nome sem pista devolve desconhecido — não chuta documento', () => {
        expect(identificarDocumentoDoPortal('export (3).csv')!.tipo).toBe('desconhecido');
        expect(identificarDocumentoDoPortal('')).toBeNull();
    });
});
