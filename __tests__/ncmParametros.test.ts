/**
 * Cadastro de NCM — parâmetros fiscais por mercadoria.
 *
 * Paulo, 04/08: "o que nós não temos e devemos implementar: um cadastro de
 * NCM, para melhor consulta e parâmetro de impostos e ST".
 *
 * O que estes testes protegem, em ordem de gravidade:
 *  1. VIGÊNCIA — o IVA-ST vem de Portaria CAT e muda. Aplicar o índice de hoje
 *     numa nota antiga recolhe errado, e o erro só aparece na fiscalização.
 *  2. O cadastro SUGERE — o que o humano digitou sempre vence.
 *  3. Campo vazio NÃO vira zero: fica pendente.
 */
import {
    normalizarNcm, ncmCasa, validarParametroNcm, vigenteEm,
    resolverParametrosNcm, sugerirIvaPorItem, docIdParametro,
} from '../sefaz-backend/ncm-parametros.js';

const AUTOPECA = {
    ncm: '87089990', uf: 'SP', descricao: 'Partes e acessórios de veículos',
    cest: '0106000', aliqInterna: 18, ivaSt: 71.78, portariaIvaSt: 'CAT 26/2025',
    temSt: true, vigenciaInicio: '2026-01-01',
};

describe('normalizarNcm', () => {
    it('aceita com ponto e espaço; devolve 8 dígitos', () => {
        expect(normalizarNcm('8708.99.90')).toBe('87089990');
        expect(normalizarNcm(' 87089990 ')).toBe('87089990');
    });

    it('recusa o que não tem 8 dígitos', () => {
        expect(normalizarNcm('8708')).toBe('');
        expect(normalizarNcm('')).toBe('');
        expect(normalizarNcm(null)).toBe('');
    });
});

describe('ncmCasa — a regra pode valer para a posição inteira', () => {
    it('8 dígitos casa exato', () => {
        expect(ncmCasa('87089990', '87089990')).toBe(true);
        expect(ncmCasa('87089991', '87089990')).toBe(false);
    });

    it('cadastro de 4 ou 6 dígitos casa por prefixo', () => {
        expect(ncmCasa('87089990', '8708')).toBe(true);
        expect(ncmCasa('87089990', '870899')).toBe(true);
        expect(ncmCasa('84834090', '8708')).toBe(false);
    });
});

describe('validarParametroNcm', () => {
    it('aceita um cadastro completo', () => {
        expect(validarParametroNcm(AUTOPECA).ok).toBe(true);
    });

    it('RECUSA IVA-ST sem a Portaria — índice órfão não se confere depois', () => {
        const r = validarParametroNcm({ ...AUTOPECA, portariaIvaSt: '' });
        expect(r.ok).toBe(false);
        expect(r.erros.join(' ')).toMatch(/Portaria CAT/);
    });

    it('RECUSA alíquota interna fora da faixa', () => {
        expect(validarParametroNcm({ ...AUTOPECA, aliqInterna: 80 }).ok).toBe(false);
        expect(validarParametroNcm({ ...AUTOPECA, aliqInterna: -1 }).ok).toBe(false);
    });

    it('aceita alíquota interna ZERO (cesta básica existe)', () => {
        expect(validarParametroNcm({ ...AUTOPECA, aliqInterna: 0 }).ok).toBe(true);
    });

    it('RECUSA vigência final anterior à inicial', () => {
        const r = validarParametroNcm({
            ...AUTOPECA, vigenciaInicio: '2026-06-01', vigenciaFim: '2026-01-01',
        });
        expect(r.ok).toBe(false);
        expect(r.erros.join(' ')).toMatch(/anterior à inicial/);
    });

    it('aceita cadastro só de consulta (sem IVA-ST, sem alíquota)', () => {
        expect(validarParametroNcm({ ncm: '87089990', descricao: 'Autopeça' }).ok).toBe(true);
    });
});

describe('vigência — o ponto mais perigoso', () => {
    const antigo = { ...AUTOPECA, ivaSt: 40, vigenciaInicio: '2025-01-01', vigenciaFim: '2025-12-31' };
    const atual = { ...AUTOPECA, ivaSt: 71.78, vigenciaInicio: '2026-01-01' };

    it('nota de 2025 pega o índice de 2025, não o de hoje', () => {
        const r = resolverParametrosNcm('87089990', [antigo, atual], { uf: 'SP', dataRef: '2025-06-15' });
        expect(r.ivaSt).toBe(40);
    });

    it('nota de 2026 pega o índice novo', () => {
        const r = resolverParametrosNcm('87089990', [antigo, atual], { uf: 'SP', dataRef: '2026-06-17' });
        expect(r.ivaSt).toBe(71.78);
    });

    it('data fora de QUALQUER vigência não devolve palpite — explica o buraco', () => {
        const r = resolverParametrosNcm('87089990', [atual], { uf: 'SP', dataRef: '2024-03-01' });
        expect(r.achou).toBe(false);
        expect(r.ivaSt).toBeNull();
        expect(r.motivo).toMatch(/nenhum parâmetro vigia/);
        expect(r.motivo).toMatch(/Portaria CAT muda/);
    });

    it('vigenteEm sem data de referência não filtra nada', () => {
        expect(vigenteEm(antigo, '')).toBe(true);
    });
});

describe('resolverParametrosNcm', () => {
    it('o mais ESPECÍFICO vence a posição genérica', () => {
        const generico = { ncm: '8708', ivaSt: 30, portariaIvaSt: 'CAT 01/2026' };
        const r = resolverParametrosNcm('87089990', [generico, AUTOPECA], { uf: 'SP' });
        expect(r.ncmCadastrado).toBe('87089990');
        expect(r.ivaSt).toBe(71.78);
    });

    it('parâmetro de outra UF não é usado', () => {
        const doRj = { ...AUTOPECA, uf: 'RJ', ivaSt: 50 };
        const r = resolverParametrosNcm('87089990', [doRj], { uf: 'SP' });
        expect(r.achou).toBe(false);
    });

    it('parâmetro SEM UF vale para qualquer estado', () => {
        const geral = { ncm: '87089990', ivaSt: 55, portariaIvaSt: 'CAT 02/2026' };
        expect(resolverParametrosNcm('87089990', [geral], { uf: 'SP' }).ivaSt).toBe(55);
        expect(resolverParametrosNcm('87089990', [geral], { uf: 'MG' }).ivaSt).toBe(55);
    });

    it('NCM fora do cadastro diz isso — não devolve zero', () => {
        const r = resolverParametrosNcm('84834090', [AUTOPECA], { uf: 'SP' });
        expect(r.achou).toBe(false);
        expect(r.ivaSt).toBeNull();
        expect(r.aliqInterna).toBeNull();
        expect(r.motivo).toMatch(/não está no cadastro/);
    });

    it('item sem NCM avisa em vez de quebrar', () => {
        expect(resolverParametrosNcm('', [AUTOPECA]).motivo).toMatch(/sem NCM/);
    });

    it('campo em branco continua NULO — não vira zero', () => {
        const soDescricao = { ncm: '87089990', descricao: 'Autopeça' };
        const r = resolverParametrosNcm('87089990', [soDescricao], { uf: 'SP' });
        expect(r.achou).toBe(true);
        expect(r.ivaSt).toBeNull();
        expect(r.aliqInterna).toBeNull();
        expect(r.descricao).toBe('Autopeça');
    });
});

describe('sugerirIvaPorItem — o cadastro sugere, o humano decide', () => {
    const documentos = [{
        chave: 'CH1', dhEmi: '2026-06-17T15:50:57', ufDestino: 'SP',
        itens: [
            { nItem: '2', ncm: '87089990' },
            { nItem: '3', ncm: '84834090' },   // fora do cadastro
        ],
    }];

    it('preenche o item que está no cadastro e deixa o outro pendente', () => {
        const { sugerido, usados } = sugerirIvaPorItem(documentos, [AUTOPECA]);
        expect(sugerido['CH1|2']).toMatchObject({ ivaSt: 71.78, _origem: 'cadastro-ncm' });
        expect(sugerido['CH1|3']).toBeUndefined();
        expect(usados).toHaveLength(1);
    });

    it('NÃO sobrescreve o que o colaborador digitou', () => {
        const { sugerido } = sugerirIvaPorItem(documentos, [AUTOPECA], {
            'CH1|2': { ivaSt: 55 },
        });
        expect(sugerido['CH1|2']).toBeUndefined();
    });

    it('carimba a portaria de onde veio o índice', () => {
        const { sugerido } = sugerirIvaPorItem(documentos, [AUTOPECA]);
        expect(sugerido['CH1|2']._portaria).toBe('CAT 26/2025');
    });

    it('usa a vigência da DATA DA NOTA, não a de hoje', () => {
        const antigo = { ...AUTOPECA, ivaSt: 40, vigenciaInicio: '2025-01-01', vigenciaFim: '2025-12-31' };
        const docs2025 = [{ ...documentos[0], dhEmi: '2025-08-10T10:00:00' }];
        const { sugerido } = sugerirIvaPorItem(docs2025, [antigo, AUTOPECA]);
        expect(sugerido['CH1|2'].ivaSt).toBe(40);
    });
});

describe('docIdParametro', () => {
    it('é estável e separa UF e vigência', () => {
        expect(docIdParametro(AUTOPECA)).toBe('87089990_SP_2026-01-01');
    });

    it('sem UF cai em BR', () => {
        expect(docIdParametro({ ncm: '87089990', vigenciaInicio: '2026-01-01' }))
            .toBe('87089990_BR_2026-01-01');
    });
});
