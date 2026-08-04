/**
 * Régua única de leitura do EMITENTE e do CFOP.
 *
 * Estes testes existem por causa de um defeito que já mordeu três vezes: a
 * CAPTURA grava campos achatados (cnpjEmit/ufEmit), a IMPORTAÇÃO por XML monta
 * objetos (emitente.cnpjCpf/uf). Quem lê só uma das formas descarta metade da
 * base EM SILÊNCIO — e "0 resultados" parece "não tem nada".
 *
 * Caso 04/08 (SAINT PATRICK): NF 110497, RJ→SP, CFOP 6101, capturada da SEFAZ.
 * O painel de DIFAL dizia "0 cliente(s) com compra interestadual" com a nota
 * aberta na tela do lado.
 */
import {
    cnpjEmitente, nomeEmitente, ufEmitente, modeloDoDoc,
    cfopNaOticaDeEntrada, ufDoMunicipioIBGE,
} from '../sefaz-backend/participante-doc-helper.js';

const CHAVE_RJ = '33260608825779000196550010001104971117647682';

describe('cnpjEmitente / nomeEmitente', () => {
    it('lê o objeto (importação por XML)', () => {
        expect(cnpjEmitente({ emitente: { cnpjCpf: '08.825.779/0001-96' } })).toBe('08825779000196');
        expect(nomeEmitente({ emitente: { nome: 'CMC INDUSTRIA' } })).toBe('CMC INDUSTRIA');
    });

    it('lê o campo achatado (captura SEFAZ) — era o que sumia', () => {
        expect(cnpjEmitente({ cnpjEmit: '08825779000196' })).toBe('08825779000196');
        expect(nomeEmitente({ xNomeEmit: 'CMC INDUSTRIA' })).toBe('CMC INDUSTRIA');
    });

    it('sem nenhuma das formas devolve vazio (não inventa)', () => {
        expect(cnpjEmitente({})).toBe('');
        expect(nomeEmitente({})).toBe('');
    });
});

describe('ufEmitente', () => {
    it('objeto vence', () => {
        expect(ufEmitente({ emitente: { uf: 'mg' }, ufEmit: 'SP', chave: CHAVE_RJ })).toBe('MG');
    });

    it('campo achatado vem depois', () => {
        expect(ufEmitente({ ufEmit: 'SP', chave: CHAVE_RJ })).toBe('SP');
    });

    it('deriva do município IBGE quando só ele existe', () => {
        expect(ufEmitente({ codMunEmit: '3106200' })).toBe('MG');
    });

    it('CAI NA CHAVE — o caso real: nada cadastrado, mas o cUF diz RJ', () => {
        expect(ufEmitente({ chave: CHAVE_RJ })).toBe('RJ');
    });

    it('sem chave e sem cadastro, devolve vazio', () => {
        expect(ufEmitente({})).toBe('');
    });
});

describe('modeloDoDoc', () => {
    it('usa a chave quando o campo não veio (posições 21-22)', () => {
        expect(modeloDoDoc({ chave: CHAVE_RJ })).toBe('55');
    });

    it('campo explícito vence', () => {
        expect(modeloDoDoc({ modelo: '65', chave: CHAVE_RJ })).toBe('65');
    });

    it('sem chave, NFCe cai em 65 e o resto em 55', () => {
        expect(modeloDoDoc({ tipo: 'NFCe' })).toBe('65');
        expect(modeloDoDoc({ tipo: 'NFe' })).toBe('55');
    });
});

describe('cfopNaOticaDeEntrada', () => {
    it('venda interestadual do emitente (6101) é compra interestadual (2101)', () => {
        expect(cfopNaOticaDeEntrada('6101')).toBe('2101');
    });

    it('5xxx→1xxx e 7xxx→3xxx', () => {
        expect(cfopNaOticaDeEntrada('5102')).toBe('1102');
        expect(cfopNaOticaDeEntrada('7101')).toBe('3101');
    });

    it('CFOP que já é de entrada não muda', () => {
        expect(cfopNaOticaDeEntrada('2556')).toBe('2556');
        expect(cfopNaOticaDeEntrada('1102')).toBe('1102');
    });

    it('só o 1º dígito muda — os outros três são os mesmos nas duas óticas', () => {
        expect(cfopNaOticaDeEntrada('6556')).toBe('2556');
        expect(cfopNaOticaDeEntrada('6551')).toBe('2551');
    });

    it('lixo devolve vazio', () => {
        expect(cfopNaOticaDeEntrada('')).toBe('');
        expect(cfopNaOticaDeEntrada('abc')).toBe('');
        expect(cfopNaOticaDeEntrada('61')).toBe('');
    });
});

describe('ufDoMunicipioIBGE', () => {
    it('7 dígitos → sigla; qualquer outra coisa → vazio', () => {
        expect(ufDoMunicipioIBGE('3550308')).toBe('SP');
        expect(ufDoMunicipioIBGE('123')).toBe('');
        expect(ufDoMunicipioIBGE(null)).toBe('');
    });
});
