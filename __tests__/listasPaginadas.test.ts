// 🧊 As dez telas que desenhavam o array INTEIRO com `.map(` (uma tabela de
// 20.000 linhas travou a aba na semana de 21/09) têm de passar pelo hook de
// paginação local. A trava lê o FONTE porque renderizar dez telas exigiria
// mockar todos os serviços delas (Firestore, fetch, auth); o fato cobrado é
// que a porta existe: o arquivo importa `usePaginaLocal` e desenha a fatia
// `.visiveis` em vez do array inteiro.
import { readFileSync } from 'fs';
import { join } from 'path';

const TELAS = [
    'components/Tarefas.tsx',
    'components/SimplesNacionalDashboard.tsx',
    'components/LucroPresumidoReal/ListView.tsx',
    'components/EmpresasStatusCapturaPanel.tsx',
    'components/UserManagementModal.tsx',
    'components/NfseNacional/index.tsx',
    'components/xml/XmlEmpresasMonitoradas.tsx',
    'components/RecuperacaoTributaria/index.tsx',
    'components/AnaliseRetencoesNfseSP.tsx',
    'components/xml/DipamProdutorRuralPanel.tsx',
    'components/xml/DifalPanel.tsx',
];

const ler = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('listas grandes passam pela paginação local', () => {
    it.each(TELAS)('%s importa usePaginaLocal, desenha .visiveis e mostra o botão', (tela) => {
        const src = ler(tela);
        expect(src).toMatch(/import \{ usePaginaLocal \} from '(\.\.?\/)+hooks\/usePaginaLocal'/);
        expect(src).toContain('.visiveis.map(');
        expect(src).toContain('<MostrarMais pagina={');
    });
});
