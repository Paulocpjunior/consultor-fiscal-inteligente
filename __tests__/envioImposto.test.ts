/**
 * ORDEM TÉCNICA do envio de imposto (24/07/2026) — helpers puros:
 *   - pasta IMPOSTOS no SharePoint segue a MESMA árvore do sync/arquivo;
 *   - competência nunca é chutada (formato desconhecido → null);
 *   - tipo → obrigação da aba de tarefas (a baixa é o reverso da pendência);
 *   - mailto SEMPRE com o gestor em cópia.
 */
// @ts-expect-error — modulo .js puro
import { normalizarCompetencia, competenciaTarefa, buildFolderPathImpostos, obrigacaoDoTipo, montarMailtoEnvio, GESTOR_EMAIL } from '../sefaz-backend/envio-imposto.js';
// @ts-expect-error — modulo .js puro
import { buildFolderPathArquivo } from '../sefaz-backend/cofre-sharepoint-arquivo.js';

describe('normalizarCompetencia / competenciaTarefa', () => {
    it('aceita AAAA-MM, MM/AAAA e AAAAMM', () => {
        expect(normalizarCompetencia('2026-06')).toBe('2026-06');
        expect(normalizarCompetencia('06/2026')).toBe('2026-06');
        expect(normalizarCompetencia('202606')).toBe('2026-06');
    });
    it('formato desconhecido → null (nunca chuta período)', () => {
        expect(normalizarCompetencia('junho/26')).toBeNull();
        expect(normalizarCompetencia('')).toBeNull();
        expect(normalizarCompetencia('2026-6')).toBeNull();
    });
    it('competenciaTarefa devolve MM/AAAA (formato da coleção tarefas)', () => {
        expect(competenciaTarefa('2026-06')).toBe('06/2026');
        expect(competenciaTarefa('06/2026')).toBe('06/2026');
        expect(competenciaTarefa('xx')).toBeNull();
    });
});

// 🚨 FIXTURE TROCADA EM 02/09, e pelo motivo certo: ela travava o caminho
// `Empresas/{grupo}/DEPARTAMENTO FISCAL/{ano}/{mês}-{ano}/{empresa}/IMPOSTOS`,
// que a medição da árvore REAL mostrou NÃO EXISTIR — não há nível de grupo, a
// empresa vem antes do departamento e o mês é por nome. Ela descrevia o mundo
// que o app imaginava; mantê-la seria travar o defeito.
describe('buildFolderPathImpostos', () => {
    it('a guia vai no mesmo mês do fiscal, a partir da pasta REAL da empresa', () => {
        expect(buildFolderPathImpostos('0040_Clinica Mantoan', '2026-06'))
            .toBe('Empresas/0040_Clinica Mantoan/Departamento Fiscal/2026/Junho/IMPOSTOS');
    });
    it('aceita competência MM/AAAA e recusa dado faltante', () => {
        expect(buildFolderPathImpostos('0040_Clinica Mantoan', '06/2026'))
            .toBe('Empresas/0040_Clinica Mantoan/Departamento Fiscal/2026/Junho/IMPOSTOS');
        expect(buildFolderPathImpostos('', '2026-06')).toBeNull();
        expect(buildFolderPathImpostos('0040_X', 'ruim')).toBeNull();
    });
    // ⚠️ O nome da pasta NÃO é montado: ele chega já lido do SharePoint.
    it('não inventa o nome da pasta da empresa', () => {
        expect(buildFolderPathImpostos('0004 – AÇOUGUE YOKOAMA', '2026-09'))
            .toBe('Empresas/0004 – AÇOUGUE YOKOAMA/Departamento Fiscal/2026/Setembro/IMPOSTOS');
    });
    // 🚨 A GUIA E O XML SÃO IRMÃOS NO MESMO MÊS — e os dois trilhos montam o
    // caminho em módulos diferentes. Se um deles divergir, a guia vai parar
    // numa pasta que ninguém abre, e nada acusa: o upload dá 201 igual.
    it('IMPOSTOS é irmã de XML SAÍDA — os dois trilhos concordam na árvore', () => {
        const guia = buildFolderPathImpostos('0040_Clinica Mantoan', '2026-06');
        const xml = buildFolderPathArquivo('0040_Clinica Mantoan', '2026-06', 'saida');
        expect(guia.replace(/\/IMPOSTOS$/, '')).toBe(xml.replace(/\/XML SAÍDA$/, ''));
    });
});

describe('obrigacaoDoTipo (baixa = reverso da pendência do cron)', () => {
    it('mapeia os tipos pros nomes das obrigações da coleção tarefas', () => {
        expect(obrigacaoDoTipo('DAS')).toBe('DAS');
        expect(obrigacaoDoTipo('das')).toBe('DAS');
        expect(obrigacaoDoTipo('DARF')).toBe('DCTFWEB');
        expect(obrigacaoDoTipo('DCTFWEB')).toBe('DCTFWEB');
        expect(obrigacaoDoTipo('FGTS')).toBe('FGTS');
        expect(obrigacaoDoTipo('SPED')).toBe('SPED');
    });
    it('tipo sem obrigação mensal → null (rito segue sem baixa, não é erro)', () => {
        expect(obrigacaoDoTipo('DARE')).toBeNull();
        expect(obrigacaoDoTipo('')).toBeNull();
    });
});

describe('montarMailtoEnvio — gestor SEMPRE em cópia', () => {
    it('inclui o gestor no cc junto do destinatário do cadastro', () => {
        const m = montarMailtoEnvio({ para: 'cliente@empresa.com.br', assunto: 'DAS 06/2026', corpo: 'Segue guia.' });
        expect(m.startsWith('mailto:cliente%40empresa.com.br?')).toBe(true);
        expect(m).toContain(encodeURIComponent(GESTOR_EMAIL));
        expect(m).toContain('subject=DAS%2006%2F2026');
        expect(m).toContain('body=Segue%20guia.');
    });
    it('não duplica o gestor quando ele é o próprio destinatário', () => {
        const m = montarMailtoEnvio({ para: GESTOR_EMAIL, assunto: 'x' });
        expect(m).not.toContain('cc=');
    });
    it('deduplica ccs extras e ignora vazios', () => {
        const m = montarMailtoEnvio({ para: 'a@b.c', cc: [GESTOR_EMAIL, '', 'outro@b.c', 'OUTRO@b.c'] });
        const cc = decodeURIComponent(m.split('cc=')[1].split('&')[0]);
        expect(cc.split(',').sort()).toEqual([GESTOR_EMAIL, 'outro@b.c'].sort());
    });
    it('gestor padrão é o Alexandre', () => {
        expect(GESTOR_EMAIL).toBe('alexandre@spassessoriacontabil.com.br');
    });
});
