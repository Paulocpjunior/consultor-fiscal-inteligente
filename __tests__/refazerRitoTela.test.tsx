// ============================================================================
// ♻️ A PORTA DO REFAZER — provada por RENDER, clicando
//
// A lição de 20/08 (o campo do cérebro do CFOP): varredura de fonte prova o
// CÓDIGO, não a TELA. O que importa aqui é o que o dedo encontra quando a
// pendência aparece — e o que a tela DIZ antes do clique.
//
// 🚨 A frase mais importante desta tela é a que diz que **NADA é reenviado ao
// cliente**: sem ela o botão parece "mandar a guia de novo", que é exatamente
// o que ninguém pode fazer sem duplicar a cobrança.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EnviosImpostoPainel from '../components/EnviosImpostoPainel';

const painelMock = jest.fn();
const refazerMock = jest.fn();
const declararMock = jest.fn();

jest.mock('../services/envioImpostoService', () => ({
    painelEnviosImposto: (...a: any[]) => painelMock(...a),
    refazerRitoDosEnvios: (...a: any[]) => refazerMock(...a),
    declararArquivamentoDosEnvios: (...a: any[]) => declararMock(...a),
}));

/** O painel como ele volta com a pendência da VINCENZO. */
const PAINEL = {
    ok: true,
    competencia: '2026-07',
    total: 3, completos: 1, incompletos: 2,
    farol: 'atencao',
    resumo: '3 envio(s), 1 completo(s) pelo rito.',
    gestor: 'alexandre@spassessoriacontabil.com.br',
    porTipo: { DAS: 3 },
    pendencias: {
        'Empresa sem pasta do SharePoint': {
            qtd: 2,
            acao: 'Preencha grupo + pasta em Central de XMLs → Integrações → SharePoint.',
            etapa: 'sharepoint',
            empresas: ['VINCENZO GUERRA BANANAS LTDA · DAS 2026-07'],
            envioIds: ['env1', 'env2'],
        },
    },
    naoConferidos: [],
    semGestorEmCopia: [],
};

beforeEach(() => {
    jest.clearAllMocks();
    painelMock.mockResolvedValue(PAINEL);
    window.confirm = jest.fn(() => true) as any;
});

describe('♻️ a porta aparece na pendência', () => {
    it('mostra o botão com a CONTAGEM daquela causa', async () => {
        render(<EnviosImpostoPainel />);
        expect(await screen.findByText(/Refazer o rito destes 2/)).toBeTruthy();
    });

    // 🚨 A tela DIZ, antes do clique, que a guia não sai de novo.
    it('avisa que NÃO reenvia guia ao cliente, sem precisar clicar', async () => {
        const { container } = render(<EnviosImpostoPainel />);
        await screen.findByText(/Refazer o rito destes 2/);
        expect(container.textContent).toMatch(/Não reenvia guia ao cliente/);
    });

    // Causa sem ids (painel antigo, sem o campo) não ganha botão que não
    // funciona — botão que não faz nada é pior que botão nenhum.
    it('sem os ids, o botão não aparece', async () => {
        painelMock.mockResolvedValue({
            ...PAINEL,
            pendencias: { 'X': { qtd: 1, acao: 'y', empresas: ['a'] } },
        });
        const { container } = render(<EnviosImpostoPainel />);
        await screen.findByText(/1× X/);
        expect(container.textContent).not.toMatch(/Refazer o rito/);
    });
});

describe('o clique manda os ids daquela causa', () => {
    it('pergunta antes e chama com os ids', async () => {
        refazerMock.mockResolvedValue({ ok: true, total: 2, arquivados: 2, baixados: 2, semPdf: 0, falhas: 0 });
        render(<EnviosImpostoPainel />);
        fireEvent.click(await screen.findByText(/Refazer o rito destes 2/));
        expect(window.confirm).toHaveBeenCalled();
        await waitFor(() => expect(refazerMock).toHaveBeenCalledWith(['env1', 'env2']));
    });

    it('recusar a confirmação não chama nada', async () => {
        window.confirm = jest.fn(() => false) as any;
        render(<EnviosImpostoPainel />);
        fireEvent.click(await screen.findByText(/Refazer o rito destes 2/));
        expect(refazerMock).not.toHaveBeenCalled();
    });
});

describe('o resultado DIZ o que não deu', () => {
    it('mostra arquivados e baixados', async () => {
        refazerMock.mockResolvedValue({ ok: true, total: 2, arquivados: 2, baixados: 2, semPdf: 0, falhas: 0 });
        const { container } = render(<EnviosImpostoPainel />);
        fireEvent.click(await screen.findByText(/Refazer o rito destes 2/));
        await waitFor(() => expect(container.textContent).toMatch(/2 arquivado\(s\)/));
        expect(container.textContent).toMatch(/2 baixado\(s\)/);
    });

    // 🚨 "2 refeitos" sobre uma rodada em que metade falhou seria a
    // meia-verdade de sempre.
    it('falha e PDF ausente aparecem, não somem', async () => {
        refazerMock.mockResolvedValue({ ok: true, total: 2, arquivados: 0, baixados: 1, semPdf: 1, falhas: 1 });
        const { container } = render(<EnviosImpostoPainel />);
        fireEvent.click(await screen.findByText(/Refazer o rito destes 2/));
        await waitFor(() => expect(container.textContent).toMatch(/1 sem o PDF guardado/));
        expect(container.textContent).toMatch(/1 falhou/);
    });

    it('erro do backend chega à tela como está', async () => {
        refazerMock.mockResolvedValue({ ok: false, error: 'São 200 envios e o teto por rodada é 50.' });
        const { container } = render(<EnviosImpostoPainel />);
        fireEvent.click(await screen.findByText(/Refazer o rito destes 2/));
        await waitFor(() => expect(container.textContent).toMatch(/teto por rodada é 50/));
    });

    // Depois de refazer, o painel RECARREGA — senão a tela continua mostrando
    // a pendência que acabou de ser resolvida, e a pessoa clica de novo.
    it('recarrega o painel depois de refazer', async () => {
        refazerMock.mockResolvedValue({ ok: true, total: 2, arquivados: 2, baixados: 2 });
        render(<EnviosImpostoPainel />);
        fireEvent.click(await screen.findByText(/Refazer o rito destes 2/));
        await waitFor(() => expect(painelMock.mock.calls.length).toBeGreaterThan(1));
    });
});

// ── 22/09: "fiz o rito e continua assim … 0 arquivado" ──────────────────────
describe('📁 declarar a cópia à mão — só na ponta do SharePoint, com texto', () => {
    it('aparece na pendência de SharePoint e chama com os ids e o texto', async () => {
        window.prompt = jest.fn(() => 'Arquivei o DARF na pasta IMPOSTOS/2026-08 pelo Explorer.') as any;
        declararMock.mockResolvedValue({ ok: true, total: 2, declarados: 2, recusados: 0 });
        render(<EnviosImpostoPainel />);
        const btn = await screen.findByText(/Já arquivei à mão na pasta IMPOSTOS — registrar para estes 2/);
        fireEvent.click(btn);
        await waitFor(() => expect(declararMock).toHaveBeenCalledWith(['env1', 'env2'], 'Arquivei o DARF na pasta IMPOSTOS/2026-08 pelo Explorer.'));
        expect(await screen.findByText(/Cópia declarada à mão em 2 de 2/)).toBeTruthy();
        expect(screen.getByText(/não como prova do app/)).toBeTruthy();
    });
    it('cancelar o texto não chama nada', async () => {
        window.prompt = jest.fn(() => null) as any;
        render(<EnviosImpostoPainel />);
        fireEvent.click(await screen.findByText(/Já arquivei à mão/));
        await new Promise((r) => setTimeout(r, 20));
        expect(declararMock).not.toHaveBeenCalled();
    });
    it('na pendência de BAIXA o botão de declarar cópia NÃO aparece', async () => {
        painelMock.mockResolvedValue({
            ...PAINEL,
            pendencias: {
                'Sem obrigação correspondente na aba Vencimentos': {
                    qtd: 1, acao: 'Gere as tarefas.', etapa: 'baixa', empresas: ['X · DARE 2026-07'], envioIds: ['env9'],
                },
            },
        });
        render(<EnviosImpostoPainel />);
        await screen.findByText(/Refazer o rito destes 1/);
        expect(screen.queryByText(/Já arquivei à mão/)).toBeNull();
    });
});
