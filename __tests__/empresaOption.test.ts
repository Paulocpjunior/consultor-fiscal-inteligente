/**
 * A MESMA empresa, na forma que o seletor entende.
 *
 * O que impedia reaproveitar o EmpresaSearchSelect nas outras telas não era o
 * componente — era a FORMA: cada tela guarda a empresa do jeito da coleção
 * dela. Sem um lugar só pra isso, cada tela reescreveria o mesmo `map` e a
 * próxima esqueceria o `codCliente`, que é justamente por onde a equipe
 * procura ("587" acha mais rápido que digitar o nome).
 */
import { paraEmpresaOption, paraEmpresaOptions, codClienteDe } from '../services/empresaOption';

describe('nome vem do campo que existir, na ordem de confiança', () => {
    it('usa `nome` quando há', () => {
        expect(paraEmpresaOption({ id: '1', nome: 'ALFA LTDA', razaoSocial: 'OUTRO' }).nome).toBe('ALFA LTDA');
    });

    it('cai em razaoSocial e depois em fantasia', () => {
        expect(paraEmpresaOption({ id: '1', razaoSocial: 'BETA SA' }).nome).toBe('BETA SA');
        expect(paraEmpresaOption({ id: '1', fantasia: 'GAMA' }).nome).toBe('GAMA');
    });

    it('sem nome nenhum devolve VAZIO, não um traço', () => {
        // "—" no lugar do nome faria a busca por nome casar com todo mundo.
        expect(paraEmpresaOption({ id: '1' }).nome).toBe('');
    });
});

describe('Cod.Cliente — é por ele que a equipe procura', () => {
    it('canônico em dadosFiscais', () => {
        expect(codClienteDe({ dadosFiscais: { codCliente: '0587' } })).toBe('0587');
    });

    it('fallback top-level legado', () => {
        expect(codClienteDe({ codCliente: '0123' })).toBe('0123');
    });

    it('dadosFiscais vence o legado quando os dois existem', () => {
        expect(codClienteDe({ codCliente: 'velho', dadosFiscais: { codCliente: '0587' } })).toBe('0587');
    });

    it('ausente é undefined — não vira string vazia que o seletor mostraria', () => {
        expect(codClienteDe({})).toBeUndefined();
        expect(codClienteDe({ codCliente: '   ' })).toBeUndefined();
        expect(codClienteDe(null)).toBeUndefined();
    });

    it('a string "undefined" que às vezes chega do banco não vira código', () => {
        expect(codClienteDe({ codCliente: 'undefined' })).toBeUndefined();
    });
});

describe('regime (fonte) aceita os nomes que as telas usam', () => {
    it('lê de `fonte`, `regime` ou `tipoRegime`', () => {
        expect(paraEmpresaOption({ id: '1', fonte: 'simples' }).fonte).toBe('simples');
        expect(paraEmpresaOption({ id: '1', regime: 'Simples Nacional' }).fonte).toBe('simples');
        expect(paraEmpresaOption({ id: '1', tipoRegime: 'Lucro Presumido' }).fonte).toBe('lucro');
    });

    it('a tela que já sabe o regime manda, quando o objeto não diz', () => {
        expect(paraEmpresaOption({ id: '1' }, 'simples').fonte).toBe('simples');
    });

    it('o que o objeto diz vence o padrão da tela', () => {
        expect(paraEmpresaOption({ id: '1', regime: 'lucro' }, 'simples').fonte).toBe('lucro');
    });
});

describe('id e CNPJ', () => {
    it('id aceita os apelidos que as telas usam', () => {
        expect(paraEmpresaOption({ empresaId: 'e9' }).id).toBe('e9');
        expect(paraEmpresaOption({ docId: 'd7' }).id).toBe('d7');
    });

    it('CNPJ sai como veio — a formatação é do componente, não daqui', () => {
        expect(paraEmpresaOption({ id: '1', cnpj: '11.111.111/0001-91' }).cnpj).toBe('11.111.111/0001-91');
    });
});

describe('a lista NÃO filtra nem reordena', () => {
    it('empresa com cadastro torto continua na lista', () => {
        // Sumir do seletor é pior que aparecer torta: o colaborador conclui
        // que a empresa não existe. Cadastro torto é alerta na tela de
        // cadastro, não desaparecimento aqui.
        const r = paraEmpresaOptions([{ id: '1' }, { id: '2', nome: 'OK', cnpj: '1' }]);
        expect(r).toHaveLength(2);
    });

    it('mantém a ordem de quem chamou', () => {
        const r = paraEmpresaOptions([{ id: 'z', nome: 'ZETA' }, { id: 'a', nome: 'ALFA' }]);
        expect(r.map((e) => e.id)).toEqual(['z', 'a']);
    });

    it('lista vazia ou nula não quebra', () => {
        expect(paraEmpresaOptions(null)).toEqual([]);
        expect(paraEmpresaOptions([])).toEqual([]);
    });

    it('descarta buraco na lista sem descartar empresa', () => {
        expect(paraEmpresaOptions([null as any, { id: '1', nome: 'A' }])).toHaveLength(1);
    });
});
