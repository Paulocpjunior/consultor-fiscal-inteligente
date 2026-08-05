/**
 * Importador do "Cadastro de Clientes/Fornecedores" do E-Fiscal (XFRX).
 *
 * Paulo, 05/08: mandou o relatório real da S&P (empresa 1200, 187
 * participantes). O parser foi validado contra ele — estes testes travam a
 * estrutura com um recorte sintético do MESMO layout.
 */
import { parsearCadastroClientesFornecedores } from '../services/efiscalCadastroParticipantesParser';

const v = (...cells: string[]) => cells;   // linha da planilha

const ARQUIVO = [
    v('', '', '', 'Office Fiscal'),
    v('Listagem do Cad. de Clientes/Fornec'),
    v('1200 - S&P ASSESSORIA CONTABIL S/S', '', '', 'Página', '1'),
    v(''),
    v('Nome:', 'AO3 TECNOLOGIA LTDA'),
    v('End.:', 'AVENIDA SELMA PARADA 201'),
    v('CNPJ:', '64.555.626/0001-47', '', 'IE:', ''),
    v('Código:', '1', 'Cliente', '', 'Fornecedor'),
    v(''),
    v('Nome:', 'PAULO CESAR PEREIRA JUNIOR'),
    v('CNPJ:', '268.190.168-59', '', 'IE:', ''),
    v('Código:', '1207', 'Cliente', 'X', 'Fornecedor'),
    v(''),
    // Cabeçalho repete a cada página — não pode virar segundo "empresa".
    v('9999 - OUTRA COISA QUE NÃO É O CABEÇALHO', '', 'Página', '2'),
    v('Nome:', 'CONDEC PROJETOS E REFORMAS LTDA ME'),
    v('CNPJ:', '00.000.509/0001-34', '', 'IE:', '000000000000'),
    v('Código:', '00000509000134', 'X', 'Cliente', 'Fornecedor'),
];

describe('parsearCadastroClientesFornecedores — o layout real do XFRX', () => {
    const r = parsearCadastroClientesFornecedores(ARQUIVO);

    it('acha o código e o nome da PRÓPRIA empresa no cabeçalho (e só o 1º)', () => {
        expect(r.empresaCodigo).toBe('1200');
        expect(r.empresaNome).toBe('S&P ASSESSORIA CONTABIL S/S');
    });

    it('extrai código + documento de cada bloco, CNPJ e CPF', () => {
        expect(r.codigos['64555626000147']).toBe('1');
        expect(r.codigos['26819016859']).toBe('1207');          // CPF (11 dígitos)
        expect(r.codigos['00000509000134']).toBe('00000509000134');
        expect(r.participantes).toHaveLength(3);
        expect(r.ignorados).toHaveLength(0);
    });
});

describe('farol honesto do importador', () => {
    it('bloco sem documento não vira mapa — vira IGNORADO com o motivo', () => {
        const r = parsearCadastroClientesFornecedores([
            v('Nome:', 'SEM DOC LTDA'),
            v('CNPJ:', '', '', 'IE:', '123'),        // CNPJ vazio; IE não é documento
            v('Código:', '77'),
        ]);
        expect(Object.keys(r.codigos)).toHaveLength(0);
        expect(r.ignorados[0].motivo).toMatch(/sem CNPJ\/CPF|fora do padrão/);
    });

    it('bloco sem código idem — participante existe lá mas não mapeia nada', () => {
        const r = parsearCadastroClientesFornecedores([
            v('Nome:', 'SEM CODIGO LTDA'),
            v('CNPJ:', '64.555.626/0001-47'),
            v('Código:', '', 'Cliente', 'X', 'Fornecedor'),   // vazio: X não é código
        ]);
        expect(Object.keys(r.codigos)).toHaveLength(0);
        expect(r.ignorados[0].motivo).toMatch(/sem código/i);
    });

    it('mesmo documento com códigos DIFERENTES é conflito — decisão humana', () => {
        const r = parsearCadastroClientesFornecedores([
            v('Nome:', 'A'), v('CNPJ:', '64.555.626/0001-47'), v('Código:', '10'),
            v('Nome:', 'B'), v('CNPJ:', '64.555.626/0001-47'), v('Código:', '20'),
        ]);
        expect(r.conflitos).toHaveLength(1);
        expect(r.conflitos[0].codigos.sort()).toEqual(['10', '20']);
        expect(r.codigos['64555626000147']).toBeUndefined();
    });

    it('mesmo documento com o MESMO código (página repetida) NÃO é conflito', () => {
        const r = parsearCadastroClientesFornecedores([
            v('Nome:', 'A'), v('CNPJ:', '64.555.626/0001-47'), v('Código:', '10'),
            v('Nome:', 'A'), v('CNPJ:', '64.555.626/0001-47'), v('Código:', '10'),
        ]);
        expect(r.conflitos).toHaveLength(0);
        expect(r.codigos['64555626000147']).toBe('10');
    });
});
