// ============================================================================
// 🚨 O LINK DENTRO DO CARD-FILTRO NÃO FUNCIONAVA — e ficou SEIS DIAS assim
//
// 29/08, Paulo, no 📋 Status de Captura por Empresa: *"o card não está
// clicável, o link não está clicável"*.
//
// A causa: o card **inteiro** é um botão (`cardFiltro('bloqueadas')`), e os
// dois links de "sem entrega" vivem DENTRO dele. Sem `stopPropagation` o
// clique borbulha — o link aplica o filtro dele, o CARD aplica `bloqueadas`
// logo depois, e o último vence. Para quem usa, isso é indistinguível de
// "o link não faz nada", e a única saída que sobra é repetir o clique (a
// família do "Já importado" sem estado, 14/08).
//
// 🐛 **E O DEFEITO ERA MEU, DUAS VEZES.** O link do A3 nasceu em 23/08 já
// assim e ninguém viu; em 29/08 eu escrevi o do NFS-e SP **copiando o padrão
// quebrado**. A varredura de fonte não pega isto: os dois `onClick` estão
// escritos e corretos em si — o que falha é a COMPOSIÇÃO com o card.
//
// 📌 **REGRA QUE FICA: link/botão dentro de área clicável se prova por RENDER,
// clicando.** É a lição de 20/08 (o campo do cérebro do CFOP que a varredura
// dizia estar certo e o dedo do Paulo não achava): varredura de fonte prova o
// CÓDIGO, nunca a TELA.
// ============================================================================
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmpresasStatusCapturaPanel from '../components/EmpresasStatusCapturaPanel';

// O painel importa dois modais que puxam `firebaseConfig`/`authService`, e
// eles leem `import.meta.env`, que não carrega no jest. Nenhum dos dois
// participa deste teste (abrem por clique na linha), então entram como stub.
jest.mock('../components/CadastroClienteModal', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/EmpresaDadosFiscaisModal', () => ({ __esModule: true, default: () => null }));

const listarMock = jest.fn();

jest.mock('../services/empresaStatusCapturaService', () => ({
    fetchEmpresasStatusCaptura: (...a: any[]) => listarMock(...a),
    toggleEmpresaFlag: jest.fn(),
    autoPreencherUf: jest.fn(),
    autoPreencherMunicipio: jest.fn(),
    resetLockSefaz: jest.fn(),
    salvarEmpresaDadosFiscais: jest.fn(),
    corrigirRegimeEmpresa: jest.fn(),
    arquivarEmpresa: jest.fn(),
    excluirEmpresa: jest.fn(),
    exportarEmpresasCsv: jest.fn(),
    formatarErroAcaoStatusCaptura: (e: any) => String(e),
    formatarMotivoBloqueioCaptura: (m: any) => String(m),
}));
jest.mock('../services/dfeCaptureService', () => ({ captureFromSefaz: jest.fn() }));
jest.mock('../services/efiscalCadastroEmpresasParser', () => ({ parsearCadastroEmpresas: jest.fn() }));

/** Uma empresa de cada caso, para o filtro ter o que separar. */
const EMPRESAS = [
    {
        cnpj: '41048669000130', nome: 'LAV COMERCIO DE AUTOPECAS LTDA', regime: 'simples',
        capturaNfeOk: true, capturaNfseSpOk: false, capturaNfseNacionalOk: true,
        coberturaNfseSp: { situacao: 'nfsesp-sem-entrega', cor: 'atencao', aplicavel: true, entregou: false, texto: 'nunca baixou', acao: 'confira o CCM', entregueEm: null, diasDesdeEntrega: null },
        motivosBloqueio: [], responsaveis: [],
    },
    {
        cnpj: '11111111000111', nome: 'EMPRESA A3 SEM ENTREGA LTDA', regime: 'lucro',
        capturaNfeOk: true, capturaNfseSpOk: true, capturaNfseNacionalOk: true,
        coberturaA3: { situacao: 'a3-sem-entrega', cor: 'atencao', ehA3: true, texto: 'nunca entregou', acao: 'rode o agente' },
        motivosBloqueio: [], responsaveis: [],
    },
    {
        cnpj: '22222222000122', nome: 'EMPRESA BLOQUEADA LTDA', regime: 'lucro',
        capturaNfeOk: false, capturaNfseSpOk: true, capturaNfseNacionalOk: true,
        motivosBloqueio: ['NFe: sem certificado'], responsaveis: [],
    },
];

const RESUMO = {
    total: 3, semUf: 0, comCertA1: 1, comCertA3: 1,
    a3SemEntrega: 1, a3ComEntrega: 0,
    nfseSpSemEntrega: 1, nfseSpComErro: 0, nfseSpEntregue: 1,
    usandoCertEscritorio: 0, semCertNenhum: 0, certExpirado: 0, certVenceEm30d: 0,
    comProcuracaoEcac: 3, semProcuracaoEcac: 0, ccmSpAutorizado: 1, nfseNacionalAtivo: 3,
    capturaNfeOk: 2, capturaNfeBloqueada: 1, capturaNfseSpOk: 2, capturaNfseNacionalOk: 3,
};

beforeEach(() => {
    jest.clearAllMocks();
    listarMock.mockResolvedValue({ resumo: RESUMO, empresas: EMPRESAS });
});

const USER = { uid: 'u1', email: 'p.c.pereira@me.com', role: 'admin' } as any;

const abrir = async () => {
    const r = render(<EmpresasStatusCapturaPanel currentUser={USER} />);
    await screen.findByText(/A3 sem entrega do agente/);
    return r;
};

// ════════════════════════════════════════════════════════════════════════════
// 🚨 O TESTE QUE PEGA O DEFEITO: clicar no link e ver a LISTA mudar.
//
// Ele não olha o `onClick` — olha o que a tela mostra depois do clique. Com o
// borbulhamento, o card aplica `bloqueadas` por cima e a EMPRESA BLOQUEADA
// aparece no lugar da que o link prometia.
// ════════════════════════════════════════════════════════════════════════════
describe('🚨 os links "sem entrega" filtram de verdade', () => {
    it('⚠ NFS-e SP sem entrega mostra a LAV, não a bloqueada', async () => {
        const { container } = await abrir();
        fireEvent.click(screen.getByText(/NFS-e SP sem entrega/));
        await waitFor(() => expect(container.textContent).toMatch(/LAV COMERCIO DE AUTOPECAS/));
        // 🚨 A prova do borbulhamento: com ele, o card sobrepõe com
        // `bloqueadas` e é ESTA empresa que aparece.
        expect(container.textContent).not.toMatch(/EMPRESA BLOQUEADA/);
        expect(container.textContent).not.toMatch(/EMPRESA A3 SEM ENTREGA/);
    });

    it('⚠ A3 sem entrega do agente mostra a A3, não a bloqueada', async () => {
        const { container } = await abrir();
        fireEvent.click(screen.getByText(/A3 sem entrega do agente/));
        await waitFor(() => expect(container.textContent).toMatch(/EMPRESA A3 SEM ENTREGA/));
        expect(container.textContent).not.toMatch(/EMPRESA BLOQUEADA/);
        expect(container.textContent).not.toMatch(/LAV COMERCIO/);
    });

    // O card em volta continua funcionando — a correção não pode ter matado o
    // filtro que já existia.
    it('o card em volta continua filtrando pelas bloqueadas', async () => {
        const { container } = await abrir();
        fireEvent.click(screen.getByText(/Captura NFe OK/));
        await waitFor(() => expect(container.textContent).toMatch(/EMPRESA BLOQUEADA/));
        expect(container.textContent).not.toMatch(/LAV COMERCIO/);
    });
});

// ⚠️ A busca é limpa junto, como o card faz. Sem isso, clicar no link com uma
// busca aberta devolveria a interseção — e o número do cabeçalho desmentiria a
// lista logo abaixo (a régua de 27/08: filtro por causa VENCE o que estava
// aberto).
describe('o link limpa a busca, como o card', () => {
    it('busca aberta não corta o resultado do link', async () => {
        const { container } = await abrir();
        fireEvent.change(screen.getByPlaceholderText(/buscar/i), { target: { value: 'zzz-nao-existe' } });
        fireEvent.click(screen.getByText(/NFS-e SP sem entrega/));
        await waitFor(() => expect(container.textContent).toMatch(/LAV COMERCIO DE AUTOPECAS/));
    });
});

// ════════════════════════════════════════════════════════════════════════════
// 🔒 E A TRAVA DA CLASSE — o teste de render prova os links que EXISTEM; esta
// varredura pega o PRÓXIMO que alguém acrescentar copiando o padrão, que foi
// exatamente como o defeito nasceu duas vezes.
//
// ⚠️ As duas travas são necessárias e nenhuma substitui a outra: a varredura
// não sabe se o clique funciona (o `onClick` estava certo em si — falhava a
// COMPOSIÇÃO), e o render só cobre o que já está na tela.
// ════════════════════════════════════════════════════════════════════════════
describe('🔒 todo botão dentro de card-filtro para o borbulhamento', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const src: string = require('fs').readFileSync(
        require('path').join(__dirname, '..', 'components/EmpresasStatusCapturaPanel.tsx'), 'utf8',
    );

    // 🐛 A 1ª versão desta varredura acusou os DOIS botões corrigidos e mais um
    // que já estava certo: `<button[^>]*>` para no primeiro `>`, e o `=>` da
    // arrow function TEM um. Ela olhava meia tag e nunca chegava no
    // `stopPropagation`. Alarme falso sobre código certo é o que faz a equipe
    // desligar a trava — a seta sai antes de a tag ser recortada.
    const semSeta = src.replace(/=>/g, '=@');

    it('nenhum <button> em card clicável sem stopPropagation', () => {
        const inicios = [...semSeta.matchAll(/<div \{\.\.\.cardFiltro\('([^']+)'/g)];
        const faltando: string[] = [];
        // 🐛 A 2ª versão desta varredura ia do card até o PRÓXIMO card — e o
        // último da lista não tem próximo, então a janela dele engolia a tela
        // inteira (barra de ferramentas, tabela, ações da linha) e acusava seis
        // botões que não estão em card nenhum. A janela fecha no `</div>` DO
        // CARD, contando profundidade.
        const fimDoCard = (ini: number) => {
            let depth = 0;
            const re = /<div\b|<\/div>/g;
            re.lastIndex = ini;
            let m: RegExpExecArray | null;
            while ((m = re.exec(semSeta))) {
                depth += m[0] === '</div>' ? -1 : 1;
                if (depth === 0) return m.index + m[0].length;
            }
            return semSeta.length;
        };
        for (let i = 0; i < inicios.length; i++) {
            const ini = inicios[i].index!;
            const bloco = semSeta.slice(ini, fimDoCard(ini));
            // Cada <button …> até o `>` que fecha a tag de abertura.
            for (const b of bloco.match(/<button[^>]*>/g) || []) {
                if (!b.includes('stopPropagation')) faltando.push(`${inicios[i][1]}: ${b.slice(0, 60)}…`);
            }
        }
        expect(faltando).toEqual([]);
    });
});
