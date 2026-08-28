/**
 * 🚪 A FILA TEM DE TER PORTA — e a porta tem de ter o NOME que a pessoa procura.
 *
 * 28/08, Paulo, com o print do menu aberto: *"não acho aonde"*. Ele procurou
 * "Cadastros" e o card se chama **Diagnóstico & Saúde** — a lista mora numa
 * sub-aba lá dentro, e navegar para `DIAGNOSTICO_CADASTROS` não renderizava
 * NADA. É a família do card CFOP (18/08): a tela existia, funcionava, e a única
 * pessoa que sabia onde era, era eu.
 *
 * 📌 E a régua de 20/08 manda provar por RENDER: varredura de fonte prova o
 * CÓDIGO, não a TELA. O atalho se prova montando e lendo em qual aba ele abriu.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MENU_GRUPOS } from '../config/menuConfig';
import { SearchType } from '../types';
import DiagnosticoHub from '../components/Diagnostico/DiagnosticoHub';

jest.mock('../services/diagnosticoCadastrosService', () => ({
    getDiagnosticoCadastros: jest.fn(async () => ({
        resumo: { total: 0, criticos: 0, altos: 0, medios: 0, ok: 0 },
        porCampo: [], empresas: [], geradoEm: '2026-08-28T00:00:00.000Z',
    })),
}));

const admin: any = { uid: 'u1', email: 'admin@x.com', role: 'admin' };

describe('🚪 o card existe no menu', () => {
    const cards = MENU_GRUPOS.flatMap((g) => g.cards);

    it('há um card chamado "Cadastros Incompletos" — o nome que a pessoa procura', () => {
        const card = cards.find((c) => c.type === SearchType.DIAGNOSTICO_CADASTROS);
        expect(card).toBeTruthy();
        expect(card!.label).toMatch(/Cadastros Incompletos/i);
    });

    // A rota é admin-only; card visível para quem levaria 403 é porta que não abre.
    it('e ele é admin-only, como a rota que o alimenta', () => {
        const card = cards.find((c) => c.type === SearchType.DIAGNOSTICO_CADASTROS);
        expect(card!.adminOnly).toBe(true);
    });

    // ⚠️ O hub CONTINUA existindo: o atalho não substitui a visão agregada.
    it('o card do hub não sumiu', () => {
        expect(cards.some((c) => c.type === SearchType.SAUDE_GERAL)).toBe(true);
    });
});

// ⚠️ O RÓTULO DA SUB-ABA também diz "Cadastros Incompletos", e ele está SEMPRE
// na tela (a barra de navegação). Procurar por ele não prova nada — quem
// distingue é o conteúdo do painel, e é por isso que a âncora é o subtítulo.
const NO_PAINEL = /campos obrigatórios faltando/i;

describe('🚪 e ele ABRE na aba certa', () => {
    it('com subInicial de cadastros, o hub nasce em Cadastros — não na Saúde Geral', async () => {
        render(<DiagnosticoHub currentUser={admin} subInicial={SearchType.DIAGNOSTICO_CADASTROS} />);
        // O painel de cadastros tem título próprio; a Saúde Geral, não.
        await waitFor(() => expect(screen.getByText(NO_PAINEL)).toBeTruthy());
    });

    // ⚠️ Sem `subInicial` nada muda: quem entra pelo card do hub continua
    // caindo na Saúde Geral, que é o comportamento de sempre.
    it('sem subInicial, abre na Saúde Geral como antes', () => {
        const { container } = render(<DiagnosticoHub currentUser={admin} />);
        expect(container.textContent).not.toMatch(NO_PAINEL);
    });

    // 🚨 O ATALHO NÃO PODE LEVAR À ABA ANTERIOR: `useState` só lê o inicial no
    // mount, e o App usa UM ramo para os dois SearchTypes — sem o efeito, trocar
    // de card deixaria o hub parado na aba de antes, que é pior que não ter
    // atalho (leva ao lugar errado com confiança).
    it('trocar o subInicial sem remontar leva à aba nova', async () => {
        const { rerender, container } = render(<DiagnosticoHub currentUser={admin} />);
        expect(container.textContent).not.toMatch(NO_PAINEL);
        rerender(<DiagnosticoHub currentUser={admin} subInicial={SearchType.DIAGNOSTICO_CADASTROS} />);
        await waitFor(() => expect(screen.getByText(NO_PAINEL)).toBeTruthy());
    });
});
