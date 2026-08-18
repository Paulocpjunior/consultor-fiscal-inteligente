/**
 * triagemTerceiroSetor — o pedido ao colaborador vira "confirme estes N".
 *
 * Paulo, 18/08: *"é uma falta grave, como um sistema de apuração e tributos não
 * tem campo de regime de tributação — o que eu tenho que pedir p colaborador?"*
 *
 * A resposta errada seria "preencham as ~390". O regime deduzido acerta na
 * esmagadora maioria; o que o app não tem como saber é quem é imune, isenta ou
 * terceiro setor — e essas são poucas.
 */
// @ts-ignore — módulo JS do backend
import {
    triarEmpresa, triarCarteira, sinaisDoNome, sinalDoCnae,
// @ts-ignore
} from '../sefaz-backend/triagem-terceiro-setor.js';

describe('sinais da razão social', () => {
    it('acha a igreja do caso real', () => {
        const s = sinaisDoNome('COMUNIDADE EVANGELICA SARA NOSSA TERRA DA ILHA DO GOVERNADOR');
        expect(s.some((x: any) => x.peso === 'forte')).toBe(true);
    });

    it('acha associação, fundação e sindicato mesmo sem acento', () => {
        for (const n of ['ASSOCIACAO DOS AMIGOS', 'FUNDAÇÃO XPTO', 'SINDICATO DOS METALURGICOS']) {
            expect(sinaisDoNome(n).some((x: any) => x.peso === 'forte')).toBe(true);
        }
    });

    it('casa por FRONTEIRA de palavra — não pega pedaço de outra', () => {
        // "IGREJINHA" não é IGREJA; "PARÓQUIAS" tampouco vira sinal solto.
        expect(sinaisDoNome('IGREJINHA COMERCIO DE DOCES')).toHaveLength(0);
    });

    it('empresa comum não gera sinal nenhum', () => {
        expect(sinaisDoNome('KROYA IMPORTADORA E DISTRIBUIDORA COMERCIAL')).toHaveLength(0);
    });
});

describe('sinal do CNAE — só o que descreve a NATUREZA da entidade', () => {
    it('organização religiosa e associativa entram', () => {
        expect(sinalDoCnae('9491-0/00')).toBeTruthy();
        expect(sinalDoCnae('94308')).toBeTruthy();
    });

    it('🚨 escola e clínica NÃO entram — dizem o que faz, não o que É', () => {
        // Há escola e hospital com fins lucrativos aos montes; usá-los encheria
        // a fila de falso positivo, que é o jeito de a equipe parar de olhá-la.
        expect(sinalDoCnae('8513-9/00')).toBeNull();   // ensino fundamental
        expect(sinalDoCnae('8610-1/01')).toBeNull();   // hospital geral
        expect(sinalDoCnae('4711-3/02')).toBeNull();   // supermercado
    });

    it('CNAE ilegível não vira sinal', () => {
        expect(sinalDoCnae('')).toBeNull();
        expect(sinalDoCnae('12')).toBeNull();
        expect(sinalDoCnae(null)).toBeNull();
    });
});

describe('🚨 a razão social diz o que a empresa É — inclusive quando NÃO é', () => {
    it('sociedade empresária é BARRADA, com a explicação', () => {
        const r = triarEmpresa({ nome: 'INSTITUTO DE BELEZA E ESTETICA LTDA' });
        expect(r.candidata).toBe(false);
        expect(r.motivo).toBe('sociedade-empresaria');
        expect(r.explicacao).toMatch(/não é entidade sem fins lucrativos/);
        // E a saída fica escrita: trava sem caminho é trava que a equipe contorna.
        expect(r.explicacao).toMatch(/marque na mão/);
    });

    it('⚠️ ME e EPP NÃO barram — são PORTE, não tipo societário', () => {
        // Régua reusada de `tipoSocietarioNoNome` (13/08). Reescrevê-la aqui
        // seria a segunda cópia de sempre.
        const r = triarEmpresa({ nome: 'ASSOCIACAO BENEFICENTE SAO JUDAS ME' });
        expect(r.candidata).toBe(true);
    });

    it('sinal FRACO sozinho não vira candidato', () => {
        const r = triarEmpresa({ nome: 'CASA DE CARNES DO ZE' });
        expect(r.candidata).toBe(false);
        expect(r.motivo).toBe('so-sinal-fraco');
    });

    it('sinal fraco ACOMPANHADO de forte vira candidato', () => {
        expect(triarEmpresa({ nome: 'INSTITUTO FUNDACAO ESPERANCA' }).candidata).toBe(true);
    });
});

describe('o caso real: a igreja do print do CCI', () => {
    const igreja = {
        id: 'x1',
        cnpj: '10639829000192',
        nome: 'COMUNIDADE EVANGELICA SARA NOSSA TERRA DA ILHA DO GOVERNADOR',
    };

    it('entra na fila a confirmar, com o motivo escrito', () => {
        const r = triarEmpresa(igreja);
        expect(r.candidata).toBe(true);
        expect(r.motivo).toBe('a-confirmar');
        expect(r.explicacao).toMatch(/SUGESTÃO, não decisão/);
    });

    it('depois de classificada, ela SAI da fila mas NÃO some', () => {
        const r = triarEmpresa({ ...igreja, regimeTributario: 'IMUNE' });
        expect(r.motivo).toBe('ja-classificada');
        expect(r.jaClassificada).toBe('IMUNE');
    });
});

describe('a fila da carteira', () => {
    const carteira = [
        { id: '1', nome: 'COMUNIDADE EVANGELICA SARA NOSSA TERRA', cnpj: '1' },
        { id: '2', nome: 'ASSOCIACAO DOS MORADORES', cnpj: '2' },
        { id: '3', nome: 'FUNDACAO CULTURAL', cnpj: '3', regimeTributario: 'IMUNE' },
        { id: '4', nome: 'INSTITUTO DE BELEZA LTDA', cnpj: '4' },
        { id: '5', nome: 'KROYA IMPORTADORA E DISTRIBUIDORA COMERCIAL LTDA', cnpj: '5' },
        { id: '6', nome: 'CLINICA MEDICA MANTOAN LTDA', cnpj: '6', cnae: '8630-5/03' },
    ];
    const f = triarCarteira(carteira);

    it('a fila é CURTA — é esse o ponto', () => {
        expect(f.resumo.total).toBe(6);
        expect(f.aConfirmar.map((e: any) => e.id).sort()).toEqual(['1', '2']);
    });

    it('quem já foi classificado não some — vem em jaClassificadas', () => {
        expect(f.jaClassificadas.map((e: any) => e.id)).toEqual(['3']);
    });

    it('o que a régua BARROU também aparece, com o tipo societário', () => {
        // Sem isso ninguém descobre que a régua barrou algo que era candidato.
        expect(f.barradasPorSociedade.map((e: any) => e.id)).toEqual(['4']);
        expect(f.barradasPorSociedade[0].societario).toBeTruthy();
    });

    it('empresa comum não entra em lista nenhuma', () => {
        const ids = [...f.aConfirmar, ...f.jaClassificadas, ...f.barradasPorSociedade].map((e: any) => e.id);
        expect(ids).not.toContain('5');
        expect(ids).not.toContain('6');
    });

    it('carteira vazia não explode nem inventa fila', () => {
        expect(triarCarteira([]).resumo).toMatchObject({ total: 0, aConfirmar: 0 });
        expect(triarCarteira(null as any).aConfirmar).toEqual([]);
    });

    it('a fila sai ordenada por nome — a busca aqui é visual', () => {
        const nomes = f.aConfirmar.map((e: any) => e.nome);
        expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')));
    });
});
