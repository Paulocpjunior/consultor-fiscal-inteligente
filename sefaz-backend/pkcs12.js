// ============================================================================
// sefaz-backend/pkcs12.js  (PURO — só o `crypto` do Node, sem dependência)
// ----------------------------------------------------------------------------
// O LEITOR DE .PFX DO CFI (PKCS#12, RFC 7292) — e o ÚNICO.
//
// Até 03/10 o CFI abria o A1 com o node-forge, em CINCO cópias do mesmo laço
// (secret-loader, pfx-to-pem, cert-manager, cert-storage, abrasf). Em 02/10 o
// node-forge ganhou o advisory high GHSA-86w9-cpqp-85rv, SEM versão corrigida,
// e o deploy travou; o Paulo aceitou o risco com prazo e, em 03/10, pediu a
// troca definitiva ("resolva de forma definitiva"). Este módulo é a troca.
//
// ═══ O QUE É DO NODE E O QUE É DAQUI ════════════════════════════════════════
//
// Toda a criptografia que o OpenSSL do Node oferece vem dele: 3DES, AES,
// PBKDF2, HMAC, SHA, a leitura da chave (createPrivateKey) e a conferência
// chave × certificado (X509Certificate.checkPrivateKey). Daqui são só:
//   · a leitura do ASN.1 (DER, e o BER de comprimento indefinido que alguns
//     exportadores usam);
//   · a derivação de chave do PKCS#12 (RFC 7292, apêndice B — o Node não tem);
//   · o RC2 (RFC 2268), porque o OpenSSL 3 tirou o RC2 do provider padrão e
//     MUITO A1 da ICP-Brasil exportado pelo Windows cifra o certificado com
//     RC2-40. Sem ele, esses clientes ficariam sem captura.
//
// 🚨 SENHA ERRADA É DITA COMO SENHA ERRADA. O MAC do arquivo é conferido antes
// de decifrar qualquer coisa, e a mensagem mantém a frase que as rotas já
// classificam ("PKCS#12 MAC could not be verified. Invalid password?") — a
// tela continua mostrando "Senha incorreta" no lugar certo.
//
// 🚨 A CHAVE TEM DE SER DO CERTIFICADO. A folha é o certificado que casa com a
// chave privada (checkPrivateKey), não "o primeiro da lista". PFX com chave
// que não casa com nenhum certificado é recusado: assinar com ele produziria
// assinatura que a SEFAZ rejeita, e o erro apareceria longe da causa.
// ============================================================================
// Namespace (não default): o mesmo import roda no Node ESM e no jest (CJS).
import * as crypto from 'node:crypto';

/** Erro de leitura do .pfx, com `codigo` para quem precisa classificar. */
export class ErroPfx extends Error {
    constructor(codigo, mensagem) {
        super(mensagem);
        this.name = 'ErroPfx';
        this.codigo = codigo;
    }
}

const invalido = (detalhe) => new ErroPfx('PFX_INVALIDO', `PKCS#12 inválido: ${detalhe}`);
const senhaIncorreta = () => new ErroPfx(
    'SENHA_INCORRETA',
    'Senha incorreta — PKCS#12 MAC could not be verified. Invalid password?',
);

// ── ASN.1 (DER + BER indefinido) ────────────────────────────────────────────

/** Lê um TLV em `buf[pos]`. Nó construído já vem com os filhos lidos. */
function lerNo(buf, pos) {
    if (pos + 2 > buf.length) throw invalido('fim inesperado do arquivo');
    const tag = buf[pos];
    if ((tag & 0x1f) === 0x1f) throw invalido('marcação ASN.1 estendida não esperada');
    const construido = (tag & 0x20) !== 0;
    let p = pos + 1;
    let len = buf[p++];
    if (len === 0x80) {
        // BER de comprimento indefinido: filhos até o marcador 00 00.
        if (!construido) throw invalido('comprimento indefinido em valor primitivo');
        const filhos = [];
        while (true) {
            if (p + 2 > buf.length) throw invalido('fim inesperado do arquivo');
            if (buf[p] === 0 && buf[p + 1] === 0) break;
            const f = lerNo(buf, p);
            filhos.push(f);
            p = f.fim;
        }
        return { tag, construido, inicio: pos, fim: p + 2, buf, valor: null, filhos };
    }
    if (len & 0x80) {
        const n = len & 0x7f;
        if (n === 0 || n > 4 || p + n > buf.length) throw invalido('comprimento ASN.1 inválido');
        len = 0;
        for (let i = 0; i < n; i++) len = len * 256 + buf[p++];
    }
    const fim = p + len;
    if (fim > buf.length) throw invalido('comprimento ASN.1 além do fim do arquivo');
    const valor = buf.subarray(p, fim);
    let filhos = null;
    if (construido) {
        filhos = [];
        let q = p;
        while (q < fim) {
            const f = lerNo(buf, q);
            filhos.push(f);
            q = f.fim;
        }
        if (q !== fim) throw invalido('estrutura ASN.1 desalinhada');
    }
    return { tag, construido, inicio: pos, fim, buf, valor, filhos };
}

/** Lê um buffer que deve conter exatamente UM nó ASN.1. */
function lerDer(buf) {
    const no = lerNo(buf, 0);
    if (no.fim !== buf.length) throw invalido('sobra de bytes após a estrutura ASN.1');
    return no;
}

function filhosDe(no, minimo = 0) {
    if (!no || !no.filhos) throw invalido('estrutura ASN.1 inesperada');
    if (no.filhos.length < minimo) throw invalido('estrutura ASN.1 incompleta');
    return no.filhos;
}

/** Bytes do nó como veio no arquivo (para createPrivateKey / X509Certificate). */
const bytesDoNo = (no) => no.buf.subarray(no.inicio, no.fim);

/** Conteúdo de OCTET STRING — primitiva ou em pedaços (BER construído). */
function octetos(no) {
    if (!no.construido) return no.valor;
    return Buffer.concat(no.filhos.map(octetos));
}

function lerOid(no) {
    if (!no || no.tag !== 0x06 || !no.valor?.length) throw invalido('identificador de objeto esperado');
    const b = no.valor;
    const partes = [];
    let v = 0;
    for (let i = 0; i < b.length; i++) {
        v = v * 128 + (b[i] & 0x7f);
        if (!(b[i] & 0x80)) {
            if (partes.length === 0) {
                const primeiro = v < 40 ? 0 : v < 80 ? 1 : 2;
                partes.push(primeiro, v - primeiro * 40);
            } else partes.push(v);
            v = 0;
        }
    }
    return partes.join('.');
}

function lerInteiro(no) {
    if (!no || no.tag !== 0x02) throw invalido('inteiro esperado');
    let v = 0;
    for (const byte of no.valor) v = v * 256 + byte;
    return v;
}

function lerTexto(no) {
    const b = no.valor || Buffer.alloc(0);
    switch (no.tag) {
        case 0x0c: return b.toString('utf8');                       // UTF8String
        case 0x1e: return Buffer.from(b).swap16().toString('utf16le'); // BMPString
        case 0x14: return b.toString('latin1');                     // T61String
        default: return b.toString('latin1');                       // Printable/IA5/Numeric
    }
}

function lerData(no) {
    const s = no.valor.toString('latin1');
    let m;
    if (no.tag === 0x17 && (m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?Z$/.exec(s))) {
        const aa = Number(m[1]);
        return new Date(Date.UTC(aa < 50 ? 2000 + aa : 1900 + aa, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)));
    }
    if (no.tag === 0x18 && (m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\.\d+)?Z$/.exec(s))) {
        return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)));
    }
    throw invalido(`data do certificado em formato não reconhecido (${s})`);
}

// ── Certificado X.509 ───────────────────────────────────────────────────────

/** Nomes dos atributos de DN, com as mesmas grafias que o código já lia. */
const ATRIBUTOS_DN = {
    '2.5.4.3': ['CN', 'commonName'],
    '2.5.4.4': ['SN', 'surname'],
    '2.5.4.5': ['serialNumber', 'serialNumber'],
    '2.5.4.6': ['C', 'countryName'],
    '2.5.4.7': ['L', 'localityName'],
    '2.5.4.8': ['ST', 'stateOrProvinceName'],
    '2.5.4.9': ['street', 'streetAddress'],
    '2.5.4.10': ['O', 'organizationName'],
    '2.5.4.11': ['OU', 'organizationalUnitName'],
    '2.5.4.12': ['title', 'title'],
    '1.2.840.113549.1.9.1': ['E', 'emailAddress'],
};

function lerNome(no) {
    const attrs = [];
    for (const rdn of filhosDe(no)) {
        for (const atv of filhosDe(rdn)) {
            const [oidNo, valorNo] = filhosDe(atv, 2);
            const oid = lerOid(oidNo);
            const [shortName, name] = ATRIBUTOS_DN[oid] || [oid, oid];
            attrs.push({ oid, shortName, name, value: lerTexto(valorNo) });
        }
    }
    return attrs;
}

function derParaPem(der, rotulo) {
    const b64 = der.toString('base64').match(/.{1,64}/g).join('\n');
    return `-----BEGIN ${rotulo}-----\n${b64}\n-----END ${rotulo}-----\n`;
}

/**
 * Lê um certificado X.509 (DER ou PEM) com os campos que o CFI usa.
 *
 * @param {Buffer|string} entrada
 */
export function lerCertificado(entrada) {
    let der;
    if (Buffer.isBuffer(entrada)) der = entrada;
    else {
        const m = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(String(entrada || ''));
        if (!m) throw invalido('certificado PEM não encontrado');
        der = Buffer.from(m[1].replace(/\s+/g, ''), 'base64');
    }
    const cert = lerDer(der);
    const tbs = filhosDe(filhosDe(cert, 3)[0], 6);
    // [0] version é opcional: com ele, os campos andam uma posição.
    const d = tbs[0].tag === 0xa0 ? 1 : 0;
    const issuer = lerNome(tbs[2 + d]);
    const [nb, na] = filhosDe(tbs[3 + d], 2);
    const subject = lerNome(tbs[4 + d]);
    return {
        der,
        pem: derParaPem(der, 'CERTIFICATE'),
        subject,
        issuer,
        notBefore: lerData(nb),
        notAfter: lerData(na),
        fingerprintSha1: crypto.createHash('sha1').update(der).digest('hex'),
        fingerprintSha256: crypto.createHash('sha256').update(der).digest('hex'),
    };
}

/** Valor do primeiro atributo do DN pelo nome curto (CN, O, serialNumber…). */
export function campoDoNome(attrs, nomeCurto) {
    return (attrs || []).find((a) => a.shortName === nomeCurto || a.name === nomeCurto)?.value || '';
}

/** "CN=…, O=…" — a mesma forma de texto que as telas já mostravam. */
export function nomeComoTexto(attrs) {
    return (attrs || []).map((a) => `${a.shortName || a.name}=${a.value}`).join(', ');
}

// ── Derivação de chave do PKCS#12 (RFC 7292, apêndice B.2) ─────────────────

const HASH_POR_OID = {
    '1.3.14.3.2.26': 'sha1',
    '2.16.840.1.101.3.4.2.4': 'sha224',
    '2.16.840.1.101.3.4.2.1': 'sha256',
    '2.16.840.1.101.3.4.2.2': 'sha384',
    '2.16.840.1.101.3.4.2.3': 'sha512',
};

/** Senha como BMPString (UTF-16 big-endian) com o terminador 00 00. */
function senhaBmp(senha) {
    return Buffer.from(`${senha}\u0000`, 'utf16le').swap16();
}

function kdfPkcs12(hash, senha, salt, id, iteracoes, n) {
    const v = hash === 'sha384' || hash === 'sha512' ? 128 : 64;
    const repetir = (b) => {
        if (!b.length) return Buffer.alloc(0);
        const out = Buffer.alloc(v * Math.ceil(b.length / v));
        for (let i = 0; i < out.length; i++) out[i] = b[i % b.length];
        return out;
    };
    const D = Buffer.alloc(v, id);
    const I = Buffer.concat([repetir(salt), repetir(senha)]);
    const partes = [];
    let obtidos = 0;
    while (obtidos < n) {
        let A = crypto.createHash(hash).update(D).update(I).digest();
        for (let r = 1; r < iteracoes; r++) A = crypto.createHash(hash).update(A).digest();
        partes.push(A);
        obtidos += A.length;
        if (obtidos >= n) break;
        const B = repetir(A);
        for (let j = 0; j < I.length; j += v) {
            let vaiUm = 1;
            for (let k = v - 1; k >= 0; k--) {
                const s = I[j + k] + B[k] + vaiUm;
                I[j + k] = s & 0xff;
                vaiUm = s >> 8;
            }
        }
    }
    return Buffer.concat(partes).subarray(0, n);
}

// ── RC2 (RFC 2268) — só decifra, em CBC ─────────────────────────────────────

const PITABLE = Buffer.from(
    'd978f9c419ddb5ed28e9fd794aa0d89dc67e37832b76538e624c6488448bfba2'
    + '179a59f587b34f1361456d8d09817d32bd8f40eb86b77b0bf09521225c6b4e82'
    + '54d66593ce60b21c7356c014a78cf1dc1275ca1f3bbee4d1423dd430a33cb626'
    + '6fbf0eda4669075727f21d9bbc944303f811c7f690ef3ee706c3d52fc8661ed7'
    + '08e8eade8052eef784aa72ac354d6a2a961ad2715a1549744b9fd05e0418a4ec'
    + 'c2e0416e0f51cbcc2491af50a1f47039997c3a8523b8b47afc02365b25559731'
    + '2d5dfa98e38a92ae05df2910676cbac9d300e6cfe19ea82c6316013f58e289a9'
    + '0d38341bab33ffb0bb480c5fb9b1cd2ec5f3db47e5a59c770aa62068fe7fc1ad',
    'hex',
);

function rc2ExpandirChave(chave, bitsEfetivos) {
    const L = Buffer.alloc(128);
    chave.copy(L);
    const T = chave.length;
    const T8 = (bitsEfetivos + 7) >> 3;
    const TM = 0xff >> (8 * T8 - bitsEfetivos);
    for (let i = T; i < 128; i++) L[i] = PITABLE[(L[i - 1] + L[i - T]) & 0xff];
    L[128 - T8] = PITABLE[L[128 - T8] & TM];
    for (let i = 127 - T8; i >= 0; i--) L[i] = PITABLE[L[i + 1] ^ L[i + T8]];
    const K = new Uint16Array(64);
    for (let i = 0; i < 64; i++) K[i] = L[2 * i] | (L[2 * i + 1] << 8);
    return K;
}

function rc2DecifrarBloco(K, bloco) {
    const R = [bloco.readUInt16LE(0), bloco.readUInt16LE(2), bloco.readUInt16LE(4), bloco.readUInt16LE(6)];
    const S = [1, 2, 3, 5];
    let j = 63;
    const misturaReversa = () => {
        for (let i = 3; i >= 0; i--) {
            const r = R[i];
            R[i] = ((r >>> S[i]) | (r << (16 - S[i]))) & 0xffff;
            R[i] = (R[i] - K[j--] - (R[(i + 3) & 3] & R[(i + 2) & 3]) - (~R[(i + 3) & 3] & R[(i + 1) & 3])) & 0xffff;
        }
    };
    const amassoReverso = () => {
        for (let i = 3; i >= 0; i--) R[i] = (R[i] - K[R[(i + 3) & 3] & 63]) & 0xffff;
    };
    for (let n = 0; n < 5; n++) misturaReversa();
    amassoReverso();
    for (let n = 0; n < 6; n++) misturaReversa();
    amassoReverso();
    for (let n = 0; n < 5; n++) misturaReversa();
    const out = Buffer.alloc(8);
    R.forEach((w, i) => out.writeUInt16LE(w, i * 2));
    return out;
}

/** RC2 em ECB, um bloco — exposto só para a trava conferir os vetores da RFC. */
export function rc2DecifrarBlocoParaTeste(chave, bitsEfetivos, bloco) {
    return rc2DecifrarBloco(rc2ExpandirChave(chave, bitsEfetivos), bloco);
}

function tirarPreenchimento(dados) {
    const n = dados[dados.length - 1];
    if (!dados.length || n < 1 || n > 8 || n > dados.length) throw senhaIncorreta();
    for (let i = dados.length - n; i < dados.length; i++) if (dados[i] !== n) throw senhaIncorreta();
    return dados.subarray(0, dados.length - n);
}

function rc2DecifrarCbc(chave, bitsEfetivos, iv, dados) {
    if (dados.length % 8 !== 0) throw senhaIncorreta();
    const K = rc2ExpandirChave(chave, bitsEfetivos);
    const out = Buffer.alloc(dados.length);
    let anterior = iv;
    for (let p = 0; p < dados.length; p += 8) {
        const c = dados.subarray(p, p + 8);
        const d = rc2DecifrarBloco(K, c);
        for (let i = 0; i < 8; i++) out[p + i] = d[i] ^ anterior[i];
        anterior = c;
    }
    return tirarPreenchimento(out);
}

// ── Cifras do PKCS#12 e do PBES2 ────────────────────────────────────────────

/** pbeWithSHAAnd…: [chave em bytes, cifra do Node | RC2 com bits efetivos]. */
const PBE_PKCS12 = {
    '1.2.840.113549.1.12.1.3': { tamChave: 24, cifra: 'des-ede3-cbc' },
    '1.2.840.113549.1.12.1.4': { tamChave: 16, cifra: 'des-ede-cbc' },
    '1.2.840.113549.1.12.1.5': { tamChave: 16, rc2: 128 },
    '1.2.840.113549.1.12.1.6': { tamChave: 5, rc2: 40 },
};

const PRF_POR_OID = {
    '1.2.840.113549.2.7': 'sha1',
    '1.2.840.113549.2.8': 'sha224',
    '1.2.840.113549.2.9': 'sha256',
    '1.2.840.113549.2.10': 'sha384',
    '1.2.840.113549.2.11': 'sha512',
};

const CIFRA_PBES2 = {
    '2.16.840.1.101.3.4.1.2': { cifra: 'aes-128-cbc', tamChave: 16 },
    '2.16.840.1.101.3.4.1.22': { cifra: 'aes-192-cbc', tamChave: 24 },
    '2.16.840.1.101.3.4.1.42': { cifra: 'aes-256-cbc', tamChave: 32 },
    '1.2.840.113549.3.7': { cifra: 'des-ede3-cbc', tamChave: 24 },
    // DES simples: só com o provider legado do OpenSSL (o Dockerfile liga).
    '1.3.14.3.2.7': { cifra: 'des-cbc', tamChave: 8 },
};

/**
 * Senha com acento tem duas leituras em PFX do mundo real: a certa (UTF-8 no
 * PBES2, UTF-16 no PKCS#12) e a dos exportadores que tratam cada caractere
 * como um byte. O OpenSSL tenta as duas; aqui também — senão o cliente com
 * "ç" na senha ouviria "senha incorreta" com a senha certa.
 */
function leiturasDaSenha(senha) {
    const leituras = [senha];
    if (/[^\x00-\x7f]/.test(senha)) {
        if (!/[^\x00-\xff]/.test(senha)) leituras.push(Buffer.from(senha, 'latin1').toString('utf8'));
        leituras.push(Buffer.from(senha, 'utf8').toString('latin1'));
    }
    return [...new Set(leituras)];
}

function decifrarNode(cifra, chave, iv, dados) {
    try {
        const d = crypto.createDecipheriv(cifra, chave, iv);
        return Buffer.concat([d.update(dados), d.final()]);
    } catch (e) {
        if (/bad decrypt|wrong final block length/i.test(String(e?.message))) throw senhaIncorreta();
        throw invalido(`a cifra ${cifra} falhou (${e?.message || e})`);
    }
}

/**
 * Decifra um conteúdo protegido por senha. `ctx.senha` é a senha em texto e
 * `ctx.bmp` a forma BMPString que o MAC confirmou (vale para os PBE do PKCS#12).
 */
function decifrar(algNo, dados, ctx) {
    const [oidNo, paramsNo] = filhosDe(algNo, 1);
    const oid = lerOid(oidNo);
    const pbe = PBE_PKCS12[oid];
    if (pbe) {
        const [saltNo, iterNo] = filhosDe(paramsNo, 2);
        const salt = octetos(saltNo);
        const iter = lerInteiro(iterNo);
        const chave = kdfPkcs12('sha1', ctx.bmp, salt, 1, iter, pbe.tamChave);
        const iv = kdfPkcs12('sha1', ctx.bmp, salt, 2, iter, 8);
        return pbe.rc2 ? rc2DecifrarCbc(chave, pbe.rc2, iv, dados) : decifrarNode(pbe.cifra, chave, iv, dados);
    }
    if (oid === '1.2.840.113549.1.5.13') {
        const [kdfNo, encNo] = filhosDe(paramsNo, 2);
        const [kdfOidNo, kdfParamsNo] = filhosDe(kdfNo, 2);
        if (lerOid(kdfOidNo) !== '1.2.840.113549.1.5.12') throw invalido('PBES2 com derivação de chave que não é PBKDF2');
        const kp = filhosDe(kdfParamsNo, 2);
        if (kp[0].tag !== 0x04) throw invalido('PBKDF2 com salt em formato não suportado');
        const salt = octetos(kp[0]);
        const iter = lerInteiro(kp[1]);
        let tamChave = null;
        let prf = 'sha1';
        for (const extra of kp.slice(2)) {
            if (extra.tag === 0x02) tamChave = lerInteiro(extra);
            else if (extra.tag === 0x30) {
                const prfOid = lerOid(filhosDe(extra, 1)[0]);
                prf = PRF_POR_OID[prfOid];
                if (!prf) throw invalido(`PBKDF2 com função ${prfOid} não suportada`);
            }
        }
        const [encOidNo, ivNo] = filhosDe(encNo, 2);
        const encOid = lerOid(encOidNo);
        const enc = CIFRA_PBES2[encOid];
        if (!enc) throw invalido(`PBES2 com cifra ${encOid} não suportada`);
        // PBES2 dentro do PKCS#12 usa a senha em bytes (não a BMPString):
        // UTF-8 é o certo; a leitura byte-a-byte cobre o exportador antigo.
        // Só vale a tentativa cujo resultado é ASN.1 legível — preenchimento
        // "certo" por acaso (1 em 256) não passa por aqui.
        const iv = octetos(ivNo);
        const candidatos = [Buffer.from(ctx.senha, 'utf8')];
        if (/[^\x00-\x7f]/.test(ctx.senha) && !/[^\x00-\xff]/.test(ctx.senha)) candidatos.push(Buffer.from(ctx.senha, 'latin1'));
        for (const bytes of candidatos) {
            const chave = crypto.pbkdf2Sync(bytes, salt, iter, tamChave || enc.tamChave, prf);
            let claro;
            try {
                // Cifra indisponível (ex.: DES sem o provider legado) sai
                // daqui com o nome dela — isso não é senha errada.
                claro = decifrarNode(enc.cifra, chave, iv, dados);
                lerDer(claro);
                return claro;
            } catch (e) {
                if (e?.codigo === 'PFX_INVALIDO' && claro === undefined) throw e;
            }
        }
        throw senhaIncorreta();
    }
    throw invalido(`algoritmo de cifra não suportado (${oid})`);
}

// ── MAC do arquivo (a conferência da senha) ─────────────────────────────────

/**
 * Confere o MAC e devolve a forma da senha que o confirmou. Senha vazia tem
 * duas leituras no mundo real (só o terminador, ou nada) — as duas valem.
 */
function conferirMac(macNo, conteudo, senha) {
    const [digestInfo, saltNo, iterNo] = filhosDe(macNo, 2);
    const [algNo, digestNo] = filhosDe(digestInfo, 2);
    const oid = lerOid(filhosDe(algNo, 1)[0]);
    if (oid === '1.2.840.113549.1.5.14') throw invalido('MAC no formato PBMAC1, ainda não suportado');
    const hash = HASH_POR_OID[oid];
    if (!hash) throw invalido(`MAC com resumo ${oid} não suportado`);
    const salt = octetos(saltNo);
    const iter = iterNo ? lerInteiro(iterNo) : 1;
    const esperado = octetos(digestNo);
    const tentativas = senha === '' ? [senhaBmp(''), Buffer.alloc(0)] : leiturasDaSenha(senha).map(senhaBmp);
    for (const bmp of tentativas) {
        const chave = kdfPkcs12(hash, bmp, salt, 3, iter, crypto.createHash(hash).digest().length);
        const obtido = crypto.createHmac(hash, chave).update(conteudo).digest();
        if (obtido.length === esperado.length && crypto.timingSafeEqual(obtido, esperado)) return bmp;
    }
    throw senhaIncorreta();
}

// ── Bolsas (SafeBags) ───────────────────────────────────────────────────────

const OID_DATA = '1.2.840.113549.1.7.1';
const OID_ENCRYPTED_DATA = '1.2.840.113549.1.7.6';
const BAG_KEY = '1.2.840.113549.1.12.10.1.1';
const BAG_SHROUDED_KEY = '1.2.840.113549.1.12.10.1.2';
const BAG_CERT = '1.2.840.113549.1.12.10.1.3';
const BAG_SAFE_CONTENTS = '1.2.840.113549.1.12.10.1.6';
const CERT_X509 = '1.2.840.113549.1.9.22.1';

function lerBolsas(seqNo, ctx, achados) {
    for (const bolsa of filhosDe(seqNo)) {
        const [oidNo, explicito] = filhosDe(bolsa, 2);
        const oid = lerOid(oidNo);
        const valor = filhosDe(explicito, 1)[0];
        if (oid === BAG_KEY) {
            achados.chaves.push(bytesDoNo(valor));
        } else if (oid === BAG_SHROUDED_KEY) {
            const [algNo, cifradoNo] = filhosDe(valor, 2);
            achados.chaves.push(decifrar(algNo, octetos(cifradoNo), ctx));
        } else if (oid === BAG_CERT) {
            const [tipoNo, certExp] = filhosDe(valor, 2);
            if (lerOid(tipoNo) === CERT_X509) achados.certs.push(octetos(filhosDe(certExp, 1)[0]));
        } else if (oid === BAG_SAFE_CONTENTS) {
            lerBolsas(valor, ctx, achados);
        }
        // crlBag e secretBag não interessam ao CFI.
    }
}

function lerChave(der) {
    try {
        return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    } catch (e) {
        // Chave decifrada que não é PKCS#8 válido = senha que o arquivo sem
        // MAC não pôde conferir antes.
        throw senhaIncorreta();
    }
}

/**
 * Abre um .pfx (PKCS#12) e devolve a chave privada e o certificado do
 * titular em PEM, mais a cadeia que veio junto.
 *
 * @param {Buffer} pfxBuffer
 * @param {string} senha
 */
export function abrirPfx(pfxBuffer, senha) {
    if (!Buffer.isBuffer(pfxBuffer) || pfxBuffer.length < 4) throw invalido('o arquivo .pfx está vazio');
    const s = String(senha ?? '');
    const pfx = lerDer(pfxBuffer);
    const [versaoNo, authSafe, macNo] = filhosDe(pfx, 2);
    if (lerInteiro(versaoNo) !== 3) throw invalido('versão do PKCS#12 diferente de 3');
    const [tipoNo, conteudoExp] = filhosDe(authSafe, 2);
    if (lerOid(tipoNo) !== OID_DATA) throw invalido('PFX assinado (modo de integridade por chave pública) não é suportado');
    const conteudo = octetos(filhosDe(conteudoExp, 1)[0]);

    const bmp = macNo ? conferirMac(macNo, conteudo, s) : senhaBmp(s);
    const ctx = { senha: s, bmp };
    const achados = { chaves: [], certs: [] };

    for (const info of filhosDe(lerDer(conteudo))) {
        const [oidNo, exp] = filhosDe(info, 1);
        const oid = lerOid(oidNo);
        if (oid === OID_DATA) {
            lerBolsas(lerDer(octetos(filhosDe(exp, 1)[0])), ctx, achados);
        } else if (oid === OID_ENCRYPTED_DATA) {
            const encData = filhosDe(filhosDe(exp, 1)[0], 2);
            const [, algNo, cifradoNo] = filhosDe(encData[1], 3);
            lerBolsas(lerDer(decifrar(algNo, octetos(cifradoNo), ctx)), ctx, achados);
        } else {
            throw invalido(`conteúdo ${oid} não suportado`);
        }
    }

    if (!achados.chaves.length) throw new ErroPfx('SEM_CHAVE', 'Chave privada não encontrada no .pfx');
    if (!achados.certs.length) throw new ErroPfx('SEM_CERTIFICADO', 'Certificado não encontrado no .pfx');

    const x509 = achados.certs.map((der) => new crypto.X509Certificate(der));
    for (const der of achados.chaves) {
        const chave = lerChave(der);
        const i = x509.findIndex((c) => c.checkPrivateKey(chave));
        if (i < 0) continue;
        const certificado = lerCertificado(achados.certs[i]);
        const pemKey = chave.asymmetricKeyType === 'rsa'
            ? chave.export({ type: 'pkcs1', format: 'pem' }).toString()
            : chave.export({ type: 'pkcs8', format: 'pem' }).toString();
        return {
            pemKey,
            pemCert: certificado.pem,
            chave,
            certificado,
            cadeia: achados.certs.filter((_, k) => k !== i).map((der) => lerCertificado(der)),
        };
    }
    throw invalido('a chave privada não corresponde a nenhum certificado do arquivo');
}
