/**
 * FASE 3 DO TÚNEL: "DÁ PRA TRANSMITIR?" — respondido sem mover a chave.
 *
 * O que estes testes trancam, em ordem de gravidade:
 *
 * 1. A CHAVE NÃO SAI. `storagePath` e `passwordEnc` não podem aparecer na
 *    resposta em NENHUM caminho — nem no apto, nem no vencido, nem no
 *    incompleto. Chave copiada é chave que não se controla mais.
 * 2. FILIAL COM O CERT DA MATRIZ É APTA (regra da raiz, 27/07 — J.N. VINATEX).
 *    Um túnel que dissesse "não tem cert" faria o outro app deixar de
 *    transmitir por impedimento que não existe.
 * 3. AUSÊNCIA NUNCA VIRA APTIDÃO, e "cadastrado" nunca vira "assina".
 */
// @ts-expect-error — módulo .js puro (sem tipos)
import { aptidaoDeAssinatura, montarCertificados, metadadoDoCertificado, titularDoSubject } from '../sefaz-backend/cadastro-central-certificados';

const AGORA = new Date('2026-08-07T12:00:00Z');
const emDias = (d: number) => new Date(AGORA.getTime() + d * 86400000).toISOString();

/** Como o doc vem de `empresas_certificados` — com as partes sigilosas. */
const cert = (over: any = {}) => ({
    empresaId: 'e1',
    tipoCert: 'A1',
    cnpj: '51227692000146',
    subject: 'CN=CLINIPAR LTDA:51227692000146, OU=Autenticado, O=ICP-Brasil',
    issuer: 'CN=AC Certisign RFB G5, O=ICP-Brasil',
    notBefore: emDias(-300),
    notAfter: emDias(200),
    fingerprint: 'ab:cd:ef',
    storagePath: 'certs/e1.pfx.enc',
    passwordEnc: 'c2VuaGEtc3VwZXItc2VjcmV0YQ==',
    sizeBytes: 4096,
    ...over,
});

describe('🔒 a chave NUNCA sai do CFI', () => {
    it('o metadado não carrega arquivo, senha nem tamanho', () => {
        const m = metadadoDoCertificado(cert(), AGORA);
        expect(m).not.toHaveProperty('storagePath');
        expect(m).not.toHaveProperty('passwordEnc');
        expect(m).not.toHaveProperty('sizeBytes');
        // Só a EXISTÊNCIA das partes sigilosas, que é o que responde "assina?".
        expect(m.temArquivo).toBe(true);
        expect(m.temSenha).toBe(true);
    });

    it('nenhum caminho da resposta vaza o segredo — nem o de erro', () => {
        const casos = [
            cert(),                                     // apto
            cert({ notAfter: emDias(-1) }),             // vencido
            cert({ passwordEnc: null }),                // incompleto
            cert({ tipoCert: 'A3' }),                   // A3
        ];
        for (const c of casos) {
            const serializado = JSON.stringify(aptidaoDeAssinatura({
                cnpj: '51227692000146', certificados: [c], agora: AGORA,
            }));
            expect(serializado).not.toContain('certs/e1.pfx.enc');
            expect(serializado).not.toContain('c2VuaGEtc3VwZXItc2VjcmV0YQ==');
            expect(serializado).not.toMatch(/passwordEnc|storagePath/);
        }
    });

    it('o que sai identifica sem revelar', () => {
        const m = metadadoDoCertificado(cert(), AGORA);
        expect(m.titular).toBe('CLINIPAR LTDA:51227692000146');
        expect(m.emissor).toMatch(/Certisign/);
        expect(m.fingerprint).toBe('ab:cd:ef');
        expect(m.raiz).toBe('51227692');
    });

    it('subject sem CN não estoura e não inventa titular', () => {
        expect(titularDoSubject(null)).toBeNull();
        expect(titularDoSubject('O=ICP-Brasil')).toBe('O=ICP-Brasil');
    });
});

describe('a pergunta que o outro app faz: dá pra transmitir?', () => {
    const perguntar = (certs: any[], cnpj = '51227692000146') =>
        aptidaoDeAssinatura({ cnpj, certificados: certs, agora: AGORA });

    it('A1 válido: apto, e diz até quando', () => {
        const r = perguntar([cert()]);
        expect(r.apto).toBe(true);
        expect(r.situacao).toBe('apto-proprio');
        expect(r.motivo).toMatch(/válido até/);
        expect(r.acao).toBeNull();
    });

    it('apto mas vencendo: continua apto E já manda renovar', () => {
        // Farol honesto: apto hoje não é "está tudo bem".
        const r = perguntar([cert({ notAfter: emDias(12) })]);
        expect(r.apto).toBe(true);
        expect(r.certificado.faixaAlerta).toBe('15');
        expect(r.acao).toMatch(/providencie a renovação/);
    });

    it('vencido: NÃO é "sem certificado" — é outro problema, com outra ação', () => {
        const r = perguntar([cert({ notAfter: emDias(-3) })]);
        expect(r.apto).toBe(false);
        expect(r.situacao).toBe('vencido');
        expect(r.acao).toMatch(/Renove o A1/);
        expect(r.motivo).toMatch(/VENCIDO/);
    });

    it('A3 é token físico: não assina em servidor, e a ação diz o que fazer', () => {
        const r = perguntar([cert({ tipoCert: 'A3', storagePath: null, passwordEnc: null })]);
        expect(r.situacao).toBe('a3-nao-assina-em-nuvem');
        expect(r.acao).toMatch(/transmissão\s+é manual/);
    });

    it('cadastro pela metade não passa por cadastrado', () => {
        // É o pior dos dois mundos: aparece cadastrado e não assina.
        const r = perguntar([cert({ passwordEnc: null })]);
        expect(r.situacao).toBe('cadastro-incompleto');
        expect(r.motivo).toMatch(/falta a senha/);
    });

    it('sem nada cadastrado: ausência não vira aptidão', () => {
        const r = perguntar([]);
        expect(r.apto).toBe(false);
        expect(r.situacao).toBe('sem-certificado');
        expect(r.acao).toMatch(/Suba o A1/);
    });
});

describe('A REGRA DA RAIZ: filial usa o certificado da matriz', () => {
    // Caso J.N. VINATEX (27/07): filial 0002-78 sem cert próprio, matriz
    // 0001-89 com A1 válido. Dizer "não tem cert" faria o outro app deixar de
    // transmitir por impedimento que não existe.
    const MATRIZ = '44388152000189';
    const FILIAL = '44388152000278';
    const certMatriz = cert({ empresaId: 'matriz', cnpj: MATRIZ, subject: 'CN=SP ASSESSORIA' });

    it('filial sem cert próprio é APTA pelo cert da matriz', () => {
        const r = aptidaoDeAssinatura({ cnpj: FILIAL, certificados: [certMatriz], agora: AGORA });
        expect(r.apto).toBe(true);
        expect(r.situacao).toBe('apto-pela-raiz');
    });

    it('e a resposta diz DE QUEM é o certificado — assinar por terceiro não é dedução', () => {
        const r = aptidaoDeAssinatura({ cnpj: FILIAL, certificados: [certMatriz], agora: AGORA });
        expect(r.motivo).toContain(MATRIZ);
        expect(r.motivo).toMatch(/SP ASSESSORIA/);
        expect(r.certificadoDaRaiz.cnpj).toBe(MATRIZ);
        expect(r.certificado).toBeNull();
    });

    it('cert da matriz VENCIDO não socorre a filial', () => {
        const r = aptidaoDeAssinatura({
            cnpj: FILIAL, certificados: [cert({ cnpj: MATRIZ, notAfter: emDias(-1) })], agora: AGORA,
        });
        expect(r.apto).toBe(false);
        expect(r.situacao).toBe('sem-certificado');
    });

    it('cert de OUTRA raiz não vale — é outro contribuinte', () => {
        const r = aptidaoDeAssinatura({
            cnpj: FILIAL, certificados: [cert({ cnpj: '11111111000191' })], agora: AGORA,
        });
        expect(r.apto).toBe(false);
    });

    it('o próprio VÁLIDO vence o da raiz — quem assina é o dono', () => {
        const r = aptidaoDeAssinatura({
            cnpj: FILIAL,
            certificados: [certMatriz, cert({ cnpj: FILIAL, subject: 'CN=FILIAL' })],
            agora: AGORA,
        });
        expect(r.situacao).toBe('apto-proprio');
        expect(r.certificado.cnpj).toBe(FILIAL);
    });

    it('entre dois da raiz, vale o que vence MAIS TARDE (mesma escolha de quem assina)', () => {
        const r = aptidaoDeAssinatura({
            cnpj: FILIAL,
            certificados: [
                cert({ empresaId: 'a', cnpj: MATRIZ, notAfter: emDias(10), fingerprint: 'curto' }),
                cert({ empresaId: 'b', cnpj: '44388152000359', notAfter: emDias(300), fingerprint: 'longo' }),
            ],
            agora: AGORA,
        });
        expect(r.certificadoDaRaiz.fingerprint).toBe('longo');
    });
});

describe('o panorama do cadastro', () => {
    const empresas = [
        { id: 'e1', cnpj: '51227692000146', nome: 'CLINIPAR', regime: 'simples' },
        { id: 'e2', cnpj: '44388152000189', nome: 'SP ASSESSORIA', regime: 'lucro' },
        { id: 'e3', cnpj: '44388152000278', nome: 'SP FILIAL', regime: 'lucro' },
    ];

    it('empresa SEM certificado não some — é ela que engana quem olha o total', () => {
        const r = montarCertificados({ empresas, certificados: [], agora: AGORA });
        expect(r.linhas).toHaveLength(3);
        expect(r.resumo.aptas).toBe(0);
        expect(r.resumo.semCertificado).toBe(3);
    });

    it('conta a filial apta pela raiz em separado — não é a mesma coisa que ter o seu', () => {
        const r = montarCertificados({
            empresas, certificados: [cert({ cnpj: '44388152000189', empresaId: 'e2' })], agora: AGORA,
        });
        expect(r.resumo.aptas).toBe(2);
        expect(r.resumo.aptasPelaRaiz).toBe(1);
        expect(r.avisos.join(' ')).toMatch(/regra da matriz/);
    });

    it('vencendo em 30 dias é contado mesmo estando apto', () => {
        const r = montarCertificados({
            empresas: [empresas[0]], certificados: [cert({ notAfter: emDias(9) })], agora: AGORA,
        });
        expect(r.resumo.aptas).toBe(1);
        expect(r.resumo.vencendoEm30Dias).toBe(1);
        expect(r.avisos.join(' ')).toMatch(/vencem em até 30 dias/);
    });

    it('o aviso da chave está SEMPRE lá — é o contrato do túnel', () => {
        const r = montarCertificados({ empresas, certificados: [], agora: AGORA });
        expect(r.avisos[0]).toMatch(/chave privada NUNCA trafega/);
    });

    it('cadastro vazio é falha de leitura, não escritório sem clientes', () => {
        expect(montarCertificados().avisos.join(' ')).toMatch(/falha de leitura/);
    });
});
