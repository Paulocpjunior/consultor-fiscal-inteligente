// ============================================================================
// 🚨 O D100 DO EFD ICMS/IPI TEM **25** CAMPOS — e o gerador parava no 23.
//
// 18/09, Paulo — EDUARDO GUERRA · EFD ICMS/IPI 08/2026, logo depois de o 🚚
// recuperar o cabeçalho dos CT-e e o bloco D deixar de sair vazio: o PVA
// devolveu **23 recusas**, todas da mesma classe —
//
//     "O número de campos informado no registro difere do número de campos
//      especificado no leiaute do arquivo"
//     Registro D100 · Valor Esperado 25 · Conteúdo do Campo 23
//
// 📖 FONTE — Guia Prático 3.2.3, registro D100: os campos **24
// (COD_MUN_ORIG)** e **25 (COD_MUN_DEST)** existem nesta família e NÃO no
// EFD-Contribuições, cujo D100 para no 23. É a MESMA confusão que já custou
// recibo no 1010 (MANTOAN, 17/08) e no 0500 (CF BANK, 24/08): mesmo número de
// registro, arquivo diferente, leiaute diferente.
//
// ═══ E A TRAVA DE CONTAGEM **ACUSAVA** — medido, não deduzido ═══════════════
//
// `conferirContagemDeCamposFiscal` tem o D100 com 25 campos desde 29/08 (lido
// à mão no Guia) e a R42 da pré-validação já a consumia. O que estava quebrado
// era o CAMINHO ATÉ A TELA:
//
//   · a R42 gerava **uma entrada POR LINHA** — 23 erros idênticos, um por
//     CT-e (o "20 linhas dizendo o mesmo faz ninguém ler as que importam",
//     03/09);
//   · e `resumoPrevalidacao` cortava em 12 **na ordem em que as regras
//     rodam** — e a da contagem é a ÚLTIMA. A única recusa que impedia o PVA
//     de importar o arquivo INTEIRO caiu fora do corte, atrás de avisos que
//     recusam um registro só;
//   · o "…e mais N" mandava ler o resto no header `X-SPED-Prevalidacao`, que
//     a própria rota documenta que **a tela não lê**.
//
// ⚠️ CNPJs FICTÍCIOS — dado de cliente não entra no repositório.
// ============================================================================
// @ts-expect-error — módulo .js do backend (sem tipos)
import { buildBlocoD } from '../sefaz-backend/sped-fiscal-blocoD.js';
import { conferirContagemDeCamposFiscal } from '../sefaz-backend/sped-fiscal-campos.js';
import { prevalidarSpedFiscal, resumoPrevalidacao } from '../sefaz-backend/sped-prevalidacao.js';

const CHAVE = '35260844555666000177570020000024891040846455';

const dados = (notas: any[]) => ({
    empresa: { _regime: 'lucro', cnpj: '11222333000181', dadosFiscais: { uf: 'SP' } },
    competenciaInicio: '2026-08', competenciaFim: '2026-08', notas, warnings: [] as string[],
});

/** CT-e tomado, como a captura o grava depois do 🚚. */
const cte = (over: any = {}) => ({
    chave: CHAVE, tipoDoc: 'CTe', direcao: 'entrada', status: 'autorizado',
    numero: '2489', dhEmi: '2026-08-04T10:00:00-03:00', valorTotal: 16900,
    cfop: '5353', cstIcms: '00', aliqIcms: 12,
    totais: { vBC: 10140, vICMS: 1216.8 },
    cnpjEmit: '44555666000177', xNomeEmit: 'TRANSPORTADORA TESTE LTDA',
    codMunIniCte: '3550308', codMunFimCte: '4106902',
    ...over,
});

/** Conta como o PVA conta: o REG na posição 1, sem o pipe da borda. */
const camposDe = (linha: string) => linha.replace(/\r\n$/, '').slice(1, -1).split('|');
const d100De = (linhas: string[]) => camposDe(linhas.find((l) => l.startsWith('|D100|'))!);

describe('🚨 D100 do EFD ICMS/IPI — 25 campos, não 23', () => {
    it('a linha sai com os 25 campos do leiaute', () => {
        expect(d100De(buildBlocoD(dados([cte()])) as never)).toHaveLength(25);
    });

    // A prova que vale é a trava CONCORDANDO com o gerador: ela já sabia o
    // número certo, e era o gerador que estava errado.
    it('e a trava de contagem nasce MUDA sobre ele', () => {
        const linhas = buildBlocoD(dados([cte()])).map((l: string) => l.replace(/\r\n$/, ''));
        expect(conferirContagemDeCamposFiscal(linhas).erros).toEqual([]);
    });

    it('a linha de ANTES (23 campos) é acusada, com as duas contagens na frase', () => {
        const antiga = '|D100|0|1|44555666000177|57|00|002||2489|' + CHAVE
            + '|04082026|04082026|0||16900,00|0,00|9|16900,00|10140,00|1216,80|0,00|||';
        expect(camposDe(antiga)).toHaveLength(23);
        const [erro] = conferirContagemDeCamposFiscal([antiga]).erros;
        expect(erro.registro).toBe('D100');
        expect(erro.esperado).toBe(25);
        expect(erro.recebido).toBe(23);
    });
});

// ═══ OS CAMPOS 24/25 SÃO DA PRESTAÇÃO, NÃO DOS PARTICIPANTES ════════════════
describe('COD_MUN_ORIG / COD_MUN_DEST', () => {
    it('saem do cMunIni/cMunFim que o cabeçalho do CT-e declara', () => {
        const campos = d100De(buildBlocoD(dados([cte()])) as never);
        expect(campos[23]).toBe('3550308');   // campo 24
        expect(campos[24]).toBe('4106902');   // campo 25
    });

    // 🚨 A REGRA QUE IMPEDE O `1405`: o município do EMITENTE é outro fato — o
    // frete pode começar e terminar longe das partes. Sem o dado o campo sai
    // VAZIO (ausência o PVA acusa; município errado, não).
    it('sem o dado saem VAZIOS — nunca o município do emitente', () => {
        const semMun = cte({ codMunIniCte: undefined, codMunFimCte: undefined, codMunEmit: '3550308' });
        const campos = d100De(buildBlocoD(dados([semMun])) as never);
        expect(campos).toHaveLength(25);
        expect(campos[23]).toBe('');
        expect(campos[24]).toBe('');
    });

    // ⚠️ A RECUSA SEGUINTE VAI DITA ANTES (a lição de 24/08: meia correção
    // troca uma recusa por outra). Com a contagem fechada o PVA passa a cobrar
    // o CONTEÚDO — "campo obrigatório nas entradas, se COD_MOD for 57".
    it('e a geração DIZ quais ficaram sem, com a ação e sem tirá-los do livro', () => {
        const d = dados([cte({ codMunIniCte: undefined, codMunFimCte: undefined, numero: '777' })]);
        const linhas = buildBlocoD(d as never);
        expect(linhas.some((l: string) => l.startsWith('|D100|'))).toBe(true);
        const aviso = d.warnings.join(' ');
        expect(aviso).toMatch(/777/);
        expect(aviso).toMatch(/campos 24 e 25/);
        expect(aviso).toMatch(/🚚/);
        // Tirar o CT-e do livro por causa de um campo seria LIVRO A MENOS.
        expect(aviso).toMatch(/CONTINUAM no livro/);
    });

    it('nasce MUDO quando os dois municípios estão no documento', () => {
        const d = dados([cte()]);
        buildBlocoD(d as never);
        expect(d.warnings.join(' ')).not.toMatch(/campos 24 e 25/);
    });

    // Guia 3.2.3, D100, Exceção 1: cancelada leva SÓ os campos de identificação
    // e "demais campos deverão ser apresentados com conteúdo VAZIO".
    it('na CANCELADA os dois saem vazios, como todo o resto', () => {
        const cancelada = cte({ eventos: [{ tpEvento: '110111', cStat: '135' }] });
        const campos = d100De(buildBlocoD(dados([cancelada])) as never);
        expect(campos).toHaveLength(25);
        expect(campos[5]).toBe('02');     // COD_SIT
        expect(campos[23]).toBe('');
        expect(campos[24]).toBe('');
    });
});

// ═══ O CAMINHO ATÉ A TELA — era ELE que estava quebrado ═════════════════════
describe('🚦 o aviso da geração: o que barra a IMPORTAÇÃO vem primeiro', () => {
    const d100Antigo = (n: number) => '|D100|0|1|44555666000177|57|00|002||' + n + '|' + CHAVE
        + '|04082026|04082026|0||16900,00|0,00|9|16900,00|10140,00|1216,80|0,00|||';
    /** 0150 sem ENDERECO — recusa de UM registro, não do arquivo. */
    const p0150 = (i: number) => `|0150|1122233300018${i}|PARTICIPANTE ${i}|1058|1122233300018${i}||123|3550308|||||BAIRRO|`;

    const arquivoDela = [
        ...Array.from({ length: 15 }, (_, i) => p0150(i)),
        ...Array.from({ length: 23 }, (_, i) => d100Antigo(2489 + i)),
    ];

    it('as 23 linhas iguais viram UMA entrada, com a contagem na frase', () => {
        const r = prevalidarSpedFiscal(arquivoDela, {});
        const contagem = r.erros.filter((e: any) => e.regra === 'contagem-de-campos');
        expect(contagem).toHaveLength(1);
        expect(contagem[0].ocorrencias).toBe(23);
        expect(contagem[0].mensagem).toMatch(/23 linha\(s\) assim/);
    });

    // 🚨 A TRAVA DO DIA: com o corte em 12 por ORDEM DE EXECUÇÃO, a recusa que
    // impede a importação do arquivo INTEIRO ficava FORA do aviso.
    it('a recusa que impede a importação aparece na PRIMEIRA linha do aviso', () => {
        const linhas = resumoPrevalidacao(prevalidarSpedFiscal(arquivoDela, {}));
        expect(linhas[0]).toMatch(/IMPEDEM a importação do arquivo inteiro/);
        expect(linhas[1]).toMatch(/⛔/);
        expect(linhas[1]).toMatch(/D100/);
        expect(linhas[1]).toMatch(/25 campos/);
    });

    // ⚠️ E o "…e mais N" parou de mandar a pessoa a um header que a tela não lê.
    it('o que sobra do corte NÃO é apontado para o header X-SPED-Prevalidacao', () => {
        const texto = resumoPrevalidacao(prevalidarSpedFiscal(arquivoDela, {})).join('\n');
        expect(texto).not.toMatch(/X-SPED-Prevalidacao/);
    });

    it('sem recusa que barre a importação, o cabeçalho não promete gravidade', () => {
        const r = prevalidarSpedFiscal([p0150(0)], {});
        const linhas = resumoPrevalidacao(r);
        if (linhas.length) expect(linhas[0]).not.toMatch(/IMPEDEM/);
    });
});
