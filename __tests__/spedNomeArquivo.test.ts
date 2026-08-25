// ============================================================================
// 🚨 O NOME DO ARQUIVO DIZ QUAL GERAÇÃO ELE É
//
// Paulo, 25/08 (PWR 1364 · 07/2026): *"Este é o 4º dia, o mesmo erro da mesma
// empresa sobre o mesmo assunto!!!!!! não dá mais pra postergar"* — com o print
// do M210 do PVA mostrando `VL_REC_BRT 38.316,84` e, anexo na MESMA mensagem,
// o arquivo declarando **37.754,60**.
//
// Os dois estavam certos. O par que o PVA mostrava — `38.316,84 / 30.958,77` —
// é exatamente o estado de 20/08, em que o desconto já saía da BASE e ainda não
// saía da RECEITA. Ou seja: a tela do PVA estava com uma importação ANTERIOR.
//
// E ninguém tinha como perceber isso, porque toda geração da mesma empresa e
// competência produzia o MESMO nome de arquivo. Quatro dias ⇒ quatro arquivos
// indistinguíveis, e o PVA guarda a escrituração importada na base dele.
// ============================================================================
import {
    carimboDaGeracao, nomeDoArquivoSped, avisoDeIdentidadeDoArquivo, OFFSET_BRASILIA_MIN,
} from '../sefaz-backend/sped-nome-arquivo.js';

/** 25/08/2026, 14h32 de Brasília = 17h32 UTC. */
const MS_1432_BRT = Date.UTC(2026, 7, 25, 17, 32, 0);

describe('🚨 duas gerações da mesma competência não podem ter o mesmo nome', () => {
    it('o nome carrega a data e a hora', () => {
        expect(nomeDoArquivoSped({
            familia: 'SPED_CONTRIB', cnpj: '31.947.349/0001-69', periodo: '202607',
            agoraMs: MS_1432_BRT,
        })).toBe('SPED_CONTRIB_31947349000169_202607_20260825-1432.txt');
    });

    it('gerar de novo um minuto depois produz nome DIFERENTE', () => {
        const p = { familia: 'SPED_CONTRIB', cnpj: '31947349000169', periodo: '202607' };
        const a = nomeDoArquivoSped({ ...p, agoraMs: MS_1432_BRT });
        const b = nomeDoArquivoSped({ ...p, agoraMs: MS_1432_BRT + 60_000 });
        expect(a).not.toBe(b);
        // ⚠️ E a ordem alfabética continua sendo a cronológica dentro da
        // competência — a geração mais nova fica por último na pasta.
        expect([b, a].sort()).toEqual([a, b]);
    });

    it('quem procura por empresa e competência continua achando', () => {
        const n = nomeDoArquivoSped({
            familia: 'SPED', cnpj: '31947349000169', periodo: '202607', agoraMs: MS_1432_BRT,
        });
        expect(n.startsWith('SPED_31947349000169_202607')).toBe(true);
    });

    // 🚨 O backend roda no Cloud Run, que é UTC. Sem o deslocamento, o arquivo
    // gerado às 21h de Brasília sairia carimbado com o dia SEGUINTE — e o nome,
    // que existe para ORDENAR as gerações, passaria a confundir. É a mesma
    // armadilha de fuso da data do documento (22/08), na versão do rótulo.
    it('o carimbo é de BRASÍLIA, não do processo', () => {
        expect(OFFSET_BRASILIA_MIN).toBe(-180);
        // 26/08 00h30 UTC = 25/08 21h30 em Brasília.
        expect(carimboDaGeracao(Date.UTC(2026, 7, 26, 0, 30))).toBe('20260825-2130');
    });

    it('instante ilegível não vira carimbo inventado', () => {
        expect(carimboDaGeracao(NaN)).toBe('');
        expect(nomeDoArquivoSped({
            familia: 'SPED', cnpj: '31947349000169', periodo: '202607', agoraMs: NaN,
        })).toBe('SPED_31947349000169_202607.txt');
    });

    it('período em forma torta não vira nome de arquivo com barra', () => {
        expect(nomeDoArquivoSped({
            familia: 'SPED', cnpj: '1', periodo: '07/2026', agoraMs: MS_1432_BRT,
        })).not.toContain('/');
    });
});

describe('🚨 o aviso liga a TELA ao ARQUIVO', () => {
    const M210 = '|M210|51|37754,60|30958,77|||30958,77|0,6500|||201,23|||||201,23|';
    const M610 = '|M610|51|37754,60|30958,77|||30958,77|3,0000|||928,76|||||928,76|';

    it('copia a linha do arquivo GERADO e diz o nome dele', () => {
        const [aviso] = avisoDeIdentidadeDoArquivo({
            filename: 'SPED_CONTRIB_31947349000169_202607_20260825-1432.txt',
            linhas: ['|0000|006|…', M210, M610],
            registros: ['M210', 'M610'],
        });
        expect(aviso).toContain('SPED_CONTRIB_31947349000169_202607_20260825-1432.txt');
        expect(aviso).toContain('37754,60');
        // A AÇÃO, não só o número: o PVA guarda a escrituração importada.
        expect(aviso).toMatch(/importação ANTERIOR/);
        expect(aviso).toMatch(/apague a escrituração/);
    });

    it('a linha sai do arquivo, com o CRLF fora', () => {
        const [aviso] = avisoDeIdentidadeDoArquivo({
            filename: 'X.txt', linhas: [`${M210}\r\n`], registros: ['M210'],
        });
        expect(aviso).toContain(M210);
        expect(aviso).not.toContain('\r');
    });

    // ⚠️ Sem âncora não se afirma nada — aviso que promete um número e não o
    // traz é pior que aviso nenhum.
    it('sem a linha-âncora, e sem nome, não sai aviso', () => {
        expect(avisoDeIdentidadeDoArquivo({ filename: 'X.txt', linhas: ['|0000|1|'] })).toEqual([]);
        expect(avisoDeIdentidadeDoArquivo({ filename: '', linhas: [M210] })).toEqual([]);
        expect(avisoDeIdentidadeDoArquivo()).toEqual([]);
    });

    it('o EFD ICMS/IPI usa a MESMA régua, com a âncora dele', () => {
        const e110 = '|E110|1000,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|0,00|1000,00|0,00|0,00|';
        const [aviso] = avisoDeIdentidadeDoArquivo({
            filename: 'SPED_31947349000169_202607_20260825-1432.txt',
            linhas: [e110], registros: ['E110'],
        });
        expect(aviso).toContain('|E110|');
    });
});

// 🚨 As DUAS famílias passaram pelo dono no MESMO PR — meia correção deixaria o
// EFD ICMS/IPI produzindo arquivos indistinguíveis, que é o defeito inteiro.
describe('🚨 as duas rotas de download leem o dono', () => {
    const fonte = (p: string) => require('fs').readFileSync(require('path').resolve(__dirname, p), 'utf8');

    it.each([
        ['../sefaz-backend/sped-contrib-routes.js'],
        ['../sefaz-backend/sped-fiscal-routes.js'],
    ])('%s', (arq) => {
        const s = fonte(arq);
        expect(s).toContain('nomeDoArquivoSped(');
        expect(s).toContain('avisoDeIdentidadeDoArquivo(');
        // A forma antiga não pode voltar: nome montado à mão é nome sem hora.
        expect(s).not.toMatch(/const filename = `SPED[^`]*\.txt`/);
    });
});
