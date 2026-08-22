// ============================================================================
// 🚨 AS TRÊS ROTAS DA MANIFESTAÇÃO GANHARAM BOTÃO (autorizado pelo Paulo, 22/08)
//
// A varredura das 273 rotas achou sete sem caminho na interface; três eram da
// manifestação. A regra de 13/08 diz que rota sem botão é código morto com
// cara de entrega — e aqui o buraco era exatamente o caso que mais dói: ver
// QUEM está na fila e manifestar UMA nota quando ela trava.
//
// 📌 A prova é por RENDER, não por varredura de fonte: em 20/08 a varredura de
// fonte disse que o campo do cérebro do CFOP estava certo e o dedo do Paulo
// não o encontrava. Tela se prova renderizando e clicando.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const listar = jest.fn();
const manifestarUma = jest.fn();
const resetInfra = jest.fn();

jest.mock('../services/manifestoService', () => ({
    manifestarPendentes: jest.fn(),
    resumoManifestacao: () => '',
    listarElegiveisManifestacao: (...a: unknown[]) => listar(...a),
    manifestarUmaChave: (...a: unknown[]) => manifestarUma(...a),
    resetarFalhasInfraManifestacao: (...a: unknown[]) => resetInfra(...a),
}));

// O painel inteiro puxa Firebase; o card é exportado à parte, então o teste
// monta só ele — import ESTÁTICO, como os demais testes de tela do projeto
// (o `require` dentro do arquivo carrega o módulo antes do mock do React).
import { FilaManifestacaoCard } from '../components/CapturaDiagnosticoPanel';

const CHAVE = '35260731947349000169550010000034853106861510';

describe('🚨 fila da manifestação — os três caminhos existem na TELA', () => {
    beforeEach(() => {
        listar.mockReset(); manifestarUma.mockReset(); resetInfra.mockReset();
        jest.spyOn(window, 'confirm').mockReturnValue(true);
    });

    it('🔎 Ver fila lista quem está esperando', async () => {
        listar.mockResolvedValue({
            total: 2,
            itens: [{ chave: CHAVE, empresaNome: 'PWR LTDA', empresaCnpj: '31947349000169', dhEmi: '2026-07-29' }],
        });
        render(<FilaManifestacaoCard />);
        fireEvent.click(screen.getByText(/Ver fila/));
        await waitFor(() => expect(screen.getByText(/PWR LTDA/)).toBeTruthy());
        // O recorte DIZ o que ficou de fora — lista cortada sem contagem é o
        // "0 de N" que faz alguém ler a fila como vazia.
        expect(screen.getByText(/1 de 2 na fila/)).toBeTruthy();
    });

    it('📨 Manifestar age em UMA chave, com o CNPJ do destinatário', async () => {
        listar.mockResolvedValue({
            total: 1,
            itens: [{ chave: CHAVE, empresaNome: 'PWR', empresaCnpj: '31.947.349/0001-69' }],
        });
        manifestarUma.mockResolvedValue({ status: 'ok', cStat: '135', xMotivo: 'Evento registrado' });
        render(<FilaManifestacaoCard />);
        fireEvent.click(screen.getByText(/Ver fila/));
        await waitFor(() => expect(screen.getByText(/📨 Manifestar/)).toBeTruthy());
        fireEvent.click(screen.getByText(/📨 Manifestar/));
        await waitFor(() => expect(manifestarUma).toHaveBeenCalled());
        expect(manifestarUma.mock.calls[0][0]).toMatchObject({
            chNFe: CHAVE,
            cnpjDestinatario: '31947349000169',   // só dígitos
            tipo: 'ciencia',
        });
    });

    it('⚠️ e PERGUNTA antes — manifestação é irreversível na SEFAZ', async () => {
        (window.confirm as jest.Mock).mockReturnValue(false);
        listar.mockResolvedValue({ total: 1, itens: [{ chave: CHAVE, empresaCnpj: '31947349000169' }] });
        render(<FilaManifestacaoCard />);
        fireEvent.click(screen.getByText(/Ver fila/));
        await waitFor(() => expect(screen.getByText(/📨 Manifestar/)).toBeTruthy());
        fireEvent.click(screen.getByText(/📨 Manifestar/));
        expect(manifestarUma).not.toHaveBeenCalled();
    });

    it('🔧 Destravar diz quantas voltaram — e que só as de INFRAESTRUTURA voltam', async () => {
        resetInfra.mockResolvedValue({ candidatos: 40, resetados: 12 });
        listar.mockResolvedValue({ total: 0, itens: [] });
        render(<FilaManifestacaoCard />);
        fireEvent.click(screen.getByText(/Destravar falhas/));
        await waitFor(() => expect(screen.getByText(/12 chave\(s\) voltaram ao lote/)).toBeTruthy());
        expect(screen.getByText(/recusa da SEFAZ por mérito continua fora/)).toBeTruthy();
    });

    it('fila vazia NÃO é lida como "não há pendência" — o texto diz o que ela não prova', async () => {
        listar.mockResolvedValue({ total: 0, itens: [] });
        render(<FilaManifestacaoCard />);
        fireEvent.click(screen.getByText(/Ver fila/));
        // ⚠️ O "não" vai em <strong>, então o texto do parágrafo é PARTIDO em três
        // nós — regex que atravessa a fronteira nunca casaria. Quem responde é o
        // `textContent` do parágrafo inteiro, com o espaço em branco do JSX
        // normalizado: é o que a pessoa LÊ, não como o DOM o guarda.
        await waitFor(() => {
            const p = screen.getByText(/Nenhuma chave elegível agora/);
            expect((p.textContent || '').replace(/\s+/g, ' '))
                .toMatch(/Isso não quer dizer que não há resumo pendente/);
        });
    });

    it('sem CNPJ do destinatário o botão DIZ a causa em vez de falhar calado', async () => {
        listar.mockResolvedValue({ total: 1, itens: [{ chave: CHAVE, empresaNome: 'SEM CNPJ' }] });
        render(<FilaManifestacaoCard />);
        fireEvent.click(screen.getByText(/Ver fila/));
        await waitFor(() => expect(screen.getByText(/📨 Manifestar/)).toBeTruthy());
        fireEvent.click(screen.getByText(/📨 Manifestar/));
        await waitFor(() => expect(screen.getByText(/sem CNPJ do destinatário/)).toBeTruthy());
        expect(manifestarUma).not.toHaveBeenCalled();
    });
});
