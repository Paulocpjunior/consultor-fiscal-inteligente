// ============================================================================
// 🏭 A TELA DO BLOCO K SE PROVA POR RENDER — clicando.
//
// 29/08. O bloco K é o segundo lugar deste app onde a quantidade NÃO sai das
// notas (o primeiro foi o inventário, 06/08). Sem esta tela, a única saída
// possível seria o gerador montar K200 com zero para todos os itens — e o
// arquivo sairia declarando ao Fisco que a empresa não produziu e não tem
// estoque.
//
// 📌 REGRA QUE FICA (20/08, o campo do cérebro do CFOP): varredura de fonte
// prova o CÓDIGO, nunca a TELA. Aqui o teste monta, clica e lê o que aparece.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import BlocoK from '../components/SpedFiscal/BlocoK';

// A empresa é a ATIVA da sessão — o painel não pergunta de novo (15/08).
jest.mock('../services/empresaAtivaContext', () => ({
    useEmpresaAtivaId: () => 'emp-1',
}));
jest.mock('../components/EmpresaAtivaFixa', () => ({
    __esModule: true, default: () => <div>EMPRESA ATIVA</div>,
}));

const montar = () => render(<BlocoK currentUser={null} empresas={[]} onShowToast={jest.fn()} />);

describe('🏭 a tela diz o que faz antes de qualquer clique', () => {
    it('DIZ que linha sem quantidade não vira zero — e por quê', () => {
        montar();
        const txt = document.body.textContent || '';
        expect(txt).toMatch(/fica de fora do arquivo/i);
        expect(txt).toMatch(/nunca vira zero/i);
        expect(txt).toMatch(/não produziu e não tem estoque/i);
    });

    // ⚠️ Quem decide a entrega e o leiaute é o CADASTRO — a tela não escolhe,
    // e precisa dizer ONDE se escolhe, senão a pessoa procura aqui.
    it('aponta o lugar de marcar a entrega e o leiaute', () => {
        montar();
        expect(document.body.textContent || '').toMatch(/Dados Fiscais/);
    });

    it('diz que o optante do Simples é dispensado', () => {
        montar();
        expect(document.body.textContent || '').toMatch(/Simples Nacional é.{0,3}dispensado/i);
    });

    // 🚨 O estado vazio não pode parecer "está tudo certo": sem apontamento o
    // bloco sai vazio, e isso é DE PROPÓSITO — a frase diz as duas coisas.
    it('sem apontamento gravado, avisa que o bloco sai VAZIO', () => {
        montar();
        expect(document.body.textContent || '').toMatch(/bloco K sai vazio/i);
    });
});

describe('🏭 a entrada de estoque (K200) funciona clicando', () => {
    it('adiciona a linha e ela nasce SEM quantidade', () => {
        montar();
        fireEvent.click(screen.getByText('+ Linha de estoque'));
        expect(screen.getByPlaceholderText('cód. do 0200')).toBeTruthy();
        expect(document.body.textContent || '').toMatch(/0<\/strong> de 1 linha|0 de 1 linha/);
    });

    // 📖 K200 campo 06: COD_PART é obrigatório quando IND_EST é 1 ou 2 — e a
    // tela COBRA isso antes de gravar, com a causa escrita.
    it('estoque de terceiro cobra o participante na tela', () => {
        montar();
        fireEvent.click(screen.getByText('+ Linha de estoque'));
        const sel = document.querySelector('select') as HTMLSelectElement;
        fireEvent.change(sel, { target: { value: '2' } });
        expect(document.body.textContent || '').toMatch(/exige o participante \(COD_PART/);
    });

    it('estoque próprio não cobra participante', () => {
        montar();
        fireEvent.click(screen.getByText('+ Linha de estoque'));
        expect(document.body.textContent || '').not.toMatch(/exige o participante/);
    });
});

describe('🏭 a entrada de produção (K230/K235) funciona clicando', () => {
    it('adiciona a ordem e permite acrescentar insumo', () => {
        montar();
        fireEvent.click(screen.getByText('+ Ordem de produção'));
        expect(screen.getByText('+ Insumo')).toBeTruthy();
        fireEvent.click(screen.getByText('+ Insumo'));
        expect(screen.getByPlaceholderText('cód. do insumo')).toBeTruthy();
    });

    // ⚠️ O K235 só existe no leiaute COMPLETO — a tela diz, senão quem aponta
    // insumo no simplificado acha que ele vai ao arquivo.
    it('diz que o insumo só entra no leiaute completo', () => {
        montar();
        fireEvent.click(screen.getByText('+ Ordem de produção'));
        expect(document.body.textContent || '').toMatch(/só no leiaute.{0,20}completo/i);
    });
});

describe('🚨 o aviso do que ficará de fora aparece assim que a linha nasce', () => {
    it('linha sem quantidade acende o aviso, com o número', () => {
        montar();
        fireEvent.click(screen.getByText('+ Linha de estoque'));
        fireEvent.click(screen.getByText('+ Ordem de produção'));
        const txt = document.body.textContent || '';
        expect(txt).toMatch(/2 linha\(s\) sem quantidade/);
        expect(txt).toMatch(/não serão gravadas/);
    });
});
