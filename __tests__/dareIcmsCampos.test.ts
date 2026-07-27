/**
 * Campos linha06/linha08 da Web API DARE-ICMS (credenciamento 27/07/2026).
 * As exigências vieram do material oficial da SEFAZ-SP; mandar o DARE sem o
 * campo obrigatório volta erro do gateway — validar antes poupa a chamada e
 * diz ao operador exatamente o que preencher.
 */
// @ts-expect-error — módulo .js puro
import { validarCamposExtra, exigenciasDoServico, normalizarCodigoServico } from '../sefaz-backend/dare-icms-campos.js';

describe('normalizarCodigoServico', () => {
    it('completa com zero à esquerda (4601 → 04601) e preserva o FECOEP 1044', () => {
        expect(normalizarCodigoServico('4601')).toBe('04601');
        expect(normalizarCodigoServico('04601')).toBe('04601');
        expect(normalizarCodigoServico('1044')).toBe('1044');
        expect(normalizarCodigoServico('')).toBe('');
    });
});

describe('serviços SEM campo extra (os do dia a dia: RPA, ST, DIFAL)', () => {
    it('04601 não exige nada', () => {
        expect(exigenciasDoServico('04601')).toEqual({});
        expect(validarCamposExtra({ codigoServico: '04601' }).ok).toBe(true);
    });

    it('recusa campo enviado a mais (ruído que o gateway pode rejeitar)', () => {
        const r = validarCamposExtra({ codigoServico: '04601', linha06: '12345' });
        expect(r.ok).toBe(false);
        expect(r.erros[0]).toMatch(/não usa o campo linha06/);
    });
});

describe('parcelamento (08101 e FECOEP 1044) — linha08 com 9 dígitos', () => {
    it('aceita nove dígitos', () => {
        const r = validarCamposExtra({ codigoServico: '08101', linha08: '123456789' });
        expect(r.ok).toBe(true);
        expect(r.campos).toEqual({ linha08: '123456789' });
    });

    it('cobra o campo quando falta, dizendo o formato', () => {
        const r = validarCamposExtra({ codigoServico: '1044' });
        expect(r.ok).toBe(false);
        expect(r.erros[0]).toMatch(/Nº do Parcelamento/);
        expect(r.erros[0]).toMatch(/nove dígitos/);
    });

    it('recusa tamanho errado ou com letras', () => {
        expect(validarCamposExtra({ codigoServico: '08101', linha08: '12345' }).ok).toBe(false);
        expect(validarCamposExtra({ codigoServico: '08101', linha08: '12345678A' }).ok).toBe(false);
    });
});

describe('leilão 06305 — exige Lote (linha06) E Edital (linha08)', () => {
    it('aceita os dois preenchidos', () => {
        const r = validarCamposExtra({ codigoServico: '06305', linha06: 'LOTE-01', linha08: 'Edital 123/2026' });
        expect(r.ok).toBe(true);
        expect(r.campos).toEqual({ linha06: 'LOTE-01', linha08: 'Edital 123/2026' });
    });

    it('faltando um, aponta só o que falta', () => {
        const r = validarCamposExtra({ codigoServico: '06305', linha06: 'LOTE-01' });
        expect(r.erros).toHaveLength(1);
        expect(r.erros[0]).toMatch(/Edital/);
    });

    it('recusa lote acima de 10 caracteres', () => {
        expect(validarCamposExtra({ codigoServico: '06305', linha06: 'LOTE-0123456', linha08: 'x' }).ok).toBe(false);
    });
});

describe('número da nota fiscal (24701, 04603, 14604, 06307, 06308)', () => {
    it.each(['24701', '04603', '14604', '06307', '06308'])('%s exige a NF na linha06', (servico) => {
        expect(validarCamposExtra({ codigoServico: servico }).ok).toBe(false);
        expect(validarCamposExtra({ codigoServico: servico, linha06: '1234567890' }).ok).toBe(true);
    });

    it('NF com letra é recusada (a SEFAZ exige numérico)', () => {
        const r = validarCamposExtra({ codigoServico: '24701', linha06: 'NF-123' });
        expect(r.ok).toBe(false);
        expect(r.erros[0]).toMatch(/só números/);
    });
});

describe('DIFIS 89202 — reclamação de 2 a 10 dígitos', () => {
    it('aceita dentro da faixa e recusa fora', () => {
        expect(validarCamposExtra({ codigoServico: '89202', linha06: '12' }).ok).toBe(true);
        expect(validarCamposExtra({ codigoServico: '89202', linha06: '1' }).ok).toBe(false);
        expect(validarCamposExtra({ codigoServico: '89202', linha06: '12345678901' }).ok).toBe(false);
    });
});

describe('espaços em volta não invalidam nem sujam o payload', () => {
    it('trim antes de validar e de mandar', () => {
        const r = validarCamposExtra({ codigoServico: '08101', linha08: '  123456789  ' });
        expect(r.ok).toBe(true);
        expect(r.campos.linha08).toBe('123456789');
    });
});

// ---------------------------------------------------------------------------
// Montagem do payload e tradução de erro do gateway (cliente da Web API).
// ---------------------------------------------------------------------------
// @ts-expect-error — módulo .js puro
import { montarDareApiDTO, traduzirErroDare, resolverAmbiente, AMBIENTES, extrairRecusa, resumirRetornoDare, paraDataHora } from '../sefaz-backend/dare-icms-api.js';

describe('montarDareApiDTO', () => {
    const base = { cnpj: '46.377.222/0001-21', referencia: '08/2026', valor: 1234.56, dataVencimento: '2026-08-20' };

    it('limpa o CNPJ, normaliza o serviço e não manda campo que a receita não usa', () => {
        const dto = montarDareApiDTO({ ...base, codigoServico: '4601' });
        expect(dto.cnpj).toBe('46377222000121');
        // O Swagger real não tem `codigoServico` solto: vai dentro de `receita`
        // como INTEIRO (codigoServicoDARE). Mandar solto dava 400 em tudo.
        expect(dto.codigoServico).toBeUndefined();
        expect(dto.receita).toEqual({ codigoServicoDARE: 4601 });
        expect(dto.valor).toBe(1234.56);
        expect(dto.gerarPDF).toBe(true);
        expect('linha06' in dto).toBe(false);
        expect('linha08' in dto).toBe(false);
    });

    it('inclui linha06 quando a receita exige (Nº da NF)', () => {
        const dto = montarDareApiDTO({ ...base, codigoServico: '24701', linha06: '123456' });
        expect(dto.linha06).toBe('123456');
    });

    it('recusa ANTES de gastar a chamada quando falta o campo obrigatório', () => {
        expect(() => montarDareApiDTO({ ...base, codigoServico: '08101' }))
            .toThrow(/Nº do Parcelamento/);
    });
});

describe('ambientes e tradução de erro', () => {
    it('homologação é o padrão e aponta para o gateway -hml', () => {
        expect(AMBIENTES.homologacao.baseUrl).toContain('apigateway-hml.fazenda.sp.gov.br');
        expect(AMBIENTES.producao.baseUrl).toContain('apigateway.fazenda.sp.gov.br');
        expect(resolverAmbiente('producao').nome).toBe('producao');
        expect(() => resolverAmbiente('teste')).toThrow(/Ambiente DARE inválido/);
    });

    it('erros vêm em português com a ação, sem vazar a chave', () => {
        expect(traduzirErroDare(401, 'Unauthorized')).toMatch(/recusou a chave/);
        expect(traduzirErroDare(401, 'Unauthorized')).toMatch(/homologação não vale em produção/);
        expect(traduzirErroDare(429, '')).toMatch(/Aguarde alguns minutos/);
        expect(traduzirErroDare(500, 'erro')).toMatch(/emita pelo portal DARE/);
        expect(traduzirErroDare(400, { erro: 'referencia invalida' })).toMatch(/linha06\/linha08/);
    });
});

// ---------------------------------------------------------------------------
// Contrato REAL do Swagger (conferido em 27/07/2026 com a chave de produção).
// ---------------------------------------------------------------------------
describe('formato exigido pelo Swagger', () => {
    const base = { cnpj: '46377222000121', razaoSocial: 'CLIENTE LTDA', referencia: '08/2026', valor: 100, dataVencimento: '2026-08-20' };

    it('dataVencimento vai como date-time (só a data dava 400 / fuso comia um dia)', () => {
        expect(paraDataHora('2026-08-20')).toBe('2026-08-20T00:00:00');
        expect(montarDareApiDTO({ ...base, codigoServico: '04601' }).dataVencimento).toBe('2026-08-20T00:00:00');
    });

    it('serviço vai dentro de receita, com o código de receita quando conhecido', () => {
        const dto = montarDareApiDTO({ ...base, codigoServico: '14601', codigoReceita: '146-6' });
        expect(dto.receita).toEqual({ codigoServicoDARE: 14601, codigo: '146-6' });
        expect(dto.razaoSocial).toBe('CLIENTE LTDA');
    });
});

describe('extrairRecusa — HTTP 200 NÃO significa emitido', () => {
    it('pega a recusa que vem no corpo com estaOk=false', () => {
        const r = extrairRecusa({ erro: { estaOk: false, mensagens: ['Referência inválida'] } });
        expect(r).toMatch(/A SEFAZ recusou a emissão/);
        expect(r).toMatch(/Referência inválida/);
    });

    it('pega recusa de item dentro do lote', () => {
        const r = extrairRecusa({ itensParaGeracao: [{ erro: { estaOk: false, mensagens: ['CNPJ não cadastrado'] } }] });
        expect(r).toMatch(/CNPJ não cadastrado/);
    });

    it('emissão boa não vira falso alarme', () => {
        expect(extrairRecusa({ erro: { estaOk: true, mensagens: [] }, codigoBarra44: '123' })).toBeNull();
        expect(extrairRecusa({ itensParaGeracao: [{ numeroControleDarePrincipal: 9 }] })).toBeNull();
        expect(extrairRecusa(null)).toBeNull();
    });
});

describe('resumirRetornoDare — o comprovante que vai pra auditoria', () => {
    it('extrai número, barras e Pix do item emitido', () => {
        const r = resumirRetornoDare({
            itensParaGeracao: [{
                numeroControleDarePrincipal: 230590000193959,
                codigoBarra44: '8'.repeat(44), codigoBarra48: '8'.repeat(48),
                pixCopiaCola: '00020126...', valorTotal: 123.45, valorJuros: 1.2, valorMulta: 2.3,
                documentoImpressao: 'JVBERi0=',
            }],
        });
        expect(r.numeroControle).toBe(230590000193959);
        expect(r.codigoBarra44).toHaveLength(44);
        expect(r.pixCopiaCola).toMatch(/^000201/);
        expect(r.temPdf).toBe(true);
    });
});
