/**
 * "O cliente fez certo?" — prova de configuração da saída mod 55.
 *
 * Paulo, 04/08: "como assegurar que o cliente fez correto, como podemos
 * confirmar se o cadastro já está apto conforme ele informa".
 *
 * O erro que estes testes impedem é o INJUSTO: cobrar instruções de quem já
 * configurou só porque não vendeu nada no mês. Aptidão se prova com UMA nota,
 * de qualquer data; atividade é outra coisa.
 */
import {
    provaDoDocumento, classificarAptidaoEmpresa, montarAptidaoSaida,
} from '../sefaz-backend/aptidao-saida.js';
import { extrairAutXml, autorizadoNoXml } from '../sefaz-backend/xml-metadata-helper.js';

const ESCRITORIO = '44388152000189';
const HOJE = Date.parse('2026-08-04T12:00:00Z');
const diasAtras = (n: number) => new Date(HOJE - n * 24 * 3600 * 1000).toISOString();

describe('extrairAutXml — a prova está escrita na nota', () => {
    // Bloco real do print do Paulo (TECIDOS VINATEX → JAIR MAFUZ).
    const XML = `<dest><CNPJ>42683241000122</CNPJ></dest>
        <autXML><CNPJ>44388152000189</CNPJ></autXML><det nItem="1">`;

    it('acha o CNPJ autorizado', () => {
        expect(extrairAutXml(XML)).toEqual(['44388152000189']);
        expect(autorizadoNoXml(XML, ESCRITORIO)).toBe(true);
    });

    it('nota sem autXML devolve lista vazia', () => {
        expect(extrairAutXml('<dest><CNPJ>1</CNPJ></dest>')).toEqual([]);
        expect(autorizadoNoXml('<dest/>', ESCRITORIO)).toBe(false);
    });

    it('a NF-e aceita vários autorizados — devolve todos', () => {
        const multi = '<autXML><CNPJ>11111111000111</CNPJ></autXML>'
            + '<autXML><CNPJ>44388152000189</CNPJ></autXML>';
        expect(extrairAutXml(multi)).toEqual(['11111111000111', '44388152000189']);
        expect(autorizadoNoXml(multi, ESCRITORIO)).toBe(true);
    });

    it('autorizado por CPF também conta', () => {
        expect(extrairAutXml('<autXML><CPF>12345678901</CPF></autXML>')).toEqual(['12345678901']);
    });

    it('outro escritório autorizado NÃO nos torna aptos', () => {
        expect(autorizadoNoXml('<autXML><CNPJ>99999999000199</CNPJ></autXML>', ESCRITORIO)).toBe(false);
    });
});

describe('provaDoDocumento', () => {
    it('e-mail prova o cofre', () => {
        expect(provaDoDocumento({ origem: 'email' }, ESCRITORIO)).toBe('cofre');
    });

    it('marca literal do autXML prova, sem depender de inferência', () => {
        expect(provaDoDocumento({ origem: 'sefaz', autXmlEscritorio: true }, ESCRITORIO)).toBe('autxml');
        expect(provaDoDocumento({ autXml: ['44388152000189'] }, ESCRITORIO)).toBe('autxml');
    });

    it('saída pela SEFAZ prova autXML mesmo em doc antigo (Rejeição 641)', () => {
        expect(provaDoDocumento({ origem: 'sefaz' }, ESCRITORIO)).toBe('autxml');
    });

    it('importação manual e conferência NÃO provam nada', () => {
        expect(provaDoDocumento({ origem: 'manual' }, ESCRITORIO)).toBeNull();
        expect(provaDoDocumento({ origem: 'sefaz', fonte: 'conferencia-chaves' }, ESCRITORIO)).toBeNull();
        expect(provaDoDocumento({ origem: 'sefaz', fonte: 'consulta-chave' }, ESCRITORIO)).toBeNull();
        expect(provaDoDocumento({ origem: 'sharepoint_auto' }, ESCRITORIO)).toBeNull();
    });
});

describe('classificarAptidaoEmpresa', () => {
    const empresa = { empresaId: 'e1', cnpj: '12345678000199', nome: 'CLIENTE X' };
    const classificar = (docs: any[]) => classificarAptidaoEmpresa({
        empresa, docsDaEmpresa: docs, agoraMs: HOJE, cnpjEscritorio: ESCRITORIO,
    });

    it('recebendo agora → apto e ativo', () => {
        const r = classificar([{ chave: 'A', origem: 'sefaz', dhEmi: diasAtras(3) }]);
        expect(r.status).toBe('apto-ativo');
        expect(r.apto).toBe(true);
        expect(r.acao).toBe('Nada a fazer.');
    });

    it('O CASO QUE IMPORTA: configurou e não vendeu no mês → APTO, sem pendência', () => {
        const r = classificar([{ chave: 'A', origem: 'email', dhEmi: diasAtras(45) }]);
        expect(r.status).toBe('apto-sem-fluxo');
        expect(r.apto).toBe(true);
        expect(r.acao).toMatch(/NÃO é pendência de cadastro/);
    });

    it('apto há muito tempo sem nada → suspeita de REGRESSÃO, ação diferente', () => {
        const r = classificar([{ chave: 'A', origem: 'sefaz', dhEmi: diasAtras(200) }]);
        expect(r.status).toBe('apto-parou');
        expect(r.apto).toBe(true);
        expect(r.acao).toMatch(/não reenvie as instruções antes disso/);
    });

    it('só nota importada à mão → SEM PROVA, e é aqui que se cobra', () => {
        const r = classificar([
            { chave: 'A', origem: 'manual', dhEmi: diasAtras(5) },
            { chave: 'B', origem: 'sefaz', fonte: 'conferencia-chaves', dhEmi: diasAtras(2) },
        ]);
        expect(r.status).toBe('sem-prova');
        expect(r.apto).toBe(false);
        expect(r.acao).toMatch(/autXML/);
    });

    it('empresa sem mod 55 não vira cobrança', () => {
        const r = classificar([]);
        expect(r.status).toBe('sem-saida-55');
        expect(r.acao).toMatch(/Nada a configurar/);
    });

    it('guarda a nota e a data que servem de PROVA', () => {
        const r = classificar([
            { chave: 'ANTIGA', origem: 'sefaz', dhEmi: diasAtras(300) },
            { chave: 'NOVA', origem: 'sefaz', dhEmi: diasAtras(2) },
        ]);
        expect(r.provaChave).toBe('ANTIGA');
        expect(r.provaTipo).toBe('autxml');
        expect(r.status).toBe('apto-ativo');   // atividade vem da mais RECENTE
    });

    it('os dois trilhos aparecem quando existem', () => {
        const r = classificar([
            { chave: 'A', origem: 'email', dhEmi: diasAtras(10) },
            { chave: 'B', origem: 'sefaz', dhEmi: diasAtras(5) },
        ]);
        expect(r.trilhos).toEqual(['autxml', 'cofre']);
    });
});

describe('montarAptidaoSaida', () => {
    const empresas = [
        { empresaId: 'e1', cnpj: '11111111000111', nome: 'ATIVO' },
        { empresaId: 'e2', cnpj: '22222222000122', nome: 'SEM FLUXO' },
        { empresaId: 'e3', cnpj: '33333333000133', nome: 'SEM PROVA' },
        { empresaId: 'e4', cnpj: '44444444000144', nome: 'NAO EMITE' },
    ];
    const docsSaida = [
        { empresaCnpj: '11111111000111', chave: 'A', origem: 'sefaz', dhEmi: diasAtras(2) },
        { empresaCnpj: '22222222000122', chave: 'B', origem: 'email', dhEmi: diasAtras(60) },
        { empresaCnpj: '33333333000133', chave: 'C', origem: 'manual', dhEmi: diasAtras(1) },
    ];

    const r = montarAptidaoSaida({ empresas, docsSaida, agoraMs: HOJE, cnpjEscritorio: ESCRITORIO });

    it('conta APTOS separando de ATIVOS — é a distinção que faltava', () => {
        expect(r.resumo.aptos).toBe(2);       // ativo + sem fluxo
        expect(r.resumo.ativos).toBe(1);
        expect(r.resumo.aptosSemFluxo).toBe(1);
        expect(r.resumo.semProva).toBe(1);
        expect(r.resumo.semSaida55).toBe(1);
    });

    it('ordena por AÇÃO: quem precisa de cobrança vem primeiro', () => {
        expect(r.linhas.map(l => l.nome)).toEqual(['SEM PROVA', 'SEM FLUXO', 'ATIVO', 'NAO EMITE']);
    });

    it('a ressalva separa aptidão de atividade e limita a cobrança', () => {
        const texto = r.ressalvas.join(' ');
        expect(texto).toMatch(/APTIDÃO não é o mesmo que ATIVIDADE/);
        expect(texto).toMatch(/Só cobre instruções de quem está em "Sem prova/);
    });
});
