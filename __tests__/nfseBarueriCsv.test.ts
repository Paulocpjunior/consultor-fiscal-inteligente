/**
 * 🏛️ AS NOTAS DE BARUERI ENTRAVAM SÓ PELO PORTAL NACIONAL — e as canceladas
 * subiam como ATIVAS (10/09, Paulo, JG SOLUCOES EM TECNOLOGIA):
 *
 *   *"essas duas notas são canceladas, importei as notas pelo portal nacional
 *   e as mesmas subiram como ativas"* … *"não consigo importar as notas direto
 *   do portal de Barueri, porque lá só tem opção TXT ou CSV, e o modelo de
 *   importação CSV que tem no consultor são para as NFS SP"*
 *
 * O CSV do município traz a coluna **`Nf Ativa`** — o cancelamento vem na
 * FONTE — e traz a **chave de acesso**, que é o mesmo id do documento que a
 * captura pelo ADN grava: importar o CSV **cai por cima** da nota que subiu
 * ativa, em vez de criar uma segunda.
 *
 * As fixtures reproduzem o leiaute MEDIDO na amostra real (07/2026, 24 notas)
 * com CNPJs FICTÍCIOS — dado de cliente nunca entra no repositório.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    parseCsvNfseBarueri, ehCsvNfseBarueri, ehTxtLoteBarueri,
    situacaoDaColunaAtiva, valorPtBr,
} from '../sefaz-backend/nfse-barueri-csv-parser.js';
import {
    documentoDaNotaBarueri, conferirPosseDoCsvBarueri, direcaoDaNotaBarueri,
} from '../sefaz-backend/nfse-barueri-csv-importer.js';
import { idDocumentoNfse } from '../sefaz-backend/nfse-identidade.js';

// CNPJs FICTÍCIOS.
const PRESTADOR = '11222333000181';
const FILIAL_PRESTADOR = '11222333000262';
const TOMADOR = '44555666000177';
const OUTRA = '99888777000166';

// Chave do padrão nacional, no leiaute MEDIDO:
// cMun(7) · amb(1) · tpInsc(1) · inscrição(14) · número(13) · AAMM(4) · cód(10)
const chaveDe = (numero: number) => `3505708` + `1` + `2` + PRESTADOR
    + String(numero).padStart(13, '0') + `2607` + `1933432001`;

const CABECALHO = [
    'Identificador NF', 'Data NF', 'Data Base NF', 'Data RPS', 'Série RPS', 'Numero NF',
    'Numero RPS', 'CNPJ', 'Tomador', 'Tomador Endereco', 'Tomador Nro Endereco',
    'Tomador Comp. Endereco', 'Tomador Bairro', 'Tomador Cidade', 'Tomador UF', 'Tomador Pais',
    'Tomador CEP', 'Código Servico', 'Aliquota', 'ISSQN Retido', 'Discriminacao Serviço',
    'Valor Serviço', 'Valor Previsto ISSQN', 'IRRF', 'PIS', 'Cofins', 'CSSL', 'Total NF',
    'Valor Fatura', 'Valor Não Incluso na B.C.', 'Nf Ativa', 'NF Substituida por',
    'Código de Autenticidade', 'Chave de acesso da NFS-e',
];

interface LinhaFixture {
    numero: number;
    dataNf?: string;
    dataBase?: string;
    valor?: string;
    iss?: string;
    ativa?: string;
    retencoes?: boolean;
    chave?: string;
    tomador?: string;
}

const linha = (l: LinhaFixture) => ([
    `5946${l.numero}`, l.dataNf ?? '03/07/2026', l.dataBase ?? l.dataNf ?? '03/07/2026', '', '',
    String(l.numero), '', '44.555.666/0001-77', l.tomador ?? 'TOMADOR SÃO PAULO LTDA',
    'RUA SAO TOMÉ', '86', 'ANDAR 15', 'VILA OLIMPIA', 'SÃO PAULO', 'SP', '', '04551080',
    '010101220', '2,00', '2', 'PRESTAÇÃO DE SERVIÇO.',
    l.valor ?? '426212,0400', l.iss ?? '8524,2400',
    l.retencoes ? '6393,1800' : '0,0000',
    l.retencoes ? '2770,3800' : '0,0000',
    l.retencoes ? '12786,3600' : '0,0000',
    l.retencoes ? '4262,1200' : '0,0000',
    l.valor ?? '426212,0400', '', '0,0000', l.ativa ?? 'Sim', '', '136W.0895.7321.1281599-V',
    l.chave ?? chaveDe(l.numero),
].map((c) => `"${c}"`).join(';'));

/** O arquivo como o portal manda: **ISO-8859-1**, não UTF-8. */
const csvLatin1 = (linhas: LinhaFixture[]) => Buffer.from(
    [CABECALHO.map((c) => `"${c}"`).join(';'), ...linhas.map(linha)].join('\r\n'),
    'latin1',
);

describe('o CSV do portal de Barueri se identifica sozinho', () => {
    it('reconhece pelo CABEÇALHO, não pelo nome do arquivo', () => {
        expect(ehCsvNfseBarueri(csvLatin1([{ numero: 39 }]))).toBe(true);
    });

    it('o CSV do portal de SP (posicional, sem cabeçalho nomeado) NÃO é confundido', () => {
        const sp = Buffer.from('Tipo;Numero;Data;Verificacao\r\n2;123;01/07/2026;ABC\r\n', 'latin1');
        expect(ehCsvNfseBarueri(sp)).toBe(false);
    });

    it('o TXT de lote é reconhecido — a recusa precisa dizer o que fazer, não "não sei ler"', () => {
        const txt = Buffer.from('14BY39542026070320260703PMB00400000000000\r\n', 'latin1');
        expect(ehTxtLoteBarueri(txt)).toBe(true);
        expect(ehCsvNfseBarueri(txt)).toBe(false);
        expect(ehTxtLoteBarueri(csvLatin1([{ numero: 39 }]))).toBe(false);
    });

    it('coluna obrigatória que falta derruba a leitura NOMEANDO a coluna', () => {
        const semChave = Buffer.from(
            [CABECALHO.slice(0, 33).map((c) => `"${c}"`).join(';'), '"1";"03/07/2026"'].join('\r\n'), 'latin1',
        );
        expect(() => parseCsvNfseBarueri(semChave)).toThrow(/Chave de acesso/i);
    });
});

describe('🔤 o arquivo é ISO-8859-1 — ler como UTF-8 corrompe o nome do tomador', () => {
    it('a razão social e o endereço saem com os acentos certos', () => {
        const r = parseCsvNfseBarueri(csvLatin1([{ numero: 39, tomador: 'CLÍNICA SÃO JOSÉ LTDA' }]));
        expect(r.notas[0].tomadorNome).toBe('CLÍNICA SÃO JOSÉ LTDA');
        expect(r.notas[0].tomadorEndereco.cidade).toBe('SÃO PAULO');
        // É este nome que vai ao COD_PART do 0150 do SPED — corrompido, ele
        // entra torto no arquivo fiscal e ninguém confere a olho.
        expect(r.notas[0].tomadorNome).not.toMatch(/�/);
    });
});

describe('🗓️ a competência é a Data Base (o FATO), nunca a Data NF (o papel)', () => {
    it('emitida em 03/07 com base 30/06 pertence a JUNHO', () => {
        const r = parseCsvNfseBarueri(csvLatin1([{ numero: 40, dataNf: '03/07/2026', dataBase: '30/06/2026' }]));
        const doc = documentoDaNotaBarueri(r.notas[0], { empresaCnpj: PRESTADOR });
        expect(doc.competencia).toBe('2026-06');
        expect(doc.competenciaOrigem).toBe('fato-gerador');
        expect(doc.competenciaDivergeDaEmissao).toBe(true);
        expect(doc.dhEmi).toBe('2026-07-03');
    });

    it('sem divergência a competência é a do mês da nota', () => {
        const r = parseCsvNfseBarueri(csvLatin1([{ numero: 41, dataNf: '16/07/2026' }]));
        expect(documentoDaNotaBarueri(r.notas[0], { empresaCnpj: PRESTADOR }).competencia).toBe('2026-07');
    });
});

describe('🚫 o cancelamento vem na FONTE — coluna "Nf Ativa"', () => {
    it('"Cancelada" grava a nota cancelada e carimba quem disse', () => {
        const r = parseCsvNfseBarueri(csvLatin1([{ numero: 39, ativa: 'Cancelada' }]));
        expect(r.canceladas).toBe(1);
        const doc = documentoDaNotaBarueri(r.notas[0], { empresaCnpj: PRESTADOR });
        expect(doc.status).toBe('cancelado');
        expect(doc.canceladoPelaFonte).toBe('portal-barueri');
    });

    it('"Sim" é nota ativa', () => {
        const r = parseCsvNfseBarueri(csvLatin1([{ numero: 40, ativa: 'Sim' }]));
        expect(documentoDaNotaBarueri(r.notas[0], { empresaCnpj: PRESTADOR }).status).toBe('autorizado');
    });

    it('🚨 rótulo que o CFI NÃO conhece não vira status nenhum — marcar nota válida como cancelada apaga receita', () => {
        const r = parseCsvNfseBarueri(csvLatin1([{ numero: 42, ativa: 'Em processamento' }]));
        const doc = documentoDaNotaBarueri(r.notas[0], { empresaCnpj: PRESTADOR });
        expect(doc.status).toBeUndefined();
        expect(doc.situacao).toBeUndefined();
        expect(r.avisos.join(' ')).toMatch(/Em processamento/);
        expect(r.avisos.join(' ')).toMatch(/apaga receita/);
    });

    it('a régua da coluna é conservadora nos dois sentidos', () => {
        expect(situacaoDaColunaAtiva('Cancelada').cancelada).toBe(true);
        expect(situacaoDaColunaAtiva('CANCELADO EM 03/07').cancelada).toBe(true);
        expect(situacaoDaColunaAtiva('Sim').situacao).toBe('ativa');
        expect(situacaoDaColunaAtiva('').situacao).toBeNull();
        expect(situacaoDaColunaAtiva('Nao').situacao).toBeNull();
    });
});

describe('🔑 o id é a CHAVE — o MESMO que a captura pelo ADN grava', () => {
    it('a nota do CSV cai POR CIMA da que veio pelo Portal Nacional, não ao lado', () => {
        const chave = chaveDe(76);
        // O ADN gravava `docId = meta.chave`. O dono tem de devolver o MESMO
        // valor, senão a delegação órfã todo documento já capturado.
        expect(idDocumentoNfse({ chave })).toBe(chave);
        expect(idDocumentoNfse({
            chave, prestadorCnpj: PRESTADOR, tomadorCnpj: TOMADOR, numero: '76',
        })).toBe(chave);
    });

    it('sem chave, cai na fórmula por partes da NFS-e (que exige número)', () => {
        expect(idDocumentoNfse({ prestadorCnpj: PRESTADOR, tomadorCnpj: TOMADOR, numero: '76' }))
            .toBe(`nfsesp-${TOMADOR}-${PRESTADOR}-76`);
    });

    it('o prestador sai da CHAVE — este CSV não tem coluna de prestador', () => {
        const r = parseCsvNfseBarueri(csvLatin1([{ numero: 39 }]));
        expect(r.notas[0].prestadorCnpj).toBe(PRESTADOR);
        expect(r.notas[0].codMunIBGE).toBe('3505708');
        expect(direcaoDaNotaBarueri(r.notas[0], PRESTADOR)).toBe('saida');
    });
});

describe('🏢 o arquivo é DESTA empresa? (o caso da nota no cliente errado)', () => {
    const r = () => parseCsvNfseBarueri(csvLatin1([{ numero: 39 }, { numero: 40 }]));

    it('empresa de outra raiz é RECUSADA nomeando os dois CNPJs', () => {
        const p = conferirPosseDoCsvBarueri(r(), OUTRA);
        expect(p.ok).toBe(false);
        expect(p.motivo).toContain(PRESTADOR);
        expect(p.motivo).toContain(OUTRA);
        expect(p.motivo).toMatch(/cliente errado/i);
    });

    it('filial da mesma raiz passa — matriz e filial são a mesma empresa no resto do app', () => {
        expect(conferirPosseDoCsvBarueri(r(), FILIAL_PRESTADOR).ok).toBe(true);
        expect(direcaoDaNotaBarueri(r().notas[0], FILIAL_PRESTADOR)).toBe('saida');
    });

    it('a empresa do outro LADO (export de notas recebidas) não é chamada de "outra empresa"', () => {
        // Dizer "é de outra empresa" sobre o arquivo em que ela é a TOMADORA
        // manda procurar no lugar errado — o achado 18.
        expect(conferirPosseDoCsvBarueri(r(), TOMADOR).ok).toBe(true);
        expect(direcaoDaNotaBarueri(r().notas[0], TOMADOR)).toBe('entrada');
    });

    it('sem chave legível NÃO bloqueia — ausência não é prova, e o fato vai dito', () => {
        const semChave = parseCsvNfseBarueri(csvLatin1([{ numero: 39, chave: '' }]));
        const p = conferirPosseDoCsvBarueri(semChave, OUTRA);
        expect(p.ok).toBe(true);
        expect(p.semChave).toBe(true);
        expect(semChave.avisos.join(' ')).toMatch(/sem chave de acesso/i);
    });
});

describe('💰 valor e retenção: ausente NUNCA é zero', () => {
    it('valor vazio não vira 0,00 e a nota fica fora da soma, contada', () => {
        expect(valorPtBr('')).toBeNull();
        expect(valorPtBr('0,0000')).toBe(0);
        expect(valorPtBr('426212,0400')).toBe(426212.04);
        const r = parseCsvNfseBarueri(csvLatin1([{ numero: 39, valor: '' }, { numero: 40 }]));
        expect(r.semValor).toBe(1);
        expect(r.valorSomaCalculada).toBe(426212.04);
        expect(documentoDaNotaBarueri(r.notas[0], { empresaCnpj: PRESTADOR }).valorTotal).toBeUndefined();
    });

    it('as retenções federais entram DECOMPOSTAS, como o portal manda', () => {
        const r = parseCsvNfseBarueri(csvLatin1([{ numero: 39, retencoes: true }]));
        const doc = documentoDaNotaBarueri(r.notas[0], { empresaCnpj: PRESTADOR });
        // Base 426.212,04 → IRRF 1,5% · PIS 0,65% · COFINS 3% · CSLL 1%.
        expect(doc.valorIr).toBe(6393.18);
        expect(doc.valorPis).toBe(2770.38);
        expect(doc.valorCofins).toBe(12786.36);
        expect(doc.valorCsll).toBe(4262.12);
    });

    it('🚨 o código de ISS retido do portal NÃO vira `issRetido` — o significado não está provado', () => {
        const r = parseCsvNfseBarueri(csvLatin1([{ numero: 39 }]));
        const doc = documentoDaNotaBarueri(r.notas[0], { empresaCnpj: PRESTADOR });
        expect(doc.issRetidoCodigoPortal).toBe('2');
        expect(doc).not.toHaveProperty('issRetido');
    });
});

describe('🧬 o merge NÃO pode apagar o que o outro trilho gravou', () => {
    it('campo que este arquivo não responde não viaja como null', () => {
        // O documento deste id pode já existir, trazido pelo ADN — é esse o
        // ponto de o id ser a chave. `merge: true` não protege de `null`
        // ESCRITO: ele sobrescreve, e o dado some calado.
        const imp = readFileSync(join(__dirname, '..', 'sefaz-backend', 'nfse-barueri-csv-importer.js'), 'utf8')
            .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        expect(imp).toMatch(/\.\.\.semVazios\(\{/);
        expect(imp).not.toMatch(/empresaNome: ctx\.empresaNome \|\| null/);
    });

    it('o documento montado não carrega chave vazia nem valor nulo à toa', () => {
        const r = parseCsvNfseBarueri(csvLatin1([{ numero: 39, chave: '', valor: '' }]));
        const doc = documentoDaNotaBarueri(r.notas[0], { empresaCnpj: PRESTADOR });
        expect(doc.valorTotal).toBeUndefined();
        expect(doc.chave).toBeNull(); // vira ausência no payload (semVazios)
    });
});

describe('🔌 a régua está LIGADA — régua que ninguém chama é flag que ninguém lê', () => {
    const rota = readFileSync(join(__dirname, '..', 'sefaz-backend', 'nfse-sp-routes.js'), 'utf8')
        .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

    it('a MESMA porta reconhece Barueri — aba nova seria a tela que ninguém acha', () => {
        expect(rota).toMatch(/if \(ehCsvNfseBarueri\(req\.file\.buffer\)\)/);
        expect(rota).toMatch(/if \(ehTxtLoteBarueri\(req\.file\.buffer\)\)/);
    });

    it('a POSSE é conferida ANTES de gravar', () => {
        const iPosse = rota.indexOf('conferirPosseDoCsvBarueri(');
        const iGrava = rota.indexOf('importarCsvNfseBarueri(');
        expect(iPosse).toBeGreaterThan(0);
        expect(iGrava).toBeGreaterThan(iPosse);
    });

    it('o importador do ADN usa o DONO do id — dois donos fariam a nota entrar duas vezes', () => {
        const adn = readFileSync(join(__dirname, '..', 'sefaz-backend', 'nfse-nacional-dfe-importer.js'), 'utf8')
            .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        expect(adn).toMatch(/const docId = idDocumentoNfse\(\{ chave: meta\.chave \}\)/);
        expect(adn).not.toMatch(/const docId = meta\.chave;/);
    });

    it('🚨 "virou cancelada" se mede pela RÉGUA, nunca pelo campo cru do que estava no banco', () => {
        // A trava `canceladaReguaUnica` pegou isto: `antes.status` continua
        // 'autorizado' quando o cancelamento veio por EVENTO (que é como ele
        // chega pelo ADN — o trilho por onde estas notas subiram ativas), e
        // comparar o campo cru anunciaria "o faturamento mudou" sobre nota que
        // já estava cancelada.
        const imp = readFileSync(join(__dirname, '..', 'sefaz-backend', 'nfse-barueri-csv-importer.js'), 'utf8')
            .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
        expect(imp).toMatch(/docCancelado\(antes\)/);
        expect(imp).not.toMatch(/antes\.status/);
    });

    it('a tela DIZ que o portal de Barueri entra por aqui', () => {
        const tela = readFileSync(join(__dirname, '..', 'components', 'xml', 'XmlNfseSpCsv.tsx'), 'utf8');
        expect(tela).toMatch(/Barueri/);
        expect(tela).toMatch(/viraramCanceladas/);
    });
});
