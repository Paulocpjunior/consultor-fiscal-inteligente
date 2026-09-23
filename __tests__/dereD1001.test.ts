// ============================================================================
// 🏦 D-1001 — o primeiro evento da DeRE que o CFI MONTA (Paulo, 02/09: "Fiscal,
// tudo roda no Fiscal").
//
// O que estes testes travam: o XML sai do CADASTRO e passa no XSD OFICIAL
// (lido do arquivo, nunca numa cópia); o que falta no cadastro vira pendência
// NOMEADA, nunca chute; as regras do leiaute (regime secundário ≠ principal,
// atividade só do regime declarado, UF só em prognósticos, validade ≥ início
// da obrigatoriedade) recusam com a régua citada; e o XSD de bolso PEGA o XML
// torto — conferidor que aprova tudo é pior que conferidor nenhum.
// ============================================================================
import { readFileSync } from 'fs';
import { join } from 'path';
import { montarEventoD1001, validarInsumoD1001, lerAtividadeDere, TABELA_13_UF, IND_NAT_TRIB, XSD_D1001 } from '../sefaz-backend/dere-evento-d1001';
import { conferirXmlContraXsd, carregarEsquema } from '../sefaz-backend/dere-xsd-bolso';
import { ATIVIDADES_DERE } from '../sefaz-backend/dere-regimes';

const RAIZ = join(__dirname, '..');
const XSD = readFileSync(join(RAIZ, 'docs/dere/xsd/evtInfoContrib-v1_0_1.xsd'), 'utf8');
const ler = (p: string) => readFileSync(join(RAIZ, p), 'utf8');

const banco = (extra: any = {}) => ({
    colecao: 'lucro_empresas', regimePadrao: 'Real', cnpj: '11.222.333/0001-81',
    dadosFiscais: {
        regimeEspecificoIbsCbs: 'SERVICOS_FINANCEIROS',
        dereAtividades: ['SERVICOS_FINANCEIROS:01A', 'SERVICOS_FINANCEIROS:02A'],
        dereIndNatTrib: '0',
        dereIniValid: '2026-10-01',
        ...extra,
    },
});
const DATA = new Date('2026-10-01T15:00:00Z');

describe('o XSD de bolso lê o XSD oficial e pega XML torto', () => {
    it('carrega o esquema: raiz DeRE, namespace v1_0_1, sequência com os grupos do leiaute', () => {
        const e = carregarEsquema(XSD);
        expect(e.raiz.nome).toBe('DeRE');
        expect(e.targetNamespace).toBe(XSD_D1001.namespace);
        // A assinatura é IRMÃ do evento (filha de <DeRE>), não filha dele — é onde o
        // gateway vai pô-la. Ler isso do XSD, e não de memória, é o que evita o
        // `<Signature>` no lugar errado (o erro do `retEvento` de 02/09).
        expect(e.raiz.filhos!.map((f) => f.nome || f.ref)).toEqual(['evtInfoContrib', 'ds:Signature']);
        const evt = e.raiz.filhos![0];
        expect(evt.nome).toBe('evtInfoContrib');
        expect(evt.filhos!.map((f) => f.nome || f.ref)).toEqual(['ideEvento', 'ideContrib', 'idePeriodo', 'infoContrib']);
        expect(evt.atributos![0]).toMatchObject({ nome: 'id', obrigatorio: true });
        // Nenhuma construção que o conferidor não saiba ler — senão ele estaria aprovando o que não leu.
        expect(e.avisos).toEqual([]);
    });

    it('recusa: ordem trocada, valor fora da enumeração, pattern quebrado, elemento desconhecido, atributo ausente', () => {
        const ok = montarEventoD1001(banco(), { regimeCatalogo: 'LUCRO_REAL', data: DATA });
        expect(ok.ok).toBe(true);
        const xml = ok.xml!;
        const casos: [string, string, RegExp][] = [
            ['ordem trocada', xml.replace('<ideContrib>', '<idePeriodo><iniValid>2026-10-01</iniValid></idePeriodo><ideContrib>').replace('<idePeriodo><iniValid>2026-10-01</iniValid></idePeriodo><infoContrib>', '<infoContrib>'), /idePeriodo.*(máximo|inesperado)|ideContrib.*mínimo/],
            ['enumeração', xml.replace('<tpAmb>2</tpAmb>', '<tpAmb>3</tpAmb>'), /tpAmb.*enumeração/],
            ['pattern', xml.replace('<tpAtividade>01A</tpAtividade>', '<tpAtividade>1A</tpAtividade>'), /tpAtividade.*pattern/],
            ['desconhecido', xml.replace('</ideEvento>', '<xpto>1</xpto></ideEvento>'), /xpto.*inesperado/],
            ['atributo', xml.replace(/ id="[^"]+"/, ''), /@id ausente/],
            ['obrigatório ausente', xml.replace(/<indNatTrib>0<\/indNatTrib>/, ''), /indNatTrib.*mínimo 1/],
            ['namespace', xml.replace(XSD_D1001.namespace, 'http://errado'), /namespace/],
        ];
        for (const [nome, torto, esperado] of casos) {
            const r = conferirXmlContraXsd(torto, XSD);
            expect({ nome, ok: r.ok }).toEqual({ nome, ok: false });
            expect({ nome, erros: r.erros.join(' | ') }).toEqual({ nome, erros: expect.stringMatching(esperado) });
        }
    });

    it('a assinatura fica de fora da prévia DITA, não aprovada em silêncio', () => {
        const ok = montarEventoD1001(banco(), { regimeCatalogo: 'LUCRO_REAL', data: DATA });
        const r = conferirXmlContraXsd(ok.xml!, XSD);
        expect(r.ok).toBe(true);
        expect(r.avisos.join(' ')).toMatch(/ds:Signature/);
        // Sem ignorar a ref, o XSD cobra a assinatura — que é o que a transmissão terá de trazer.
        const estrito = conferirXmlContraXsd(ok.xml!, XSD, { ignorarRefs: [] });
        expect(estrito.ok).toBe(false);
        expect(estrito.erros.join(' ')).toMatch(/Signature.*mínimo 1/);
    });
});

describe('montarEventoD1001 — do cadastro ao XML, na ordem do XSD', () => {
    it('serviços financeiros: XML na ordem do XSD, id de 42, passa no XSD oficial', () => {
        const r = montarEventoD1001(banco(), { regimeCatalogo: 'LUCRO_REAL', data: DATA, sequencial: 3, verAplic: 'CFI-teste' });
        expect(r.ok).toBe(true);
        expect(r.pendencias).toEqual([]);
        expect(r.id).toMatch(/^DeRE1001111222333000181\d{14}00003$/);
        expect(r.id).toHaveLength(42);
        expect(r.xml).toContain(`<DeRE xmlns="${XSD_D1001.namespace}"><evtInfoContrib id="${r.id}"><ideEvento><tpOper>1</tpOper><tpAmb>2</tpAmb><aplicEmi>1</aplicEmi><verAplic>CFI-teste</verAplic></ideEvento>`);
        expect(r.xml).toContain('<ideContrib><nrInsc>11222333</nrInsc></ideContrib><idePeriodo><iniValid>2026-10-01</iniValid></idePeriodo>');
        expect(r.xml).toContain('<infoContrib><regTribPrinc>1</regTribPrinc><indNatTrib>0</indNatTrib><servFinanc><tpAtividades><tpAtividade>01A</tpAtividade><tpAtividade>02A</tpAtividade></tpAtividades></servFinanc></infoContrib>');
        expect(r.xml).not.toContain('Signature');
        expect(conferirXmlContraXsd(r.xml!, XSD).ok).toBe(true);
        expect(r.resumo).toMatchObject({ evento: 'D-1001', xsd: 'evtInfoContrib-v1_0_1.xsd', nrInsc: '11222333', regTribPrinc: 1, tpAmb: '2' });
        expect(r.avisos.join(' ')).toMatch(/SEM assinatura/);
    });

    it('três regimes (principal + 2 secundários), com UFs credenciadas em prognósticos, fimValid e tpAmb 1 — passa no XSD', () => {
        const r = montarEventoD1001(banco({
            regimeEspecificoIbsCbs: 'CONCURSOS_PROGNOSTICOS',
            dereRegimesSecundarios: ['SERVICOS_FINANCEIROS', 'PLANOS_SAUDE'],
            dereAtividades: ['CONCURSOS_PROGNOSTICOS:01C', 'SERVICOS_FINANCEIROS:01A', 'PLANOS_SAUDE:05A', 'SERVICOS_FINANCEIROS:02A'],
            dereUfsCredenciadas: ['35', '33', '35'],
            dereIndNatTrib: '1', dereFimValid: '2027-12-31',
        }), { regimeCatalogo: 'LUCRO_REAL', data: DATA, tpAmb: 1 });
        expect(r.ok).toBe(true);
        // Ordem dos grupos é a do XSD (servFinanc · plAssistSaude · prognosticos), não a da declaração.
        expect(r.xml).toContain('<regTribPrinc>3</regTribPrinc><regTribSecund>1</regTribSecund><regTribSecund>2</regTribSecund><indNatTrib>1</indNatTrib>'
            + '<servFinanc><tpAtividades><tpAtividade>01A</tpAtividade><tpAtividade>02A</tpAtividade></tpAtividades></servFinanc>'
            + '<plAssistSaude><tpAtividades><tpAtividade>05A</tpAtividade></tpAtividades></plAssistSaude>'
            + '<prognosticos><tpAtividades><tpAtividade>01C</tpAtividade></tpAtividades><UFsCredenc><UFCredenc>35</UFCredenc><UFCredenc>33</UFCredenc></UFsCredenc></prognosticos>');
        expect(r.xml).toContain('<iniValid>2026-10-01</iniValid><fimValid>2027-12-31</fimValid>');
        expect(r.xml).toContain('<tpAmb>1</tpAmb>');
        expect(conferirXmlContraXsd(r.xml!, XSD).ok).toBe(true);
    });

    it('CNPJ alfanumérico: a raiz vai em maiúsculas e o Id cabe no padrão do XSD', () => {
        const r = montarEventoD1001(banco({}), { regimeCatalogo: 'LUCRO_REAL', data: DATA });
        const alfa = montarEventoD1001({ ...banco(), cnpj: '12abc345000199' }, { regimeCatalogo: 'LUCRO_REAL', data: DATA });
        expect(r.ok && alfa.ok).toBe(true);
        expect(alfa.xml).toContain('<nrInsc>12ABC345</nrInsc>');
        expect(conferirXmlContraXsd(alfa.xml!, XSD).ok).toBe(true);
    });
});

describe('o que o gerador RECUSA — com o campo e a régua nomeados', () => {
    const insumo = (extra: any, regime = 'LUCRO_REAL') => validarInsumoD1001(banco(extra), { regimeCatalogo: regime });

    it('empresa não obrigada (Simples, NENHUM, fora do leiaute, sem cadastro) não gera nada', () => {
        expect(insumo({}, 'SIMPLES').pendencias[0]).toMatch(/dispensada-simples/);
        expect(insumo({ regimeEspecificoIbsCbs: 'NENHUM' }).pendencias[0]).toMatch(/nao-se-aplica/);
        expect(insumo({ regimeEspecificoIbsCbs: 'BENS_IMOVEIS' }).pendencias[0]).toMatch(/regime-fora-do-leiaute/);
        expect(insumo({ regimeEspecificoIbsCbs: null }).pendencias[0]).toMatch(/sem-sinal/);
    });

    it('indNatTrib ausente NÃO vira "regular"; iniValid ausente não recebe default; iniValid antes de 10/2026 é INI_VALID', () => {
        expect(insumo({ dereIndNatTrib: '' }).pendencias.join(' ')).toMatch(/indNatTrib/);
        expect(insumo({ dereIniValid: '' }).pendencias.join(' ')).toMatch(/iniValid.*2026-10-01/);
        expect(insumo({ dereIniValid: '2026-09-15' }).pendencias.join(' ')).toMatch(/INI_VALID/);
        expect(insumo({ dereFimValid: '2026-09-15' }).pendencias.join(' ')).toMatch(/FIM_VALID/);
    });

    it('atividades: sem regime na frente, fora da tabela, de regime não declarado (REJEITAR_GRUPO_REGIME) e regime sem atividade (EXIGIR_GRUPO_REGIME)', () => {
        // As três tabelas REPETEM códigos — "01A" solto não diz de qual tabela é.
        expect(insumo({ dereAtividades: ['01A'] }).pendencias.join(' ')).toMatch(/fora da forma REGIME:NNC/);
        expect(lerAtividadeDere('PLANOS_SAUDE:05A')).toMatchObject({ ok: true, regime: 'PLANOS_SAUDE', codigo: '05A', descricao: expect.stringMatching(/operadoras/i) });
        expect(lerAtividadeDere('SERVICOS_FINANCEIROS:05A')).toMatchObject({ ok: true, descricao: expect.stringMatching(/factoring/i) });
        expect(insumo({ dereAtividades: ['SERVICOS_FINANCEIROS:01A', 'SERVICOS_FINANCEIROS:99Z'] }).pendencias.join(' ')).toMatch(/"99Z" não existe na tabela de Serviços financeiros/);
        expect(insumo({ dereAtividades: ['BENS_IMOVEIS:01A'] }).pendencias.join(' ')).toMatch(/não tem tabela de atividades/);
        const cruz = insumo({ dereAtividades: ['SERVICOS_FINANCEIROS:01A', 'CONCURSOS_PROGNOSTICOS:01C'] });
        expect(cruz.pendencias.join(' ')).toMatch(/"01C".*prognósticos.*REJEITAR_GRUPO_REGIME/);
        expect(insumo({ dereAtividades: [] }).pendencias.join(' ')).toMatch(/EXIGIR_GRUPO_REGIME/);
        const semSec = insumo({ dereRegimesSecundarios: ['PLANOS_SAUDE'] });
        expect(semSec.pendencias.join(' ')).toMatch(/Planos de assistência à saúde.*EXIGIR_GRUPO_REGIME/);
    });

    it('regime secundário igual ao principal ou fora do leiaute; UF fora da Tabela 13 ou em quem não é de prognósticos', () => {
        expect(insumo({ dereRegimesSecundarios: ['SERVICOS_FINANCEIROS'] }).pendencias.join(' ')).toMatch(/REG_SEC_DIFERENTE_REG_PRINC/);
        expect(insumo({ dereRegimesSecundarios: ['BENS_IMOVEIS'] }).pendencias.join(' ')).toMatch(/BENS_IMOVEIS.*não tem código/);
        expect(insumo({ dereUfsCredenciadas: ['35'] }).pendencias.join(' ')).toMatch(/só existem para concursos de prognósticos/);
        const prog = insumo({ regimeEspecificoIbsCbs: 'CONCURSOS_PROGNOSTICOS', dereAtividades: ['SERVICOS_FINANCEIROS:01A'], dereUfsCredenciadas: ['77'] });
        expect(prog.pendencias.join(' ')).toMatch(/"77" não está na Tabela 13/);
        // A atividade marcada é da tabela de serviços financeiros — regime que esta empresa não declarou.
        expect(prog.pendencias.join(' ')).toMatch(/REJEITAR_GRUPO_REGIME/);
    });

    it('a prévia só monta INCLUSÃO e só nos ambientes 1/2', () => {
        expect(montarEventoD1001(banco(), { regimeCatalogo: 'LUCRO_REAL', tpOper: 2 as any }).pendencias.join(' ')).toMatch(/só monta INCLUSÃO/);
        expect(montarEventoD1001(banco(), { regimeCatalogo: 'LUCRO_REAL', tpAmb: 3 as any }).pendencias.join(' ')).toMatch(/tpAmb/);
    });

    it('as tabelas copiadas: Tabela 13 tem as 27 UFs + União; indNatTrib tem 0 e 1; toda atividade da tela existe no dono', () => {
        expect(Object.keys(TABELA_13_UF)).toHaveLength(28);
        expect(TABELA_13_UF[35]).toBe('SP');
        expect(TABELA_13_UF[99]).toMatch(/União/);
        expect(IND_NAT_TRIB.map((i) => i.codigo)).toEqual(['0', '1']);
        expect(Object.keys(ATIVIDADES_DERE)).toHaveLength(3);
    });
});

// ═══ AS LIGAÇÕES — gerador sem tela, campo sem whitelist e rota sem botão são código morto ═══
describe('🚨 o D-1001 tem cadastro, rota e botão — no MESMO PR', () => {
    it('os seis campos do insumo estão na whitelist com validação, e no modal', () => {
        const rota = ler('sefaz-backend/empresa-status-routes.js');
        const modal = ler('components/EmpresaDadosFiscaisModal.tsx');
        for (const c of ['dereAtividades', 'dereRegimesSecundarios', 'dereIndNatTrib', 'dereUfsCredenciadas', 'dereIniValid', 'dereFimValid']) {
            expect({ c, whitelist: rota.includes(`'${c}'`), modal: modal.includes(c) }).toEqual({ c, whitelist: true, modal: true });
        }
        expect(rota).toMatch(/validarListaDere\(/);
        // As opções do modal vêm dos DONOS — copiar tabela para a tela é a segunda cópia.
        expect(modal).toMatch(/ATIVIDADES_DERE/);
        expect(modal).toMatch(/TABELA_13_UF/);
        expect(modal).toMatch(/IND_NAT_TRIB/);
        expect(modal).not.toMatch(/'01A'/);
        // A atividade se grava com o regime na frente (as tabelas repetem códigos).
        expect(modal).toMatch(/\$\{r\.codigo\}:\$\{cod\}/);
    });

    it('a rota da prévia existe, confere contra o XSD SERVIDO (não docs/), e a tela tem o botão', () => {
        const rota = ler('sefaz-backend/cadastro-central-routes.js');
        expect(rota).toMatch(/'\/dere-d1001-previa'/);
        expect(rota).toMatch(/montarEventoD1001\(/);
        expect(rota).toMatch(/conferirXmlContraXsd\(/);
        // A imagem de runtime não tem docs/ — ler de lá passaria no jest e quebraria no Cloud Run.
        expect(rota).toMatch(/dist\/docs\/dere\/xsd/);
        expect(rota).not.toMatch(/'docs\/dere\/xsd/);
        // Rota que grava/assina/transmite NÃO existe aqui — prévia é consulta.
        expect(rota).not.toMatch(/dere-d1001-transmitir|assinarEvento|\.set\(\s*\{[^}]*d1001/);
        const painel = ler('components/DerePanel.tsx');
        expect(painel).toMatch(/dere-d1001-previa/);
        expect(painel).toMatch(/Prévia do D-1001/);
        expect(painel).toMatch(/não assina nem transmite/);
    });
});
