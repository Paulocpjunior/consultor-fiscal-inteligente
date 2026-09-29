/**
 * 🚚 QUEM ESCRITURA O CT-e É O TOMADOR (Paulo, 29/09, A CASTELLANO, Resumo por
 * CFOP: *"o consultor está puxando o CT-e vinculado à nota fiscal, não
 * deveria aparecer na minha escrituração"* — 50 conhecimentos com o CFOP da
 * transportadora saindo como SAÍDA da empresa).
 *
 * Fatos cobrados: o cabeçalho lê o tomador (toma3 → participante apontado;
 * toma4 → o CNPJ do próprio bloco); o papel da empresa (emitente/tomador/
 * terceiro/sem-tomador); a direção é pelo papel; terceiro fica FORA e dito;
 * sem tomador entra como antes e dito; os dois SPEDs e os três recortes dos
 * Relatórios passam pela régua; a releitura recupera o tomador do XML guardado
 * (versão nova reabre o "já relido").
 */
import { readFileSync } from 'fs';
import { join } from 'path';
// @ts-expect-error módulo .js puro sem tipos
import { lerCabecalhoCte, patchDoCabecalhoCte, classificarCteParaCabecalho, VERSAO_RELEITURA_CTE } from '../sefaz-backend/cte-cabecalho.js';
import {
    papelDaEmpresaNoCte, direcaoDoCte, cteEntraNaEscrituracao, selecionarCtes, avisosDosCtes, ehCteDoc,
} from '../sefaz-backend/cte-tomador.js';
import { direcaoEfetivaDoc } from '../sefaz-backend/xml-metadata-helper.js';
import { selecionarCtesBlocoD, selecionarCtesBlocoDComAvisos, documentosEscrituradosNoFiscal } from '../sefaz-backend/sped-selecao-documentos.js';

const RAIZ = join(__dirname, '..');
const TRANSP = '44555666000177';
const CASTELLANO = '51227692000146';
const CLIENTE = '07141537000110';
const OUTRO = '99888777000166';

const xmlCte = (toma: string, extra = '') => `<?xml version="1.0"?><cteProc><CTe><infCte Id="CTe35260844555666000177570010000000011234567890">
  <ide><cUF>35</cUF><CFOP>6353</CFOP><mod>57</mod><nCT>000000001</nCT><cMunIni>3550308</cMunIni><cMunFim>4106902</cMunFim>
    ${toma === '4' ? `<toma4><toma>4</toma><CNPJ>${OUTRO}</CNPJ><xNome>OUTRO</xNome></toma4>` : `<toma3><toma>${toma}</toma></toma3>`}</ide>
  <emit><CNPJ>${TRANSP}</CNPJ></emit>
  <rem><CNPJ>${CASTELLANO}</CNPJ></rem>
  <dest><CNPJ>${CLIENTE}</CNPJ></dest>${extra}
  <vPrest><vTPrest>500.00</vTPrest></vPrest>
  <imp><ICMS><ICMS00><CST>00</CST><vBC>500.00</vBC><pICMS>12.00</pICMS><vICMS>60.00</vICMS></ICMS00></ICMS></imp>
</infCte></CTe></cteProc>`;

describe('lerCabecalhoCte lê o TOMADOR', () => {
    it('toma3 = 0 aponta o remetente; 3 o destinatário; toma4 traz o próprio CNPJ', () => {
        expect(lerCabecalhoCte(xmlCte('0'))).toMatchObject({ toma: '0', cnpjTomador: CASTELLANO });
        expect(lerCabecalhoCte(xmlCte('3'))).toMatchObject({ toma: '3', cnpjTomador: CLIENTE });
        expect(lerCabecalhoCte(xmlCte('4'))).toMatchObject({ toma: '4', cnpjTomador: OUTRO });
    });

    it('sem a tag: null (ausência não vira "é tomador")', () => {
        const semToma = xmlCte('0').replace(/<toma3>[\s\S]*?<\/toma3>/, '');
        expect(lerCabecalhoCte(semToma)).toMatchObject({ toma: null, cnpjTomador: null });
    });

    it('a releitura grava o tomador só quando falta, e a versão nova reabre o "já relido"', () => {
        const gravado = { tipoDoc: 'CTe', chave: '35260844555666000177570010000000011234567890', storagePath: 'xmls/x.xml', cabecalhoCteVersao: 3,
            numero: '1', cfop: '6353', cstIcms: '00', aliqIcms: 12, totais: { vBC: 500, vICMS: 60 }, codMunIniCte: '3550308', codMunFimCte: '4106902' };
        expect(classificarCteParaCabecalho(gravado)).toBe('alvo');
        expect(VERSAO_RELEITURA_CTE).toBeGreaterThanOrEqual(4);
        const patch = patchDoCabecalhoCte(gravado, lerCabecalhoCte(xmlCte('3')));
        expect(patch).toEqual({ cnpjTomadorCte: CLIENTE, cteToma: '3' });
        expect(patchDoCabecalhoCte({ ...gravado, cnpjTomadorCte: CLIENTE }, lerCabecalhoCte(xmlCte('0')))).toEqual({});
        expect(classificarCteParaCabecalho({ ...gravado, cnpjTomadorCte: CLIENTE })).toBe('completo');
    });
});

const cte = (extra: Record<string, unknown> = {}) => ({
    id: 'c1', tipoDoc: 'CTe', tipo: 'CTe', chave: '35260844555666000177570010000000011234567890', numero: '1',
    cnpjEmit: TRANSP, cnpjDest: CLIENTE, empresaCnpj: CASTELLANO, direcao: 'saida', status: 'autorizado', cfop: '6353',
    dhEmi: '2026-08-10', valorTotal: 500, totais: { vBC: 500, vICMS: 60 }, ...extra,
});

describe('o papel da empresa decide direção e escrituração', () => {
    it('tomadora → entrada; transportadora → saída; terceiro → fora; sem tomador → entra, dito', () => {
        expect(papelDaEmpresaNoCte(cte({ cnpjTomadorCte: CASTELLANO }), CASTELLANO)).toBe('tomador');
        expect(direcaoDoCte(cte({ cnpjTomadorCte: CASTELLANO }), CASTELLANO)).toBe('entrada');
        expect(papelDaEmpresaNoCte(cte({ cnpjTomadorCte: CLIENTE }), TRANSP)).toBe('emitente');
        expect(direcaoDoCte(cte({ cnpjTomadorCte: CLIENTE }), TRANSP)).toBe('saida');
        const terceiro = cteEntraNaEscrituracao(cte({ cnpjTomadorCte: CLIENTE }), CASTELLANO);
        expect(terceiro).toMatchObject({ entra: false, papel: 'terceiro' });
        const sem = cteEntraNaEscrituracao(cte(), CASTELLANO);
        expect(sem).toMatchObject({ entra: true, papel: 'sem-tomador' });
        expect(cteEntraNaEscrituracao({ tipo: 'NFe', chave: '35260800000000000000550010000000011000000011' }, CASTELLANO)).toMatchObject({ entra: true, papel: 'nao-cte' });
        expect(ehCteDoc({ chave: '35260844555666000177670010000000011234567890' })).toBe(true);
    });

    it('a régua ÚNICA da direção (direcaoEfetivaDoc) responde pelo papel — o campo gravado "saida" não vale', () => {
        expect(direcaoEfetivaDoc(cte({ cnpjTomadorCte: CASTELLANO }) as any)).toBe('entrada');
        expect(direcaoEfetivaDoc(cte({ cnpjTomadorCte: CLIENTE, direcao: 'entrada' }) as any)).toBe('entrada'); // terceiro: sem afirmar, fica o gravado
        expect(direcaoEfetivaDoc(cte({ empresaCnpj: TRANSP, cnpjTomadorCte: CLIENTE, direcao: 'entrada' }) as any)).toBe('saida');
    });

    it('selecionarCtes: terceiro sai NOMEADO, sem-tomador entra NOMEADO, tomador entra em silêncio', () => {
        const sel = selecionarCtes([
            cte({ id: 'a', numero: '10', cnpjTomadorCte: CASTELLANO }),
            cte({ id: 'b', numero: '11', cnpjTomadorCte: CLIENTE }),
            cte({ id: 'c', numero: '12' }),
            { id: 'n', tipo: 'NFe', chave: '35260800000000000000550010000000011000000011' },
        ], CASTELLANO);
        expect(sel.notas.map((n: any) => n.id)).toEqual(['a', 'c']);
        expect(sel.foraTerceiro).toEqual(['11']);
        expect(sel.semTomador).toEqual(['12']);
        const avisos = avisosDosCtes(sel);
        expect(avisos).toHaveLength(2);
        expect(avisos[0]).toContain('NÃO é a tomadora');
        expect(avisos[1]).toContain('Reler cabeçalho');
        expect(avisosDosCtes({ foraTerceiro: [], semTomador: [] })).toEqual([]);
    });
});

describe('os dois SPEDs passam pela régua', () => {
    const notas = [cte({ id: 'a', cnpjTomadorCte: CASTELLANO }), cte({ id: 'b', chave: '35260844555666000177570010000000021234567890', numero: '2', cnpjTomadorCte: CLIENTE })];

    it('selecionarCtesBlocoD tira o CT-e de terceiro; sem CNPJ nenhum (nem no documento), entra tudo como antes', () => {
        expect(selecionarCtesBlocoD(notas, CASTELLANO).map((n: any) => n.id)).toEqual(['a']);
        // Sem a empresa na chamada, o `empresaCnpj` do próprio documento responde (a mesma régua da direção).
        expect(selecionarCtesBlocoD(notas).map((n: any) => n.id)).toEqual(['a']);
        const semDono = notas.map((n) => ({ ...n, empresaCnpj: '' }));
        expect(selecionarCtesBlocoD(semDono).map((n: any) => n.id)).toEqual(['a', 'b']);
        const com = selecionarCtesBlocoDComAvisos(notas, CASTELLANO);
        expect(com.notas.map((n: any) => n.id)).toEqual(['a']);
        expect(com.avisos[0]).toContain('nº 2');
    });

    it('o 0150 do ICMS/IPI não cadastra o participante de um CT-e que ficou fora', () => {
        const esc = documentosEscrituradosNoFiscal(notas, CASTELLANO);
        expect(esc.escriturado(notas[0])).toBe(true);
        expect(esc.escriturado(notas[1])).toBe(false);
    });

    it('bloco D do ICMS/IPI e do Contribuições recebem a empresa e empilham o aviso', () => {
        const fiscal = readFileSync(join(RAIZ, 'sefaz-backend/sped-fiscal-blocoD.js'), 'utf8');
        const contrib = readFileSync(join(RAIZ, 'sefaz-backend/sped-contrib-blocos.js'), 'utf8');
        expect(fiscal).toContain('selecionarCtesBlocoDComAvisos(');
        expect(fiscal).toMatch(/filtrarNotasBlocoD\(dados\.notas,\s*dados\.empresa\?\.cnpj/);
        expect(contrib).toMatch(/selecionarCtesBlocoDComAvisos\(dados\.notas,\s*dados\.empresa\?\.cnpj\)/);
    });
});

describe('a tela: Livro, ✏️ CFOP por nota e Resumo por CFOP passam pela régua; a captura grava o tomador', () => {
    it('os três recortes dos Relatórios filtram pelo papel da empresa', () => {
        const src = readFileSync(join(RAIZ, 'components/Relatorios/index.tsx'), 'utf8');
        const usos = src.match(/cteDaEmpresa\(d, empresa\.cnpj\)/g) || [];
        expect(usos.length).toBeGreaterThanOrEqual(3);
        expect(src).toContain('cteEntraNaEscrituracao(');
    });

    it('o importador grava cnpjTomadorCte/cteToma e decide a direção do CT-e pelo papel', () => {
        const src = readFileSync(join(RAIZ, 'sefaz-backend/xml-importer.js'), 'utf8');
        expect(src).toContain('cnpjTomadorCte: meta.cnpjTomadorCte');
        expect(src).toContain('direcaoDoCte(');
    });
});
