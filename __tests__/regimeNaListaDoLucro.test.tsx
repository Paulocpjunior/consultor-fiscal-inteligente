/**
 * 🚨 A COLUNA ESCREVIA "Presumido" SOBRE UMA COMUNIDADE IMUNE.
 *
 * 28/08, Paulo, com o print da COMUNIDADE EVANGELICA DE PASSOS: *"mesmo
 * atualizando o cadastro delas como IMUNE, o regime padrão delas continua como
 * PRESUMIDO"*. A lista fazia `emp.regimePadrao || 'Presumido'` — campo antigo
 * vazio virava **AFIRMAÇÃO** de um regime que ninguém escolheu.
 *
 * É a armadilha das duas formas: o modal grava `dadosFiscais.regimeTributario`
 * (o campo com dono e vocabulário próprios, 18/08) e a coluna lia `regimePadrao`.
 * Por dentro o app já estava certo — quem mentia era a tela.
 *
 * 📌 E a prova é por RENDER (a régua de 20/08): varredura de fonte prova o
 * CÓDIGO, não a TELA.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import ListView from '../components/LucroPresumidoReal/ListView';

// ⚠️ O mock é do AMBIENTE (Firebase), não da lógica sob teste: `firebaseConfig`
// usa `import.meta` e não carrega no jest, e ele entra na árvore pelo modal do
// Lote DARE. A ListView renderizada é a de verdade — mockar o componente seria
// provar o mock.
jest.mock('../services/firebaseConfig', () => ({
    db: {}, auth: {}, isFirebaseConfigured: false, storage: {}, app: {},
}));

const admin: any = { uid: 'u1', email: 'a@x.com', role: 'admin' };

const empresa = (over: any = {}) => ({
    id: 'e1', nome: 'COMUNIDADE EVANGELICA DE PASSOS', cnpj: '64480627000170',
    uf: 'SP', regimePadrao: null, codCliente: null, fichas: 0, capturarSefaz: true,
    ...over,
});

const montar = (emps: any[]) => render(
    <ListView
        empresas={emps as any}
        currentUser={admin}
        onAbrir={() => {}}
        onExcluir={() => {}}
        onNovaEmpresa={() => {}}
        onMesclado={() => {}}
    />,
);

describe('🚨 a coluna do regime', () => {
    it('entidade IMUNE aparece como Imune — não como Presumido', () => {
        montar([empresa({
            regime: { codigo: 'IMUNE', rotulo: 'Imune', origem: 'cadastro', apuracaoDefinida: true },
        })]);
        expect(screen.getByText('Imune')).toBeTruthy();
        expect(screen.queryByText('Presumido')).toBeNull();
    });

    // 🚨 O CORAÇÃO: campo vazio NÃO vira afirmação. "Presumido" ali era um
    // regime que ninguém escolheu, exibido com a mesma confiança do escolhido.
    it('sem regime nenhum, a tela DIZ que não foi definido', () => {
        montar([empresa({
            regime: { codigo: 'INDEFINIDO', rotulo: 'Indefinido', origem: 'colecao', apuracaoDefinida: false },
        })]);
        // ⚠️ A ÂNCORA É O SELO, não o texto da página: o título diz "Lucro
        // Presumido e Real" e está SEMPRE na tela — procurar /Presumido/ solto
        // passaria (ou falharia) sem provar nada sobre a coluna.
        expect(screen.getByText('Indefinido')).toBeTruthy();
        expect(screen.queryByText('Presumido')).toBeNull();
    });

    it('Lucro Presumido de verdade continua aparecendo', () => {
        montar([empresa({
            regime: { codigo: 'LUCRO_PRESUMIDO', rotulo: 'Lucro Presumido', origem: 'cadastro', apuracaoDefinida: true },
        })]);
        expect(screen.getByText('Lucro Presumido')).toBeTruthy();
    });

    // ⚠️ RESPOSTA ANTIGA (sem o campo novo) não pode quebrar a tela — mas
    // também não volta a inventar: vazio vira "Não definido".
    it('resposta sem o campo novo: usa o antigo, e o vazio NÃO vira Presumido', () => {
        montar([empresa({ regimePadrao: 'Real' })]);
        expect(screen.getByText('Real')).toBeTruthy();

        montar([empresa({ regimePadrao: null })]);
        expect(screen.getByText('Não definido')).toBeTruthy();
        expect(screen.queryByText('Presumido')).toBeNull();
    });

    // A origem separa o que ALGUÉM escolheu do que o app derivou — derivada não
    // se apresenta com a mesma confiança.
    it('a origem viaja no title, para quem quiser conferir', () => {
        montar([empresa({
            regime: { codigo: 'IMUNE', rotulo: 'Imune', origem: 'cadastro', apuracaoDefinida: true },
        })]);
        expect(screen.getByText('Imune').getAttribute('title')).toMatch(/Dados Fiscais/);
    });
});
