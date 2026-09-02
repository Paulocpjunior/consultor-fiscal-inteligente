// ============================================================================
// 🚨 O CAMINHO QUE O APP MONTAVA NÃO EXISTIA NO SHAREPOINT
//
// 02/09, medido clique a clique. O app montava
// `Empresas/GRUPO/DEPARTAMENTO FISCAL/2026/09-2026/EMPRESA/XML SAÍDA` e o que
// existe é `Empresas/0040_Clinica Mantoan/Departamento Contábil/2026/Setembro`.
//
// Estes testes usam os nomes REAIS lidos da árvore — inventar nome de pasta
// aqui seria testar o mundo que o app imaginava, que é o defeito.
// ============================================================================
import {
    nomeDoMes, apelidosDoMes, codigoDaPasta, acharPastaDaEmpresa,
    acharPastaPorNome, caminhoFiscal, caminhoImpostos, normalizar,
} from '../sefaz-backend/caminho-sharepoint.js';

// Nomes REAIS, copiados da listagem de /Empresas do ClientesSP2.
const PASTAS_REAIS = [
    '0001_BRISKA', '0004 – AÇOUGUE YOKOAMA', '0006 – GLEICE MURAKAMI', '0007_INPLAF',
    '0019 _3D PICTURES', '0022– LOJA DO CENTRO', '0024_Lima Cabral', '0025_A Castellano',
    '0040_Clinica Mantoan', '0061– AB Promoção', '0083_Com. Evang. DF',
    '0109 – FASTWELD_ESTADO(PROVISORIO)', '0109_Fastweld', '0147_EXPERTE METAIS',
];

// Meses REAIS da pasta do Contábil de 2026 — escritos de cinco jeitos.
const MESES_REAIS = ['Abril', 'Agosto', 'Fev', 'Jan', 'Julho', 'Junho', 'Maio', 'Março',
    'Novembro', 'Out', 'Setembro'];

describe('🚨 o nome da pasta da empresa é HUMANO — não se monta, se acha', () => {
    it('o código sai do começo, com qualquer separador', () => {
        expect(codigoDaPasta('0001_BRISKA')).toBe('0001');
        expect(codigoDaPasta('0004 – AÇOUGUE YOKOAMA')).toBe('0004');
        expect(codigoDaPasta('0022– LOJA DO CENTRO')).toBe('0022');
        expect(codigoDaPasta('0019 _3D PICTURES')).toBe('0019');
    });

    // ⚠️ Pasta sem código não ganha código inventado.
    it('pasta sem código devolve null', () => {
        expect(codigoDaPasta('Departamento Contábil')).toBeNull();
        expect(codigoDaPasta('General')).toBeNull();
    });

    it('acha pela empresa do caso REAL', () => {
        const r = acharPastaDaEmpresa(PASTAS_REAIS, '0040');
        expect(r.situacao).toBe('ok');
        expect(r.pasta).toBe('0040_Clinica Mantoan');
    });

    // ⚠️ O cadastro pode ter "40" e a pasta "0040": comparar como TEXTO faria
    // a empresa "não existir".
    it('compara por NÚMERO, não por texto', () => {
        expect(acharPastaDaEmpresa(PASTAS_REAIS, '40').pasta).toBe('0040_Clinica Mantoan');
        expect(acharPastaDaEmpresa(PASTAS_REAIS, 40).pasta).toBe('0040_Clinica Mantoan');
    });

    // 🚨 O CASO REAL DA AMBIGUIDADE: 0109 aparece DUAS vezes na árvore.
    // Escolher uma calada espalharia o XML do mesmo cliente em duas pastas.
    it('dois candidatos NÃO viram escolha silenciosa', () => {
        const r = acharPastaDaEmpresa(PASTAS_REAIS, '0109');
        expect(r.situacao).toBe('ambigua');
        expect(r.pasta).toBeNull();
        expect(r.candidatas).toEqual(['0109 – FASTWELD_ESTADO(PROVISORIO)', '0109_Fastweld']);
    });

    it('código que não existe é DITO, não vira pasta nova', () => {
        expect(acharPastaDaEmpresa(PASTAS_REAIS, '9999').situacao).toBe('nao-encontrada');
        expect(acharPastaDaEmpresa(PASTAS_REAIS, '').situacao).toBe('codigo-ausente');
        expect(acharPastaDaEmpresa(PASTAS_REAIS, 'abc').situacao).toBe('codigo-ausente');
    });
});

describe('🚨 o mês é por NOME — e escrito de cinco jeitos', () => {
    it('o app grava por extenso, como a pasta vizinha', () => {
        expect(nomeDoMes('09')).toBe('Setembro');
        expect(nomeDoMes('1')).toBe('Janeiro');
        expect(nomeDoMes(12)).toBe('Dezembro');
    });

    // ⚠️ Mês fora da faixa não vira pasta chutada.
    it('mês inválido devolve null', () => {
        for (const m of ['', '0', '13', 'xx', null, undefined]) expect(nomeDoMes(m)).toBeNull();
    });

    // 🚨 A leitura tem de achar o que a EQUIPE escreveu, não só o que o app
    // grava — senão a pasta existe e o app diz que não.
    it('os apelidos cobrem as formas REAIS da árvore', () => {
        const set = (m: string) => apelidosDoMes(m, '2026');
        expect(set('01')).toContain(normalizar('Jan'));
        expect(set('02')).toContain(normalizar('Fev'));
        expect(set('03')).toContain(normalizar('Março'));
        expect(set('10')).toContain(normalizar('Out'));
        expect(set('11')).toContain(normalizar('Novembro'));
        expect(set('09')).toContain(normalizar('Setembro'));
        // e a forma que o app usava antes, para achar o que já foi criado
        expect(set('09')).toContain('09-2026');
    });

    it('acha a pasta real do mês, com a grafia DELA', () => {
        expect(acharPastaPorNome(MESES_REAIS, apelidosDoMes('10', '2026'))).toBe('Out');
        expect(acharPastaPorNome(MESES_REAIS, apelidosDoMes('03', '2026'))).toBe('Março');
        expect(acharPastaPorNome(MESES_REAIS, apelidosDoMes('09', '2026'))).toBe('Setembro');
        // Dezembro não existe na árvore de 2026 — e isso é dito com null.
        expect(acharPastaPorNome(MESES_REAIS, apelidosDoMes('12', '2026'))).toBeNull();
    });

    // ⚠️ Acento e caixa não podem separar "Março" de "MARCO".
    it('compara sem acento e sem caixa', () => {
        expect(acharPastaPorNome(['MARCO'], apelidosDoMes('03'))).toBe('MARCO');
        expect(acharPastaPorNome(['setembro'], apelidosDoMes('09'))).toBe('setembro');
    });
});

describe('🧭 o caminho do fiscal — irmão do contábil (decisão do dono, 02/09)', () => {
    it('monta a partir da pasta REAL da empresa', () => {
        expect(caminhoFiscal({ pastaEmpresa: '0040_Clinica Mantoan', ano: '2026', mes: '09' }))
            .toBe('Empresas/0040_Clinica Mantoan/Departamento Fiscal/2026/Setembro/XML SAÍDA');
        expect(caminhoFiscal({ pastaEmpresa: '0040_Clinica Mantoan', ano: '2026', mes: '09', direcao: 'ENTRADA' }))
            .toBe('Empresas/0040_Clinica Mantoan/Departamento Fiscal/2026/Setembro/XML ENTRADA');
    });

    it('a guia do rito vai no mesmo mês', () => {
        expect(caminhoImpostos({ pastaEmpresa: '0040_Clinica Mantoan', ano: '2026', mes: '09' }))
            .toBe('Empresas/0040_Clinica Mantoan/Departamento Fiscal/2026/Setembro/IMPOSTOS');
    });

    // ⚠️ Sem a pasta REAL não há caminho: montar com o nome do cadastro criaria
    // uma pasta NOVA ao lado da que existe, duplicando o cliente.
    it('sem pasta da empresa não há caminho', () => {
        expect(caminhoFiscal({ pastaEmpresa: null, ano: '2026', mes: '09' })).toBeNull();
        expect(caminhoFiscal({ pastaEmpresa: '0040_X', ano: '', mes: '09' })).toBeNull();
        expect(caminhoFiscal({ pastaEmpresa: '0040_X', ano: '2026', mes: '13' })).toBeNull();
    });

    // 🚨 O QUE O CAMINHO NOVO NÃO TEM: o nível GRUPO, que não existe na árvore.
    it('não existe nível de GRUPO', () => {
        const c = caminhoFiscal({ pastaEmpresa: '0040_Clinica Mantoan', ano: '2026', mes: '09' })!;
        expect(c.split('/')).toHaveLength(6);
        expect(c).not.toMatch(/GRUPO/i);
        expect(c).not.toMatch(/09-2026/);
    });
});
