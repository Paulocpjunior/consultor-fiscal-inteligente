// @ts-nocheck — módulo .js do backend (sem tipos)
// ============================================================================
// 🚨 A NFTS NUNCA VIRAVA DOCUMENTO — o módulo só CRUZAVA
//
// 03/09, Paulo: *"Referente a NFTS, ela não aparece pra mim no consultor, o PDF
// ele não aceita e o CSV por causa do layout"*.
//
// 📌 O "não aparece" era POR CONSTRUÇÃO, e foi MEDIDO: o `nfts-routes.js` tinha
// UMA rota (`/cruzamento`), que **LÊ** `documentos_fiscais` e **nunca escreve**.
// A NFTS não existia em recorte nenhum — nem no Livro de Serviços tomados, nem
// na competência, nem no bloco A. Não era defeito de captura: era ausência de
// trilho. E o que ficava de fora é o documento que carrega o **ISS RETIDO** que
// o cliente recolhe.
//
// ⚠️ E A COMPETÊNCIA É A DA PRESTAÇÃO, nunca a da emissão — o print do portal
// prova de novo: `Emissão 03/09/2026 · Data Prestação Serv. 31/08/2026`, com o
// portal listando sob `Período: Incidência 08/2026`.
// ============================================================================
import { documentoDaNfts, idDaNfts } from '../sefaz-backend/nfts-sp-importer.js';

/** A forma que o parser entrega — os campos do print, com números fictícios. */
const NOTA = {
    numero: '412',
    dataEmissao: '03/09/2026 09:14:02',
    numeroDocumento: '1269',
    serieDocumento: 'A',
    dataPrestacao: '31/08/2026',
    ccmTomador: '92516963',
    docTomador: '11222333000181',
    nomeTomador: 'EMPRESA TOMADORA LTDA',
    cancelada: false,
    dataCancelamento: null,
    valorServicos: 8544,
    valorDeducoes: null,
    codigoServico: '07498',
    subitemLista: '17.19',
    aliquota: 5,
    valorIss: 427.2,
    issRetido: 'Sim',
    docPrestador: '44555666000199',
    ccmPrestador: null,
    nomePrestador: 'PRESTADOR DE FORA LTDA',
    ufPrestador: 'MG',
    cidadePrestador: 'BELO HORIZONTE',
    discriminacao: 'Serviço tomado',
};
const CTX = { empresaId: 'emp1', empresaCnpj: '11.222.333/0001-81', empresaNome: 'EMPRESA TOMADORA LTDA' };

describe('a NFTS vira documento', () => {
    it('a competência é a da PRESTAÇÃO, não a da emissão — e a origem vai carimbada', () => {
        const { doc } = documentoDaNfts(NOTA, CTX);
        expect(doc.competencia).toBe('2026-08');
        expect(doc.competenciaOrigem).toBe('fato-gerador');
        // A divergência é FATO NORMAL em SP (a nota de 31/08 pode ser emitida
        // até 10/09), então ela é DITA, nunca acesa como erro.
        expect(doc.competenciaDivergeDaEmissao).toBe(true);
        expect(doc.dhEmi).toBe('2026-09-03');
        expect(doc.dataFatoGerador).toBe('2026-08-31');
    });

    // 🚨 É O ISS DA NFTS QUE O CLIENTE RECOLHE — e `issRetido` é BOOLEANO no
    // portal ("Sim"/"Não"): o VALOR mora em `valorIss`. Somar o booleano como
    // número declararia retenção de R$ 1,00.
    it('o ISS retido viaja como afirmação E como valor, separados', () => {
        const { doc } = documentoDaNfts(NOTA, CTX);
        expect(doc.issRetidoDeclarado).toBe(true);
        expect(doc.valorIssRetido).toBe(427.2);
        expect(doc.valorIss).toBe(427.2);
        expect(doc.valorTotal).toBe(8544);
    });

    it('ISS não retido não vira valor retido — presença ≠ retenção', () => {
        const { doc } = documentoDaNfts({ ...NOTA, issRetido: 'Não' }, CTX);
        expect(doc.issRetidoDeclarado).toBe(false);
        expect(doc.valorIssRetido).toBeNull();
        // O ISS destacado continua lá: quem não reteve ainda declarou o imposto.
        expect(doc.valorIss).toBe(427.2);
    });

    // ⚠️ DIREÇÃO É ENTRADA POR DEFINIÇÃO: NFTS é a nota do TOMADOR. Não há o que
    // deduzir — quem emite é o cliente, e o serviço é tomado.
    it('nasce como ENTRADA e com rótulo PRÓPRIO, nunca como NFS-e', () => {
        const { doc } = documentoDaNfts(NOTA, CTX);
        expect(doc.direcao).toBe('entrada');
        expect(doc.tipo).toBe('NFTS');
        expect(doc.tipoDoc).toBe('NFTS');
        expect(doc.prestadorCnpj).toBe('44555666000199');
        expect(doc.empresaCnpj).toBe('11222333000181');
    });

    it('cancelada entra com o status certo — some do livro pela régua da leitura', () => {
        const { doc } = documentoDaNfts({ ...NOTA, cancelada: true, dataCancelamento: '05/09/2026' }, CTX);
        expect(doc.status).toBe('cancelado');
    });
});

// ============================================================================
// 🚨 O QUE NÃO ENTRA SAI NOMEADO — "3 importadas" sem dizer que 2 ficaram de
// fora é o que faz alguém achar que declarou tudo.
// ============================================================================
describe('lacuna recusa a nota, com o motivo', () => {
    it('sem valor não entra — documento valendo zero entra no livro e ninguém denuncia', () => {
        const r = documentoDaNfts({ ...NOTA, valorServicos: null }, CTX);
        expect(r.doc).toBeNull();
        expect(r.lacunas).toContain('sem valor dos serviços');
    });

    it('sem prestador não entra — é o COD_PART vazio do A100 (a recusa de hoje)', () => {
        const r = documentoDaNfts({ ...NOTA, docPrestador: null }, CTX);
        expect(r.doc).toBeNull();
        expect(r.lacunas).toContain('sem CPF/CNPJ do prestador');
    });

    it('sem número não entra — não há como reencontrá-la', () => {
        const r = documentoDaNfts({ ...NOTA, numero: '' }, CTX);
        expect(r.doc).toBeNull();
        expect(r.lacunas).toContain('sem número da NFTS');
    });

    // 🚨 SEM DATA NENHUMA A COMPETÊNCIA NÃO SE CHUTA: nota sem competência some
    // de TODO recorte de mês (a régua de 01/09, ZAMBOLIN).
    it('sem data legível a nota não recebe competência inventada', () => {
        const r = documentoDaNfts({ ...NOTA, dataPrestacao: null, dataEmissao: null }, CTX);
        expect(r.doc).toBeNull();
        expect(r.lacunas.join(' ')).toMatch(/data legível/);
    });

    // ⚠️ SEM A PRESTAÇÃO, A EMISSÃO RESPONDE — e a origem diz isso. Recusar aqui
    // faria a NFTS sumir por um campo que o portal pode não preencher.
    it('sem a data da prestação, a emissão responde — carimbada', () => {
        const { doc } = documentoDaNfts({ ...NOTA, dataPrestacao: null }, CTX);
        expect(doc.competencia).toBe('2026-09');
        expect(doc.competenciaOrigem).toBe('emissao');
    });
});

// ============================================================================
// 🐛 O ID É DETERMINÍSTICO — sem isto, reimportar o MESMO CSV criaria uma
// segunda NFTS e o serviço contaria duas vezes no livro (o `Date.now()` de
// 01/09, na mesma classe).
// ============================================================================
describe('id determinístico', () => {
    it('o mesmo CSV reimportado cai por cima do mesmo documento', () => {
        const a = documentoDaNfts(NOTA, CTX).doc.id;
        const b = documentoDaNfts({ ...NOTA }, CTX).doc.id;
        expect(a).toBe(b);
        expect(a).toBe(idDaNfts('9.251.696-3', '412'));
    });

    it('NFTS de tomadores diferentes com o mesmo número NÃO colidem', () => {
        expect(idDaNfts('92516963', '412')).not.toBe(idDaNfts('66958369', '412'));
    });
});

// ============================================================================
// 🔗 A LIGAÇÃO — importador certo com a rota não chamando devolve o defeito
// calado, que é exatamente o estado de ontem: o módulo só cruzava.
// ============================================================================
describe('a rota grava, e só quando pedem', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const rota = readFileSync(join(__dirname, '../sefaz-backend/nfts-routes.js'), 'utf8');
    const codigo = rota.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

    it('a rota chama o importador — antes ela NUNCA escrevia', () => {
        expect(codigo).toMatch(/importarNftsDoCsv\(parsed\.notas/);
    });

    // ⚠️ OPT-IN: gravar por padrão faria uma CONFERÊNCIA (que é leitura)
    // escrever no banco sem ninguém pedir. Quem grava é o clique.
    it('a gravação é opt-in', () => {
        expect(codigo).toMatch(/req\.body\?\.importar/);
    });

    // 🚨 A RECUSA DE LAYOUT NÃO AFIRMA SOBRE A POSSE DO ARQUIVO: o portal tem
    // VERSÕES (o print traz "Layout V. 003"), e é o app que não conhece a
    // coluna. Dizer a falha errada manda procurar no lugar errado.
    it('a recusa de layout entrega o cabeçalho LIDO em vez de culpar o arquivo', () => {
        expect(codigo).toMatch(/cabecalhoLido: parsed\.cabecalhoLido/);
        expect(codigo).toMatch(/colunasReconhecidas/);
        expect(codigo).not.toMatch(/não parece o export/i);
    });
});

// ============================================================================
// 🚨 IMPORTAR E NÃO DIZER O QUE ENTROU É A FLAG QUE NINGUÉM LÊ — e aqui ela
// seria a pior: a pessoa continuaria achando que a NFTS "não aparece".
// ============================================================================
describe('a tela mostra o que foi importado', () => {
    const { readFileSync } = require('fs');
    const { join } = require('path');
    const tela = readFileSync(join(__dirname, '../components/Nfts/CruzamentoNftsPanel.tsx'), 'utf8');

    it('tem o botão que IMPORTA, separado do que só confere', () => {
        expect(tela).toMatch(/rodar\(true\)/);
        expect(tela).toMatch(/rodar\(false\)/);
    });

    it('mostra as gravadas, a COMPETÊNCIA e o que ficou de fora', () => {
        expect(tela).toMatch(/dados\.importacao\.gravadas/);
        expect(tela).toMatch(/dados\.importacao\.competencias/);
        expect(tela).toMatch(/dados\.importacao\.foras/);
    });

    // 📌 A competência é a da PRESTAÇÃO — dizer isso é o que impede a pessoa de
    // procurar a nota no mês da emissão e concluir que ela sumiu (01/09).
    it('e diz que a competência é a da prestação, não a da emissão', () => {
        expect(tela).toMatch(/prestação/);
        expect(tela).toMatch(/não a da emissão/);
    });

    // 🚨 O cabeçalho lido sai na tela para ser copiado — sem ele a única saída
    // era mandar o arquivo do cliente, que é o que a régua evita.
    it('a recusa de layout entrega o cabeçalho lido, copiável', () => {
        expect(tela).toMatch(/detalheLayout\?\.cabecalhoLido/);
        expect(tela).toMatch(/nomes de coluna/);
    });
});
