// ============================================================================
// __tests__/nfsePdfDanfseV2Osasco.test.ts — a DANFSe v2.0 (leiaute nacional
// com IBS/CBS) entra pelo PDF com a competência do PAPEL, não da emissão.
//
// 21/09/2026, Paulo (0070 · IMAGEM MEDICINA, Osasco, NF 1039): RPS de
// 03/08/2026 emitido em 01/09/2026 com "COMPETÊNCIA DA NFS-e 03-08-2026". O
// app importou em SETEMBRO, e a 📅 Competência do acervo não listava a nota.
//
// A DANFSe v2.0 escreve as datas com HÍFEN ("01-09-2026 03:02:21") e usa
// rótulos próprios ("TOMADOR/ADQUIRENTE", "VALOR DA OPERAÇÃO / SERVIÇO",
// "Indicador Municipal (Inscrição)", "Município/Sigla UF", "Código IBGE/CEP").
// O leitor só conhecia a v1.0: devolvia vazio para competência E data, o
// recorte recusava o PDF, a trava de valores barrava (serviço 0,00 com líquido
// positivo) e tudo era DIGITADO — a nota entrou pela emissão.
//
// O fixture é o texto que o pdfjs extrai do PDF real (arquivo de espelho).
// ============================================================================
jest.mock('pdfjs-dist', () => ({
    GlobalWorkerOptions: { workerSrc: '' },
    version: '0.0.0',
    getDocument: () => ({ promise: Promise.resolve({ numPages: 0 }) }),
}));

import { parseNfseFromText } from '../services/nfsePdfParserService';
import { recorteDaNfsePdf, dhEmiDaNfsePdf, diaDoCampoCompetencia } from '../services/nfsePdfRecorte';
import { conferirValoresDaNfsePdf } from '../services/nfsePdfValores';
import { normalizarCompetencia } from '../sefaz-backend/competencia.js';
import { classificarCompetenciaDoAcervo } from '../sefaz-backend/competencia-acervo.js';

const TXT_DANFSE_V2_OSASCO = `
DANFSe V2.0
Documento Auxiliar da NSF-e
 
Município: Osasco / SP

Prefeitura

Produção

A autenticidade desta NFS-e pode ser verificada
pela leitura deste código QR ou pela consulta da
chave de acesso no portal nacional da NFS-e

CHAVE DE ACESSO DA NFS-E

35344011208204029000105000000000103926090757774250

NÚMERO DA NFS-e

1039

COMPETÊNCIA DA NFS-e

03-08-2026

DATA E HORA DA EMISSÃO DA NFS-E

01-09-2026 03:02:21

DATA E HORA DA EMISSÃO DA DPS

03-08-2026 12:00:00

SÉRIE DA DPS

00017

NÚMERO DA DPS

1039

FINALIDADE

NFS-e regular

SITUAÇÃO DA NFS-E

NFS-e Gerada
Prestador

EMITENTE DA NFS-e

PRESTADOR/FORNECEDOR
 
CNPJ/CPF/NIF

08.204.029/0001-05

Indicador Municipal (Inscrição)

83316

Telefone

1133371554

Município/Sigla UF

Osasco/SP

Nome/Nome Empresarial

IMAGEM -MEDICINA DIAGNOSTICA EM RADIOLOGIA EIRELI

Código IBGE/CEP

3534401/06086-045

E-mail
*Endereço

AV. - Dionysia Alves Barreto,678,,Vila Osasco

Regime de Apuração Tributária pelo SN

-

Simples Nacional na Data de Competência

Não Optante

TOMADOR/ADQUIRENTE
 
CNPJ/CPF/NIF

66.518.267/0034-41

Indicador Municipal (Inscrição)

-

Telefone

-

Município/Sigla UF

Mogi das Cruzes/3530607

Nome/Nome Empresarial

CENTRO DE ESTUDOS E PESQUISAS DR JOAO AMORIM

Código IBGE/CEP

3530607/08780-290

E-mail
*Endereço

Avenida - Capitão Manoel Rudge,268,,Parque Monte Líbano

DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-E

INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-E

SERVIÇO PRESTADO
 
Código de Tributação Nacional/Municipal

040201/0402

Código da NBS

1.2301.93.00

Local da Prestação / Sigla UF / País

Mogi das Cruzes / SP - BR

4.02 - Análises clínicas, patologia, eletricidade médica, radioterapia, quimioterapia, ultra-sonografia, ressonância magnética, radiologia, tomografia e congêneres.

Descrição do Serviço

Contrato de Prestação de Serviços n 49402026. Objeto: Prestação de serviços especializados em diagnóstico por imagem, na modalidade tomografia computadorizada. Contrato de gestão: N 572024 - ÚNICA.
Competência: Julho 2026 Dados Bancários: Banco Itaú Agencia: 0300 CC: 75534-5 Chave Pix CNPJ: 08.204.0290001-05

TRIBUTAÇÃO MUNICIPAL (ISSQN)
 
Tipo de Tributação do ISSQN

Operação tributável

Município / Sigla UF / País da Incidência do ISSQN

Osasco / SP / BR

Suspensão da Exigibilidade do ISSQN

-

** Regime Especial de Tributação do ISSQN

Nenhum

Número do Processo Suspensão

-

Tipo de Imunidade do ISSQN

-

Total Deduções /Reduções

-

** Benefício Municipal

-

Desconto Incodicionado

-

Cálculo do BM

-

Retenção do ISSQN

Não Retido

BC ISSQN

90.000,00

ISSQN Apurado

2.700,00

Alíquota Aplicada

3,00

TRIBUTAÇÃO FEDERAL (EXCETO CBS)
 
IRRF

1.350,00

Contribuição Previdênciária - Retida

-

Contribuições Sociais - Retidas

4.185,00

Descrição Contrib. Sociais Retidas

PIS/COFINS/CSLL Retidos

PIS - Débito Apuração Própria

0,00

COFINS - Débito Apuração Própria

0,00

TRIBUTAÇÃO IBS / CBS
 
CST / cClassTrib

200/200029

Indicador de Operação / Còdigo IBGE Incidência / Município Incidência / Sigla UF

030101 / 3534401 / Osasco

Red, Alíquota IBS / Red. Alíquota CBS

60% / 60%

Exclusões e Reduções da Base de Cálculo

2.700,00

Alíquota - IBS UF / IBS Mun

0,10 / 0,00

Base de Cálculo Após Exclusões e Reduções

87.300,00

Alíq. Efetiva Estadual - IBS

0,04

Alíq Efetiva Municipal - IBS

0,00

Valor Apurado Estadual - IBS

34,92

Valor Apurado Municipal

0,00

Alíquota Efetiva - CBS

0,36

Valor Total Apurado

34,92

Valor Total Apurado - CBS

314,28

Alíquota - CBS

0,90

VALOR TOTAL DA NFS-E
 
VALOR DA OPERAÇÃO / SERVIÇO

90.000,00

Desconto Incondicionado

-

Desconto Condicionado

-

Total do IBS/CBS

349,20

Total das Retenções (ISSQN / Federais)

4.950,00

VALOR LÍQUIDO DA NFS-e

84.465,00

VALOR LÍQUIDO DA NFS-e + IBS/CBS

84.465,00

INFORMAÇÕES COMPLEMENTARES

*Informações Adicionais:
Prestador do Serviço enquadrado no regime de ISS Auto-Lançado.

ISS Devido pelo Prestador do Serviço
 
no município de Osasco; deve ser recolhido até o dia 10 do próximo mês.

Totais Aproximados dos Tributos cfe.Lei N 12.741 / 2012: Federais
 
R$0,00
 
Estaduais: R$
 
0,00;
 
Municipais: R$
2700,00

Para verificar a autenticidade desta NFS-e acesse: https://www.nfse.gov.br/consultapublica
`.trim();

describe('🚨 DANFSe v2.0 (Osasco, NF 1039): o leitor lê o papel inteiro', () => {
    const r = parseNfseFromText(TXT_DANFSE_V2_OSASCO);

    it('competência e emissão saem com HÍFEN, como o papel escreve', () => {
        expect(r.competencia).toBe('03-08-2026');
        expect(r.dataEmissao).toBe('01-09-2026 03:02:21');
    });

    it('número, série da DPS e chave nacional', () => {
        expect(r.numero).toBe('1039');
        expect(r.serie).toBe('00017');
        expect(r.chaveAcesso).toBe('35344011208204029000105000000000103926090757774250');
    });

    it('prestador: CNPJ, inscrição, nome, município/UF, CEP e telefone', () => {
        expect(r.prestador.cnpj).toBe('08.204.029/0001-05');
        expect(r.prestador.inscricaoMunicipal).toBe('83316');
        expect(r.prestador.nome).toBe('IMAGEM -MEDICINA DIAGNOSTICA EM RADIOLOGIA EIRELI');
        expect(r.prestador.municipio).toBe('Osasco');
        expect(r.prestador.uf).toBe('SP');
        expect(r.prestador.cep).toBe('06086-045');
        expect(r.prestador.telefone).toBe('1133371554');
    });

    it('tomador ("TOMADOR/ADQUIRENTE"): CNPJ e nome — e o código IBGE na casa da UF NÃO vira sigla', () => {
        expect(r.tomador.cnpj).toBe('66.518.267/0034-41');
        expect(r.tomador.nome).toBe('CENTRO DE ESTUDOS E PESQUISAS DR JOAO AMORIM');
        expect(r.tomador.municipio).toBe('Mogi das Cruzes');
        expect(r.tomador.uf).toBe('');
        expect(r.tomador.cep).toBe('08780-290');
    });

    it('valores: serviço, base (BC ISSQN, não a base do IBS), ISS, alíquota, IRRF, retenções e líquido', () => {
        expect(r.valorServicos).toBe(90000);
        expect(r.baseCalculo).toBe(90000);
        expect(r.valorIss).toBe(2700);
        expect(r.aliquotaIss).toBe(3);
        expect(r.valorIrrf).toBe(1350);
        // PIS/COFINS/CSLL retidos vêm num campo só na DANFSe.
        expect(r.valorOutrasRetencoes).toBe(4185);
        expect(r.valorLiquido).toBe(84465);
        expect(r.valorIssRetido).toBe(0);
    });

    it('🚨 "-" é campo VAZIO: desconto e dedução não pegam o valor do vizinho', () => {
        expect(r.valorDescIncondicional).toBe(0);
        expect(r.valorDescCondicional).toBe(0);
        expect(r.valorDeducoes).toBe(0);
        expect(r.valorInss).toBe(0);
    });

    it('código de tributação nacional pontuado, município emissor e local da prestação', () => {
        expect(r.codigoServico).toBe('04.02.01');
        expect(r.municipioEmissor).toBe('Osasco');
        expect(r.municipioPrestacao).toBe('Mogi das Cruzes');
    });

    it('a trava de valores NÃO barra — o serviço foi lido', () => {
        expect(conferirValoresDaNfsePdf(r).bloquear).toBe(false);
    });

    it('🚨 O RECORTE: a nota entra em AGOSTO (o papel), não em setembro (a emissão) — e leva o fato gerador', () => {
        const rec = recorteDaNfsePdf(r);
        expect(rec.impedimento).toBeNull();
        expect(rec.competencia).toBe('2026-08');
        expect(rec.competenciaOrigem).toBe('campo-competencia');
        expect(rec.dhEmi).toBe('2026-09-01T03:02:21');
        expect(rec.dataFatoGerador).toBe('2026-08-03');
    });
});

describe('o hífen entra nos donos de data e competência', () => {
    it('normalizarCompetencia conhece DD-MM-AAAA', () => {
        expect(normalizarCompetencia('03-08-2026')).toBe('2026-08');
        expect(normalizarCompetencia('03-13-2026')).toBeNull();
    });
    it('dhEmiDaNfsePdf lê DD-MM-AAAA com e sem hora — o dia vem do texto, não de new Date()', () => {
        expect(dhEmiDaNfsePdf('01-09-2026 03:02:21')).toBe('2026-09-01T03:02:21');
        expect(dhEmiDaNfsePdf('03-08-2026')).toBe('2026-08-03');
    });
    it('o dia do campo de competência: DANFSe (barra ou hífen) responde; ABRASF MM/AAAA não é dia', () => {
        expect(diaDoCampoCompetencia('10/05/2026')).toBe('2026-05-10');
        expect(diaDoCampoCompetencia('03-08-2026')).toBe('2026-08-03');
        expect(diaDoCampoCompetencia('08/2026')).toBeNull();
        expect(recorteDaNfsePdf({ competencia: '08/2026', dataEmissao: '18/08/2026' }).dataFatoGerador).toBeNull();
        expect(recorteDaNfsePdf({ competencia: '', dataEmissao: '18/08/2026' }).dataFatoGerador).toBeNull();
    });
});

describe('📅 com o fato gerador gravado, a Competência do acervo enxerga a nota importada por PDF', () => {
    const base = {
        tipo: 'nfse', status: 'autorizado', direcao: 'saida',
        dhEmi: '2026-09-01T03:02:21', dataFatoGerador: '2026-08-03',
        valorServicos: 90000, valorTotal: 90000,
    };
    it('gravada em setembro (pela emissão) → "mes-errado", com agosto como certa', () => {
        const c: any = classificarCompetenciaDoAcervo({ ...base, competencia: '2026-09' });
        expect(c.situacao).toBe('mes-errado');
        expect(c.competenciaCerta).toBe('2026-08');
    });
    it('gravada em agosto → "confere"', () => {
        expect(classificarCompetenciaDoAcervo({ ...base, competencia: '2026-08' }).situacao).toBe('confere');
    });
    it('sem o fato gerador (como as notas de PDF eram gravadas) ela não entra na fila', () => {
        const { dataFatoGerador, ...sem } = base;
        expect(classificarCompetenciaDoAcervo({ ...sem, competencia: '2026-09' }).situacao).toBe('sem-fato-gerador');
    });
});
