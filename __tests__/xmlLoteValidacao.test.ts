/**
 * Validação do lote de XMLs contra a empresa selecionada (27/07).
 * Caso real: o combo vinha com a PRIMEIRA empresa da lista pré-selecionada e o
 * ZIP era lançado no cliente errado sem ninguém perceber.
 */
import { extrairDadosXml, resumirLoteXmls, validarLoteParaEmpresa, raizCnpj } from '../services/xmlLoteValidacao';

const CNPJ_GUARANI = '58692419000131';
const CNPJ_OUTRO = '12345678000199';

const chaveCom = (cnpj: string) => `3526${'0'.repeat(2)}${cnpj}55001${'9'.repeat(44 - 6 - 14 - 5)}`.slice(0, 44);

const nfe = (emit: string, dest: string) => `<?xml version="1.0"?>
<nfeProc><NFe><infNFe Id="NFe${chaveCom(emit)}">
  <emit><CNPJ>${emit}</CNPJ><xNome>Emitente</xNome></emit>
  <dest><CNPJ>${dest}</CNPJ><xNome>Destinatario</xNome></dest>
</infNFe></NFe></nfeProc>`;

const empresas = [
    { id: 'g', nome: 'GUARANI COMERCIO DE DOCES', cnpj: CNPJ_GUARANI },
    { id: 'o', nome: 'OUTRA EMPRESA LTDA', cnpj: CNPJ_OUTRO },
];

describe('extrairDadosXml', () => {
    it('pega emitente, destinatário e chave', () => {
        const d = extrairDadosXml(nfe(CNPJ_GUARANI, CNPJ_OUTRO));
        expect(d.emit).toBe(CNPJ_GUARANI);
        expect(d.dest).toBe(CNPJ_OUTRO);
        expect(d.chave).toHaveLength(44);
    });

    it('sem bloco emit, tira o emitente da chave (resumo/evento)', () => {
        const d = extrairDadosXml(`<resNFe><chNFe>${chaveCom(CNPJ_GUARANI)}</chNFe></resNFe>`);
        expect(d.emit).toBe(CNPJ_GUARANI);
        expect(d.dest).toBeNull();
    });

    it('destinatário pessoa física (CPF) não quebra', () => {
        const xml = `<NFe><emit><CNPJ>${CNPJ_GUARANI}</CNPJ></emit><dest><CPF>12345678901</CPF></dest></NFe>`;
        expect(extrairDadosXml(xml).dest).toBe('12345678901');
    });

    it('lixo não vira identificação falsa', () => {
        expect(extrairDadosXml('não é xml')).toEqual({ emit: null, dest: null, chave: null });
    });
});

// ---------------------------------------------------------------------------
// 🚨 CASO A CASTELLANO (19/08) — o modal bloqueava um CT-e que o backend já
// aceitava. O backend (parseCTeXml) usa o REMETENTE como contraparte
// principal do CT-e (é ele quem manda a carga e, com toma=0, quem paga o
// frete) — mas esta validação (usada só na TELA de confirmação, antes de
// importar) lia o `<dest>` cru, que no CT-e é o destinatário FINAL da
// mercadoria, sem nada a ver com o cliente. Resultado: "0 de 6 XMLs desta
// empresa" numa tela cujo botão Importar só existe quando NÃO bloqueia — a
// pessoa nem chegava a testar se o backend aceitaria.
// ---------------------------------------------------------------------------
const CNPJ_CASTELLANO = '51227692000146';
const CNPJ_TRANSPORTADORA = '35523401000291';
const CNPJ_ORDALHA = '37668204000105';
const CHAVE_CTE = '35260735523401000291570000000956861100095683';

const cte = (remCnpj: string, destCnpj: string) => `<?xml version="1.0"?>
<cteProc><CTe><infCte Id="CTe${CHAVE_CTE}" versao="4.00">
  <emit><CNPJ>${CNPJ_TRANSPORTADORA}</CNPJ><xNome>Transportadora</xNome></emit>
  <rem><CNPJ>${remCnpj}</CNPJ><xNome>Remetente</xNome></rem>
  <dest><CNPJ>${destCnpj}</CNPJ><xNome>Destinatario final da carga</xNome></dest>
</infCte></CTe><protCTe><infProt><chCTe>${CHAVE_CTE}</chCTe><cStat>100</cStat></infProt></protCTe></cteProc>`;

describe('extrairDadosXml — CT-e usa o REMETENTE como contraparte, não o <dest>', () => {
    it('dest vira o remetente (mesma regra do backend, parseCTeXml)', () => {
        const d = extrairDadosXml(cte(CNPJ_CASTELLANO, CNPJ_ORDALHA));
        expect(d.emit).toBe(CNPJ_TRANSPORTADORA);
        expect(d.dest).toBe(CNPJ_CASTELLANO);   // nunca CNPJ_ORDALHA
    });

    it('chave sai do Id="CTe..." e do <chCTe>, não só do padrão NFe', () => {
        const d = extrairDadosXml(cte(CNPJ_CASTELLANO, CNPJ_ORDALHA));
        expect(d.chave).toBe(CHAVE_CTE);
    });

    it('NF-e sem <rem> continua lendo o <dest> normalmente', () => {
        const d = extrairDadosXml(nfe(CNPJ_GUARANI, CNPJ_OUTRO));
        expect(d.dest).toBe(CNPJ_OUTRO);
    });
});

describe('validarLoteParaEmpresa — A CASTELLANO como remetente do CT-e', () => {
    it('libera a importação (era bloqueada antes da correção)', () => {
        const resumo = resumirLoteXmls([cte(CNPJ_CASTELLANO, CNPJ_ORDALHA)]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_CASTELLANO, [
            { id: 'c', nome: 'A CASTELLANO INDUSTRIA METALURGICA LTDA', cnpj: CNPJ_CASTELLANO },
        ]);
        expect(v.bloquear).toBe(false);
        expect(v.compativeis).toBe(1);
    });
});

describe('validarLoteParaEmpresa', () => {
    it('lote todo da empresa escolhida → libera sem alarme', () => {
        const resumo = resumirLoteXmls([nfe(CNPJ_GUARANI, CNPJ_OUTRO), nfe(CNPJ_GUARANI, CNPJ_OUTRO)]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);
        expect(v.compativeis).toBe(2);
        expect(v.incompativeis).toBe(0);
        expect(v.bloquear).toBe(false);
        expect(v.mensagem).toMatch(/Todos os 2/);
    });

    it('empresa ERRADA selecionada: bloqueia e diz de quem é o arquivo', () => {
        const resumo = resumirLoteXmls([nfe(CNPJ_GUARANI, '99999999000191')]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_OUTRO, empresas);
        expect(v.bloquear).toBe(true);
        expect(v.donosProvaveis[0].empresa?.nome).toMatch(/GUARANI/);
        expect(v.mensagem).toMatch(/Troque a empresa selecionada/);
    });

    it('dono não cadastrado: avisa que o CNPJ não está na base', () => {
        const resumo = resumirLoteXmls([nfe('77777777000191', '88888888000191')]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);
        expect(v.bloquear).toBe(true);
        expect(v.mensagem).toMatch(/NÃO está cadastrado/);
    });

    it('lote misturado: conta os que serão recusados', () => {
        const resumo = resumirLoteXmls([
            nfe(CNPJ_GUARANI, CNPJ_OUTRO),
            nfe('77777777000191', '88888888000191'),
        ]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);
        expect(v.compativeis).toBe(1);
        expect(v.incompativeis).toBe(1);
        expect(v.bloquear).toBe(false);
        expect(v.mensagem).toMatch(/RECUSADOS/);
    });

    it('nota de ENTRADA (empresa é destinatária) conta como compatível', () => {
        const resumo = resumirLoteXmls([nfe('77777777000191', CNPJ_GUARANI)]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);
        expect(v.compativeis).toBe(1);
        expect(v.bloquear).toBe(false);
    });

    it('filial: raiz igual basta (matriz x filial da mesma empresa)', () => {
        expect(raizCnpj('58692419000131')).toBe('58692419');
        const resumo = resumirLoteXmls([nfe('58692419000212', CNPJ_OUTRO)]);
        const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);
        expect(v.compativeis).toBe(1);
    });

    it('lote vazio não bloqueia nem inventa dono', () => {
        const v = validarLoteParaEmpresa(resumirLoteXmls([]), CNPJ_GUARANI, empresas);
        expect(v.total).toBe(0);
        expect(v.bloquear).toBe(false);
        expect(v.mensagem).toMatch(/Nenhum XML/);
    });
});

// ---------------------------------------------------------------------------
// Print do Paulo (27/07): modal dizia "Todos os 36 XMLs são desta empresa" e,
// logo abaixo, listava 5 fornecedores "não cadastrada". Eram notas de ENTRADA
// (GUARANI destinatária) — o emitente é fornecedor, não dono alheio.
// ---------------------------------------------------------------------------
describe('lote de ENTRADAS não trata fornecedor como dono alheio', () => {
    const fornecedores = ['01157555001186', '05953156000100', '42115174000140'];
    const resumo = resumirLoteXmls(fornecedores.map(f => nfe(f, CNPJ_GUARANI)));
    const v = validarLoteParaEmpresa(resumo, CNPJ_GUARANI, empresas);

    it('conta tudo como compatível, como entradas', () => {
        expect(v.compativeis).toBe(3);
        expect(v.comoDestinatario).toBe(3);
        expect(v.comoEmitente).toBe(0);
        expect(v.incompativeis).toBe(0);
    });

    it('não aponta nenhum dono alheio (a lista de fornecedores some)', () => {
        expect(v.donosProvaveis).toHaveLength(0);
    });

    it('mensagem diz que são entradas', () => {
        expect(v.mensagem).toMatch(/Todos os 3/);
        expect(v.mensagem).toMatch(/entrada/);
    });

    it('lote de saída informa o outro lado da conta', () => {
        const saida = validarLoteParaEmpresa(resumirLoteXmls([nfe(CNPJ_GUARANI, '01157555001186')]), CNPJ_GUARANI, empresas);
        expect(saida.comoEmitente).toBe(1);
        expect(saida.mensagem).toMatch(/saída/);
    });
});
