// ============================================================================
// 🚨 A COMPETÊNCIA DA NFS-e É A INCIDÊNCIA, NÃO A DATA DE EMISSÃO
//
// 03/09, Paulo, painel NFS-e RECEBIDAS da Prefeitura de SP (CASA DA CRIANCA
// BETINHO, filtro `Período: Incidência 08/2026`):
//   `S&P ASSESSORIA CONTABIL · Emissão 02/09/2026 08:36:34 · Data Fato Gerador
//    31/08/2026`
// E a regra, na fala dele: *"em SP eu posso emitir uma nota com data de 31/08
// até o dia 10/09; se ela tiver retido, até o dia 05/09"*.
//
// O app recortava o mês da EMISSÃO — então essa nota era gravada em `2026-09` e
// saía de TODO recorte de agosto (lista, Livro de Serviços, ISS, bloco A do
// EFD-Contribuições), aparecendo em setembro. **Sem erro nenhum na tela.**
// ============================================================================
import { competenciaDaNfse } from '../sefaz-backend/competencia-da-nfse.js';

describe('competenciaDaNfse — o caso do print', () => {
    // Os números REAIS da linha da S&P no painel do Paulo.
    const CASO = {
        dataEmissao: '2026-09-02T08:36:34',
        dataFatoGerador: '2026-08-31T00:00:00',
    };

    it('nota emitida em setembro com fato gerador em agosto é de AGOSTO', () => {
        const r = competenciaDaNfse(CASO);
        expect(r.competencia).toBe('2026-08');
        expect(r.origem).toBe('fato-gerador');
    });

    // ⚠️ A divergência é FATO NORMAL em SP, nunca alarme — mas ela vai DITA,
    // porque é a pergunta de quem olha as duas colunas do portal lado a lado.
    it('DIZ por que a nota aparece num mês diferente do da emissão', () => {
        const r = competenciaDaNfse(CASO);
        expect(r.diverge).toBe(true);
        expect(r.motivo).toMatch(/02\/09\/2026/);
        expect(r.motivo).toMatch(/FATO GERADOR é 31\/08\/2026/);
        expect(r.motivo).toMatch(/Incid[êe]ncia/i);
    });

    it('no caso comum (emitiu no mês do serviço) não há nada a dizer', () => {
        const r = competenciaDaNfse({
            dataEmissao: '2026-08-28T14:58:02', dataFatoGerador: '2026-08-28T00:00:00',
        });
        expect(r.competencia).toBe('2026-08');
        expect(r.diverge).toBe(false);
        expect(r.motivo).toBeNull();
    });
});

describe('precedência: campo declarado > fato gerador > emissão', () => {
    it('o campo que o DOCUMENTO declara vence — é o mais específico', () => {
        const r = competenciaDaNfse({
            competenciaDeclarada: '2026-07', dataFatoGerador: '2026-08-31', dataEmissao: '2026-09-02',
        });
        expect(r.competencia).toBe('2026-07');
        expect(r.origem).toBe('declarada');
    });

    // 📌 As FORMAS do campo vêm do dono da competência (`normalizarCompetencia`):
    // `<Competencia>` do ABRASF sai `AAAA-MM` ou `AAAA-MM-DD`, e a DANFSe
    // nacional escreve o campo como DATA. Reimplementar as formas aqui seria a
    // segunda cópia de uma régua que já custou o caso de 01/09.
    it.each([
        ['2026-08', '2026-08'],
        ['2026-08-31', '2026-08'],
        ['08/2026', '2026-08'],
        ['31/08/2026', '2026-08'],
        ['202608', '2026-08'],
        ['2026-08-31T00:00:00', '2026-08'],
    ])('lê a competência declarada na forma %s', (bruto, esperado) => {
        expect(competenciaDaNfse({ competenciaDeclarada: bruto }).competencia).toBe(esperado);
    });

    // ⚠️ Sem campo e sem fato gerador a emissão responde — CARIMBADA, porque
    // número derivado não se apresenta como lido.
    it('cai na emissão com a origem dita, e manda conferir', () => {
        const r = competenciaDaNfse({ dataEmissao: '2026-09-02T08:36:34' });
        expect(r.competencia).toBe('2026-09');
        expect(r.origem).toBe('emissao');
        expect(r.motivo).toMatch(/data de EMISSÃO/);
        expect(r.motivo).toMatch(/m[êe]s anterior/i);
    });

    // 🚨 NUNCA UM CHUTE: nota sem competência some de TODO recorte de mês — é
    // este mesmo defeito com outra roupa (a régua de 01/09).
    it('nada legível devolve NULL, nunca um mês inventado', () => {
        const r = competenciaDaNfse({ competenciaDeclarada: 'lixo', dataEmissao: '' });
        expect(r.competencia).toBeNull();
        expect(r.origem).toBeNull();
        expect(r.motivo).toMatch(/fora de todo recorte de m[êe]s/);
    });

    it('e chamada vazia não explode', () => {
        expect(competenciaDaNfse().competencia).toBeNull();
    });

    // ⚠️ A data se lê do TEXTO, nunca de conversão de fuso (a régua de 22/08):
    // a nota das 22h30 de 31/08 é de AGOSTO, e `new Date(...).getUTCMonth()`
    // no Cloud Run (UTC) a jogaria em setembro.
    it('nota do fim do mês às 22h30 não anda de mês', () => {
        expect(competenciaDaNfse({
            dataFatoGerador: '2026-08-31T22:30:00-03:00',
        }).competencia).toBe('2026-08');
    });
});

// ============================================================================
// 🔒 A TRAVA DA CLASSE — por VARREDURA, nunca por lista.
//
// A classe apareceu em QUATRO trilhos, e nos quatro o dado CHEGAVA e era
// descartado. Lista de arquivos envelhece no primeiro trilho novo — e
// envelhece em SILÊNCIO, que é exatamente como esta divergência sobreviveu.
// ============================================================================
describe('🔒 nenhum trilho de NFS-e recorta o mês da EMISSÃO', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const ler = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

    // ⚠️ A janela é a LINHA da atribuição, para a varredura não ler a PROSA que
    // explica a correção (a mordida do ISS, 22/08 — varredura lê CÓDIGO).
    const linhasDeCompetencia = (src: string) => src
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .filter((l) => /competencia\s*:/.test(l));

    const TRILHOS = [
        'sefaz-backend/nfse-sp-importer.js',
        'sefaz-backend/nfse-sp-csv-importer.js',
        'sefaz-backend/nfse-nacional-gravacao.js',
        'services/xmlParserService.ts',
    ];

    it.each(TRILHOS)('%s grava a competência pelo DONO', (arq) => {
        const src = ler(arq);
        expect(src).toMatch(/competenciaDaNfse\(/);
    });

    it.each(TRILHOS)('%s não deriva a competência SÓ da data de emissão', (arq) => {
        const suspeitas = linhasDeCompetencia(ler(arq)).filter((l) => (
            /(dhEmi|dataEmissao|dataHoraEmissao)/.test(l) && !/competenciaDaNfse|incidencia/.test(l)
        ));
        expect(suspeitas).toEqual([]);
    });

    // 📌 E a leitura do ADN precisa CONTINUAR entregando o `dCompet` — o campo
    // chegava e a gravação o descartava; sem ele, o dono cai na emissão de novo.
    it('o leitor do ADN entrega o dCompet, e a gravação o consome', () => {
        expect(ler('sefaz-backend/nfse-nacional-leitura.js')).toMatch(/tag\(txt, 'dCompet'\)/);
        expect(ler('sefaz-backend/nfse-nacional-gravacao.js'))
            .toMatch(/competenciaDeclarada: m\.competencia/);
    });

    // 📌 E o `<Competencia>` do ABRASF precisa ATRAVESSAR o parser: ele era
    // lido numa variável que ninguém usava em lugar nenhum.
    it('o parser do ABRASF carrega o <Competencia> para fora', () => {
        const src = ler('services/xmlParserService.ts');
        expect(src).toMatch(/const competenciaTag = getTextContent\(infNfse, 'Competencia'\)/);
        expect(src).toMatch(/competenciaDeclarada: competenciaTag/);
    });
});
