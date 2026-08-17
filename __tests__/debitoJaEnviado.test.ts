// ============================================================================
// 🚨 BARRAR O SEGUNDO ENVIO DO MESMO DÉBITO.
//
// Paulo, 17/08, autorizando depois do caso HYPE CAFE: *"pode fazer, barrar o
// segundo envio do mesmo débito"*.
//
// O aviso de mistura de departamentos (mesmo dia) resolvia metade: ele DIZ que o
// DARF unificado carrega débito de outro departamento, mas a trava dependia de o
// outro departamento LEMBRAR. E memória não é trava — a régua de 11/08 vale aqui:
// quem não sabe não precisa saber, precisa NÃO PASSAR.
//
// ═══ POR QUE O RISCO É ESTRUTURAL, NÃO DESCUIDO ═════════════════════════════
//
// A receita PREVIDENCIÁRIA não tem guia avulsa: o 1082 só sai dentro do DARF
// unificado, que carrega PIS/COFINS de novo. Então em TODO cliente com folha e
// faturamento no mesmo mês existe um caminho em que o mesmo débito vai duas
// vezes ao cliente. A unidade da trava é o DÉBITO, não a guia.
// ============================================================================
import {
    chaveDebito, chavesDaGuia, canalProvaEnvio,
    conferirDebitosJaEnviados, avisoDeRepeticao,
} from '../sefaz-backend/debito-ja-enviado.js';
import { readFileSync } from 'fs';
import { join } from 'path';

/** O DARF real da HYPE CAFE 07/2026. */
const GUIA_HYPE = [
    { codigo: '1082', descricao: 'CONTR PREV DESCONTA SEGURADO-EMPREGADO/AVULSO', valor: 201.71 },
    { codigo: '2172', descricao: 'COFINS', valor: 591.68 },
    { codigo: '8109', descricao: 'PIS', valor: 128.20 },
];

const envio = (over: any = {}) => ({
    id: 'e1', tipo: 'DARF', canal: 'email-graph',
    enviadoPor: 'fiscal@spassessoriacontabil.com.br',
    enviadoEm: '2026-08-17T14:00:00.000Z',
    debitos: [{ codigo: '2172', valor: 591.68 }, { codigo: '8109', valor: 128.20 }],
    ...over,
});

describe('a unidade é o DÉBITO, não a guia', () => {
    it('código + extensão formam a chave', () => {
        expect(chaveDebito({ codigo: '1656', extensao: '01' })).toBe('1656-01');
        expect(chaveDebito({ codigo: '1082' })).toBe('1082');
        expect(chaveDebito({ codReceita: '2172', extensao: '' })).toBe('2172');
        expect(chaveDebito({ codigo: '' })).toBeNull();
    });

    it('chaves da guia não repetem', () => {
        expect(chavesDaGuia([{ codigo: '2172' }, { codigo: '2172' }, { codigo: '8109' }]))
            .toEqual(['2172', '8109']);
    });

    it('só email-graph e whatsapp-api provam envio (regra de 05/08)', () => {
        expect(canalProvaEnvio('email-graph')).toBe(true);
        expect(canalProvaEnvio('whatsapp-api')).toBe(true);
        expect(canalProvaEnvio('email-app')).toBe(false);
        expect(canalProvaEnvio(undefined)).toBe(false);
    });
});

describe('🚨 o caso HYPE: o Fiscal já mandou PIS/COFINS, o DP vai mandar o unificado', () => {
    it('acusa os DOIS débitos repetidos e diz quem mandou antes', () => {
        const c = conferirDebitosJaEnviados({ debitosDaGuia: GUIA_HYPE, enviosAnteriores: [envio()] });
        expect(c.bloqueia).toBe(true);
        expect(c.temRepetidoComProva).toBe(true);
        expect(c.repetidos.map((r: any) => r.chave).sort()).toEqual(['2172', '8109']);
        // O 1082 NÃO repete — é a primeira vez que ele sai.
        expect(c.repetidos.some((r: any) => r.chave === '1082')).toBe(false);
    });

    it('o aviso nomeia o quê, quem, quando e o canal', () => {
        const a = avisoDeRepeticao(conferirDebitosJaEnviados({
            debitosDaGuia: GUIA_HYPE, enviosAnteriores: [envio()],
        }))!;
        expect(a.severidade).toBe('erro');
        expect(a.titulo).toMatch(/JÁ FOI ENVIADO AO CLIENTE/);
        expect(a.texto).toContain('2172');
        expect(a.texto).toContain('fiscal@spassessoriacontabil.com.br');
        expect(a.texto).toMatch(/com prova de envio/);
        expect(a.acao).toMatch(/DUAS VEZES/);
        // Reenvio LEGÍTIMO existe — a trava tem saída, com motivo escrito.
        expect(a.acao).toMatch(/diga o motivo/);
    });

    it('guia sem débito repetido passa limpa', () => {
        const c = conferirDebitosJaEnviados({
            debitosDaGuia: [{ codigo: '1082', valor: 201.71 }],
            enviosAnteriores: [envio()],
        });
        expect(c.bloqueia).toBe(false);
        expect(avisoDeRepeticao(c)).toBeNull();
    });

    it('sem envio anterior não há o que barrar', () => {
        const c = conferirDebitosJaEnviados({ debitosDaGuia: GUIA_HYPE, enviosAnteriores: [] });
        expect(c.bloqueia).toBe(false);
        expect(c.incerto).toBe(false);
    });
});

describe('canal que NÃO prova envio vai marcado — não vale o mesmo peso', () => {
    it('email-app barra, mas dizendo que o cliente pode nunca ter recebido', () => {
        // Tratar mailto igual a Graph faria o app barrar um primeiro envio de
        // verdade por causa de uma janela que alguém abriu e fechou.
        const c = conferirDebitosJaEnviados({
            debitosDaGuia: GUIA_HYPE, enviosAnteriores: [envio({ canal: 'email-app' })],
        });
        expect(c.bloqueia).toBe(true);
        expect(c.temRepetidoComProva).toBe(false);
        const a = avisoDeRepeticao(c)!;
        expect(a.severidade).toBe('atencao');
        expect(a.texto).toMatch(/NÃO prova que a mensagem saiu/);
        expect(a.acao).toMatch(/pode ser que o cliente nunca tenha/);
    });
});

describe('valor diferente é sinal de RETIFICAÇÃO — o app diz os dois números', () => {
    it('nomeia antes e depois, e não escolhe', () => {
        const c = conferirDebitosJaEnviados({
            debitosDaGuia: [{ codigo: '2172', valor: 700.00 }],
            enviosAnteriores: [envio({ debitos: [{ codigo: '2172', valor: 591.68 }] })],
        });
        const r = c.repetidos[0]!;
        expect(r.valorMudou).toBe(true);
        expect(r.valorAntes).toBeCloseTo(591.68, 2);
        expect(r.valorAgora).toBeCloseTo(700, 2);
        expect(avisoDeRepeticao(c)!.texto).toMatch(/o valor MUDOU \(retificação\?\)/);
    });

    it('centavo igual não vira "mudou"', () => {
        const c = conferirDebitosJaEnviados({
            debitosDaGuia: [{ codigo: '2172', valor: 591.68 }],
            enviosAnteriores: [envio({ debitos: [{ codigo: '2172', valor: 591.68 }] })],
        });
        expect(c.repetidos[0]!.valorMudou).toBe(false);
    });
});

describe('🚨 envio ANTIGO sem composição não vira "nunca foi enviado"', () => {
    it('vira RESSALVA nomeada — ausência de registro não é prova de ausência', () => {
        // A auditoria só passou a guardar a composição em 17/08. Registro velho
        // PODE conter estes débitos e não dá para saber; some da conta seria
        // afirmar que nunca saiu, que é justamente o que dobra a cobrança.
        const c = conferirDebitosJaEnviados({
            debitosDaGuia: GUIA_HYPE,
            enviosAnteriores: [envio({ debitos: null })],
        });
        expect(c.bloqueia).toBe(false);      // não há prova de repetição
        expect(c.incerto).toBe(true);        // mas também não há prova do contrário
        const a = avisoDeRepeticao(c)!;
        expect(a.severidade).toBe('atencao');
        expect(a.titulo).toMatch(/Não dá para afirmar/);
        expect(a.acao).toMatch(/Confira com o outro departamento/);
    });

    it('o próprio registro do reenvio é pulado pelo logId', () => {
        const c = conferirDebitosJaEnviados({
            debitosDaGuia: GUIA_HYPE, enviosAnteriores: [envio({ id: 'meu' })], logIdAtual: 'meu',
        });
        expect(c.bloqueia).toBe(false);
    });
});

describe('🚨 a trava está NO CAMINHO do envio, e o dado chega até a auditoria', () => {
    const tela = readFileSync(join(__dirname, '..', 'components/DCTFWeb/DetalheDeclaracao.tsx'), 'utf8');
    const rotas = readFileSync(join(__dirname, '..', 'sefaz-backend/envio-imposto-routes.js'), 'utf8');
    const rito = readFileSync(join(__dirname, '..', 'sefaz-backend/envio-imposto.js'), 'utf8');
    const servico = readFileSync(join(__dirname, '..', 'services/envioImpostoService.ts'), 'utf8');

    it('a porta do envio consulta a auditoria antes de deixar sair', () => {
        expect(tela).toMatch(/perguntarDebitosJaEnviados\(\{/);
        // Reenvio exige MOTIVO escrito — bloqueio puro é trava que se contorna.
        expect(tela).toMatch(/limpo\.length < 15/);
        expect(tela).toMatch(/setReenvioMotivo\(limpo\)/);
    });

    it('🚨 falha na consulta NÃO libera calado', () => {
        expect(tela).toMatch(/NÃO FOI POSSÍVEL CONFERIR se estes débitos já foram enviados/);
        expect(servico).toMatch(/indeterminado: true/);
    });

    it('🚨 a COMPOSIÇÃO viaja nos TRÊS envios — senão a trava de amanhã não tem o que comparar', () => {
        // Lição do #382: campo novo que a rota não repassa é descartado EM
        // SILÊNCIO. Aqui o silêncio significa cobrança dobrada no mês seguinte.
        const ocorrencias = (tela.match(/debitos: debitosParaAuditoria\(\)/g) || []).length;
        expect(ocorrencias).toBe(3);
        const naRota = (rotas.match(/debitos: req\.body\?\.debitos/g) || []).length;
        expect(naRota).toBe(3);
        expect(rito).toMatch(/debitos: Array\.isArray\(p\.debitos\)/);
        expect(rito).toMatch(/reenvioMotivo:/);
    });

    it('a rota exige carteira e não aceita competência em branco', () => {
        expect(rotas).toMatch(/debitos-ja-enviados/);
        expect(rotas).toMatch(/podeAcessarCnpj\(req\.user, cnpj\)/);
        expect(rotas).toMatch(/Informe cnpj e competencia/);
    });
});
