/**
 * EmpresaDadosFiscaisModal — modal pra editar dados fiscais necessarios
 * pra geracao de SPED Fiscal e outras obrigacoes acessorias.
 *
 * Funciona pra empresas Simples Nacional E Lucro Presumido/Real.
 * Recebe os valores atuais via prop, dispara onSave com o objeto novo.
 */
import React, { useEffect, useState } from 'react';
import type { EmpresaDadosFiscais } from '../types';
import { CloseIcon, BuildingIcon } from './Icons';
import { sanitizarDadosFiscais } from '../services/empresaDadosFiscaisSanitize';
import { soZerosComoVazio } from '../sefaz-backend/ccm-sp.js';
// 🏦 DeRE: as opções do regime específico vêm do DONO — copiá-las aqui seria a
// segunda cópia do vocabulário, e a tela ofereceria um código que o backend
// recusa no primeiro regime novo.
import { REGIMES_ESPECIFICOS_IBS_CBS } from '../sefaz-backend/dere-regimes.js';
import { buscarCep } from '../services/cepService';
import { listarContadores, salvarContador, type Contador } from '../services/contadoresService';
// As tabelas do frete contratado vêm do DONO no backend — reescrevê-las aqui
// seria a segunda cópia de uma tabela oficial, que é o defeito que esta casa
// mais paga (lição do IVA-ST e do catálogo de CFOP).
import {
    INDICADORES_NATUREZA_FRETE, INDICADORES_TIPO_FRETE,
} from '../sefaz-backend/frete-contratado-bloco-d';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    empresaNome: string;
    valoresAtuais?: EmpresaDadosFiscais;
    onSave: (dados: EmpresaDadosFiscais) => Promise<void>;
}

const UFS = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
    'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
    'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
];

const EmpresaDadosFiscaisModal: React.FC<Props> = ({
    isOpen,
    onClose,
    empresaNome,
    valoresAtuais,
    onSave,
}) => {
    const [dados, setDados] = useState<EmpresaDadosFiscais>(valoresAtuais || {});
    const [salvando, setSalvando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    // Prevenção: UF vazia bloqueia a captura NFe — o 1º clique em Salvar mostra
    // o aviso; o 2º confirma que é intencional (evita pendência silenciosa).
    const [avisoUfVazia, setAvisoUfVazia] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setDados(valoresAtuais || {});
            setErro(null);
            setAvisoUfVazia(false);
        }
    }, [isOpen, valoresAtuais]);

    // ── Responsáveis legais (lista dinâmica; legado respLegal* vira 1ª linha) ─
    const responsaveis = dados.responsaveisLegais
        ?? ((dados.respLegalNome || dados.respLegalCpf || dados.respLegalCargo)
            ? [{ nome: dados.respLegalNome || '', cpf: dados.respLegalCpf || '', cargo: dados.respLegalCargo || '' }]
            : [{ nome: '', cpf: '', cargo: '' }]);
    const setResponsaveis = (lista: Array<{ nome?: string; cpf?: string; cargo?: string }>) =>
        setDados(prev => ({ ...prev, responsaveisLegais: lista }));
    const handleResp = (i: number, campo: 'nome' | 'cpf' | 'cargo', valor: string) =>
        setResponsaveis(responsaveis.map((r, x) => x === i ? { ...r, [campo]: valor } : r));
    const adicionarResp = () => setResponsaveis([...responsaveis, { nome: '', cpf: '', cargo: '' }]);
    const removerResp = (i: number) =>
        setResponsaveis(responsaveis.length > 1 ? responsaveis.filter((_, x) => x !== i) : [{ nome: '', cpf: '', cargo: '' }]);

    // ── Catálogo de contadores do escritório ─────────────────────────────────
    const [contadores, setContadores] = useState<Contador[]>([]);
    const [salvandoContador, setSalvandoContador] = useState(false);
    useEffect(() => {
        if (!isOpen) return;
        let alive = true;
        listarContadores().then(l => { if (alive) setContadores(l); }).catch(() => {});
        return () => { alive = false; };
    }, [isOpen]);
    const escolherContador = (id: string) => {
        const c = contadores.find(x => x.id === id);
        setDados(prev => ({
            ...prev,
            contadorId: id,
            ...(c ? { contadorNome: c.nome, contadorCrc: c.crc, contadorCpf: c.cpf } : {}),
        }));
    };
    const salvarContadorNoCatalogo = async () => {
        setSalvandoContador(true);
        try {
            const c = await salvarContador({
                nome: dados.contadorNome || '', crc: dados.contadorCrc || '', cpf: dados.contadorCpf || '',
            });
            setContadores(prev => {
                const sem = prev.filter(x => x.id !== c.id);
                return [...sem, c].sort((a, b) => a.nome.localeCompare(b.nome));
            });
            setDados(prev => ({ ...prev, contadorId: c.id }));
        } catch (e: any) {
            setErro(`Falha ao salvar no catálogo: ${e.message}`);
        } finally {
            setSalvandoContador(false);
        }
    };

    // `string | boolean`: quase todo campo aqui é texto, mas o
    // `gerarInventario` é uma DECISÃO de sim/não e o backend a lê como
    // booleano (`!!gerarInventario`). Guardá-la como a string 'nao' seria
    // truthy — o bloco sairia justamente quando alguém marcasse que NÃO.
    const handleField = (key: keyof EmpresaDadosFiscais, value: string | boolean) => {
        // Guarda a string COMO ESTÁ, inclusive vazia. O `value || undefined`
        // antigo virava undefined ao limpar o campo, o JSON perdia a chave e o
        // backend nunca recebia ordem de apagar — era por isso que "limpar e
        // salvar" não pegava (CCM de empresa fora de SP capital, 27/07).
        // Campo intocado continua ausente do objeto e segue inalterado.
        setDados(prev => ({ ...prev, [key]: value }));
        if (key === 'uf') setAvisoUfVazia(false);
    };

    // Autocomplete por CEP (ViaCEP): preenche endereço + UF + código IBGE —
    // os dois últimos são os campos que TRAVAM trilho quando ficam vazios.
    // Só preenche campo VAZIO (não sobrescreve o que a equipe digitou), com a
    // exceção de UF/IBGE, que são verdade derivada do próprio CEP.
    const [buscandoCep, setBuscandoCep] = useState(false);
    const [cepInfo, setCepInfo] = useState<string | null>(null);
    const handleCep = async (valor: string) => {
        handleField('cep', valor);
        const digitos = valor.replace(/\D/g, '');
        if (digitos.length !== 8) { setCepInfo(null); return; }
        setBuscandoCep(true);
        setCepInfo(null);
        try {
            const end = await buscarCep(digitos);
            if (!end) { setCepInfo('CEP não encontrado — preencha o endereço manualmente.'); return; }
            setDados(prev => ({
                ...prev,
                cep: digitos,
                logradouro: prev.logradouro?.trim() ? prev.logradouro : end.logradouro,
                bairro: prev.bairro?.trim() ? prev.bairro : end.bairro,
                uf: end.uf || prev.uf,
                codMunIBGE: end.codMunIBGE || prev.codMunIBGE,
            }));
            setCepInfo(`✓ ${end.municipio}/${end.uf}${end.codMunIBGE ? ` · IBGE ${end.codMunIBGE}` : ''} — endereço preenchido.`);
            setAvisoUfVazia(false);
        } finally {
            setBuscandoCep(false);
        }
    };

    // Condição rural: o bloco inteiro é gravado junto (booleano desmarcado tem
    // de chegar como false — undefined sumiria do JSON e o valor velho ficaria
    // preso, mesma lição do CCM).
    const handleRural = (key: keyof NonNullable<EmpresaDadosFiscais['condicaoRural']>, value: boolean | string) => {
        setDados(prev => ({
            ...prev,
            condicaoRural: {
                adquireDeProdutor: false,
                ehProdutorRuralPF: false,
                ehCooperativa: false,
                funruralSubRogacao: 'automatico',
                observacao: '',
                ...(prev.condicaoRural || {}),
                [key]: value,
            },
        }));
    };

    const handleSave = async () => {
        // Validações de prevenção ANTES de chamar o backend.
        const ufNorm = (dados.uf || '').trim().toUpperCase();
        if (ufNorm && !UFS.includes(ufNorm)) {
            setErro(`UF inválida: "${dados.uf}". Use a sigla de 2 letras (ex.: SP).`);
            return;
        }
        const ccmDigits = (dados.ccmSp || '').replace(/\D/g, '');
        if ((dados.ccmSp || '').trim() && (ccmDigits.length < 6 || ccmDigits.length > 11)) {
            setErro(`CCM inválido: "${dados.ccmSp}". A Inscrição Municipal de SP tem 8 dígitos (só números).`);
            return;
        }
        if (!ufNorm && !avisoUfVazia) {
            setAvisoUfVazia(true);
            setErro('⚠ UF em branco: a captura automática de NF-e desta empresa fica BLOQUEADA até preencher. '
                + 'Preencha a UF (ex.: SP) ou clique em Salvar de novo para gravar mesmo assim.');
            return;
        }
        setSalvando(true);
        setErro(null);
        try {
            // Sanitiza (puro e testado): campo limpo vira '' = ordem de APAGAR;
            // campo intocado fica ausente = não mexe. Ver
            // services/empresaDadosFiscaisSanitize.ts.
            await onSave(sanitizarDadosFiscais(dados));
            onClose();
        } catch (e: any) {
            setErro(e?.message || 'Erro ao salvar.');
        } finally {
            setSalvando(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/60 flex items-start justify-center p-4 z-[70] animate-fade-in overflow-y-auto"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col my-auto"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-slate-100 dark:bg-slate-900 p-4 rounded-t-xl flex justify-between items-center border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-slate-800 dark:text-slate-100 font-bold text-lg flex items-center gap-2">
                        <BuildingIcon className="w-5 h-5 text-sky-600" />
                        Dados Fiscais — {empresaNome}
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1 rounded-full text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                    >
                        <CloseIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 flex-grow overflow-y-auto bg-white dark:bg-slate-800 space-y-6">
                    {erro && (
                        <div className="p-3 rounded-lg bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 text-sm font-medium">
                            {erro}
                        </div>
                    )}

                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Informações necessárias para geração de SPED Fiscal e outras obrigações acessórias.
                        Campos opcionais ficam em branco se não souber.
                    </p>

                    {/* Cod.Cliente — o código da empresa no E-Fiscal (Paulo,
                        04/08): chave do confronto CNPJ ↔ schema na migração do
                        PG12 e o "Nº Empresa" do Exportar SAGE. */}
                    <Section titulo="🔢 Código no E-Fiscal">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Field
                                label="Cod.Cliente (E-Fiscal)"
                                value={dados.codCliente || ''}
                                onChange={v => handleField('codCliente', v)}
                                placeholder="0001"
                                hint="O código que aparece ANTES do nome da empresa no E-Fiscal (4 dígitos, 0001–9999 — o zero à esquerda é preservado). É único por empresa e é a amarração da migração; o Exportar SAGE preenche o Nº Empresa sozinho a partir dele. Vazio = empresa sem código lá."
                            />
                        </div>
                    </Section>

                    {/* Inscrição Estadual */}
                    <Section titulo="📋 Inscrições e Localização">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Field
                                label="Inscrição Estadual"
                                value={dados.inscricaoEstadual || ''}
                                onChange={v => handleField('inscricaoEstadual', v)}
                                placeholder="123.456.789.012 ou ISENTO"
                                hint="Sem pontos. Use 'ISENTO' se a empresa não é contribuinte ICMS."
                            />
                            <SelectField
                                label="UF"
                                value={dados.uf || ''}
                                onChange={v => handleField('uf', v)}
                                options={[{ value: '', label: '— Selecione —' }, ...UFS.map(u => ({ value: u, label: u }))]}
                            />
                            <Field
                                label="Código Município IBGE"
                                value={dados.codMunIBGE || ''}
                                onChange={v => handleField('codMunIBGE', v)}
                                placeholder="3550308"
                                hint="7 dígitos. Ex: São Paulo = 3550308."
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                            <Field
                                label="Inscrição Municipal"
                                value={dados.inscricaoMunicipal || ''}
                                onChange={v => handleField('inscricaoMunicipal', v)}
                                placeholder="Inscrição na prefeitura da empresa"
                                hint="Para empresas de QUALQUER município. Formato livre (varia por prefeitura). Não é obrigatório e não valida formato."
                            />
                            <div>
                                <Field
                                    label="CCM — Inscrição Municipal de SP capital"
                                    value={dados.ccmSp || ''}
                                    onChange={v => handleField('ccmSp', v)}
                                    placeholder="Deixe em branco se não for SP capital"
                                    hint="SÓ para empresas de SP capital — é a chave da captura de NFS-e SP. Empresa de outra cidade deixa em branco e usa a Inscrição Municipal acima. Apagar e salvar REMOVE o valor."
                                />
                                {/* Aviso vivo: município preenchido ≠ capital + CCM com
                                    valor = cadastro enganando o trilho NFS-e SP (caso
                                    DARCY/Santos com 000000000, 26/07). */}
                                {soZerosComoVazio(dados.ccmSp) != null &&
                                    (dados.codMunIBGE || '').replace(/\D/g, '').length === 7 &&
                                    (dados.codMunIBGE || '').replace(/\D/g, '') !== '3550308' && (
                                    <p className="text-[11px] text-amber-500 mt-1">
                                        ⚠ O município deste cadastro não é São Paulo capital — este CCM não se
                                        aplica e engana o trilho de NFS-e. Apague o campo e salve (a Inscrição
                                        Municipal genérica acima é o lugar certo).
                                    </p>
                                )}
                            </div>
                            <Field
                                label="CNAE Principal"
                                value={dados.cnae || ''}
                                onChange={v => handleField('cnae', v)}
                                placeholder="4712-1/00"
                                hint="Define presunção, anexo e correlação de CFOP. Antes só dava pra preencher na criação da empresa — agora edita aqui."
                            />
                            <div>
                                <label className="text-xs uppercase font-medium block mb-1 text-slate-500 dark:text-slate-400">
                                    Data de abertura
                                </label>
                                <input
                                    type="date"
                                    value={dados.dataAbertura || ''}
                                    onChange={e => handleField('dataAbertura', e.target.value)}
                                    className="w-full p-2.5 text-sm rounded-lg outline-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                                />
                                <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">
                                    Empresa com menos de 12 meses precisa do RBT12 proporcionalizado — sem a data o DAS pode sair errado.
                                </p>
                            </div>
                            <Field
                                label="IE Substituto Tributário"
                                value={dados.inscEstSubstTrib || ''}
                                onChange={v => handleField('inscEstSubstTrib', v)}
                                placeholder="Opcional — só se for inscrito como ST em outra UF"
                            />
                            <Field
                                label="Código Suframa"
                                value={dados.codSuframa || ''}
                                onChange={v => handleField('codSuframa', v)}
                                placeholder="Opcional — só se em zona franca"
                            />
                            {/* 🏭 IPI — o PVA recusa o SPED nos dois sentidos: bloco
                                E500 em quem não é contribuinte (PS VIDROS, 19/08) e
                                registro 0002 ausente em quem é (PWR, 19/08). O código
                                é de TABELA OFICIAL e o app não deduz. */}
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 text-slate-500 dark:text-slate-400">
                                    Contribuinte de IPI
                                </label>
                                <select
                                    value={dados.contribuinteIpi || ''}
                                    onChange={e => handleField('contribuinteIpi', e.target.value)}
                                    className="w-full p-2.5 text-sm rounded-lg outline-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                                >
                                    <option value="">Não informado — o app decide pelo IPI destacado na saída</option>
                                    <option value="sim">Sim — indústria ou equiparado</option>
                                    <option value="nao">Não — comércio/serviço (IPI da compra é custo)</option>
                                </select>
                                <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">
                                    Decide o bloco E500/E520 do SPED Fiscal. O PVA recusa o bloco de quem não é
                                    contribuinte — e comprar com IPI destacado na nota do fornecedor não faz ninguém
                                    contribuinte.
                                </p>
                            </div>
                            <Field
                                label="Classificação do estab. industrial (IPI)"
                                value={dados.classEstabIpi || ''}
                                onChange={v => handleField('classEstabIpi', v)}
                                placeholder="Só p/ contribuinte de IPI — código do registro 0002"
                            />
                            {/* 🏛️ CONTRIBUINTE DE ICMS — 28/08, Paulo: *"as empresas
                                de SERVIÇOS de Brasília, nós entregamos o SPED, mas
                                elas não recolhem ICMS, como fazer para não ficar
                                constando como pendência"*.
                                O app usava a INSCRIÇÃO ESTADUAL como prova, e ter IE
                                não é apurar ICMS — empresa de serviço fora de SP
                                acendia pendência do E116 sem ter o registro. Mesmo
                                desenho do IPI: quem responde é o cadastro, o app não
                                deduz, e "não informado" mantém o comportamento antigo. */}
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 text-slate-500 dark:text-slate-400">
                                    Contribuinte de ICMS
                                </label>
                                <select
                                    value={dados.contribuinteIcms || ''}
                                    onChange={e => handleField('contribuinteIcms', e.target.value)}
                                    className="w-full p-2.5 text-sm rounded-lg outline-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                                >
                                    <option value="">Não informado — o app decide pela inscrição estadual</option>
                                    <option value="sim">Sim — apura ICMS</option>
                                    <option value="nao">Não — só serviço (ISS), não apura ICMS</option>
                                </select>
                                <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">
                                    Decide o E116 (ICMS a recolher) do SPED Fiscal. Marcado <b>Não</b>, o registro
                                    não sai e o prazo/código de receita do ICMS deixam de ser cobrados no
                                    diagnóstico de cadastros.
                                </p>
                            </div>
                            {/* 🏭 BLOCO K — 29/08, Paulo: *"pode fazer o bloco k"*.
                                Quem apresenta o controle da produção e do estoque é o
                                estabelecimento INDUSTRIAL ou equiparado, e o app NÃO
                                DEDUZ isso: a 🚦 Migração detecta produção pelos CFOPs,
                                mas detectar movimento é SINAL, não enquadramento.
                                O LEIAUTE é ESCOLHA do contribuinte (K010, Ajuste SINIEF
                                02/09) — escolher por ele faria o arquivo prometer
                                detalhamento que o PVA cobra, a família da recusa "o
                                registro não deve ser informado para esse perfil". */}
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 text-slate-500 dark:text-slate-400">
                                    Entrega o bloco K (produção e estoque)
                                </label>
                                <select
                                    value={dados.entregaBlocoK ? 'sim' : ''}
                                    onChange={e => handleField('entregaBlocoK', e.target.value === 'sim')}
                                    className="w-full p-2.5 text-sm rounded-lg outline-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                                >
                                    <option value="">Não — o bloco K sai sem dados</option>
                                    <option value="sim">Sim — indústria ou equiparado</option>
                                </select>
                                <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">
                                    Optante do <b>Simples Nacional é dispensado</b> (Resolução CGSN 94).
                                    O apontamento de produção/estoque se informa em SPED Fiscal → 🏭 Bloco K —
                                    sem ele o bloco sai <b>vazio</b>, nunca zerado.
                                </p>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 text-slate-500 dark:text-slate-400">
                                    Leiaute do bloco K (K010)
                                </label>
                                <select
                                    value={dados.leiauteBlocoK || ''}
                                    onChange={e => handleField('leiauteBlocoK', e.target.value)}
                                    className="w-full p-2.5 text-sm rounded-lg outline-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                                >
                                    <option value="">Não escolhido — o app não escolhe por você</option>
                                    <option value="0">0 — simplificado</option>
                                    <option value="1">1 — completo</option>
                                    <option value="2">2 — restrito aos saldos de estoque</option>
                                </select>
                                {/* 🚨 ESTE TEXTO AFIRMAVA O QUE A TABELA OFICIAL DESMENTE (30/08).
                                    Ele dizia só que "o simplificado desobriga o consumo por item" —
                                    e a tabela do Guia 3.2.3 (seção do K010) MANTÉM no simplificado o
                                    K220, o K250, o K270/K280 e o K290/K291/K300/K301. Corrigi o
                                    comentário do `sped-bloco-k.js` e deixei a TELA repetindo a
                                    afirmação errada — que é pior, porque é aqui que a pessoa lê
                                    ANTES de escolher o leiaute. Meia correção. */}
                                <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">
                                    É <b>opção do contribuinte</b> (Ajuste SINIEF 02/09). O simplificado
                                    desobriga o consumo por item (K235, K210/K215, K255, K260/K265) —
                                    mas <b>continua exigindo</b> K220 (movimentação interna), K250
                                    (industrialização por terceiros), K270/K280 e a produção conjunta,
                                    que o app <b>não gera</b>: se houver, lance no PVA. O restrito leva
                                    só o saldo (K200) — e aí o app cobre o bloco inteiro.
                                </p>
                            </div>
                            {/* 🚨 EFD-Contribuições: havendo F550 (receita de
                                ALUGUEL, que não gera documento capturável), o
                                registro 1900 é OBRIGATÓRIO — recusa do PVA na
                                AFFITTARE 07/2026. COD_MOD e COD_SIT são de
                                TABELA OFICIAL e dependem de qual documento a
                                empresa emite pelo aluguel: o app não deduz, e
                                sem estes dois o 1900 não sai. Campo entra na
                                tela E na whitelist no MESMO PR (regra do #382). */}
                            <div className="md:col-span-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400 pt-2">
                                EFD-Contribuições: consolidação da receita (1900)
                            </div>
                            <Field
                                label="Modelo do documento (1900 · COD_MOD)"
                                value={dados.contrib1900CodMod || ''}
                                onChange={v => handleField('contrib1900CodMod', v)}
                                placeholder="Tabela 4.1.1 — só p/ quem tem receita no F550"
                            />
                            <Field
                                label="Situação do documento (1900 · COD_SIT)"
                                value={dados.contrib1900CodSit || ''}
                                onChange={v => handleField('contrib1900CodSit', v)}
                                placeholder="Tabela 4.1.2 — só p/ quem tem receita no F550"
                            />
                            {/* 🚨 BLOCO D — frete contratado. O D100 existe SÓ
                                para a aquisição de frete com direito a crédito
                                (Guia 1.35: "só devem ser relacionados neste
                                registro as aquisições … que confiram direito ao
                                crédito"), ou seja só no regime NÃO-CUMULATIVO.
                                Os três campos são de tabela oficial e nenhum
                                está no XML do CT-e — sem eles o conhecimento
                                não entra, e a falta sai DITA na geração.
                                As listas vêm do DONO, nunca copiadas aqui:
                                segunda cópia de tabela oficial é o que esta
                                casa mais paga. */}
                            <div className="md:col-span-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400 pt-2">
                                EFD-Contribuições: frete contratado (bloco D)
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                                    Natureza do frete (D101/D105 · IND_NAT_FRT)
                                </label>
                                <select
                                    className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-sm"
                                    value={dados.contribIndNatFrete || ''}
                                    onChange={e => handleField('contribIndNatFrete', e.target.value)}
                                >
                                    <option value="">— (sem cadastro: o CT-e não entra no bloco D)</option>
                                    {Object.entries(INDICADORES_NATUREZA_FRETE).map(([cod, desc]) => (
                                        <option key={cod} value={cod}>{`${cod} — ${desc}`}</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                                    Tipo do frete (D100 · IND_FRT)
                                </label>
                                <select
                                    className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-sm"
                                    value={dados.contribIndFrtCte || ''}
                                    onChange={e => handleField('contribIndFrtCte', e.target.value)}
                                >
                                    <option value="">— (sem cadastro: o CT-e não entra no bloco D)</option>
                                    {Object.entries(INDICADORES_TIPO_FRETE).map(([cod, desc]) => (
                                        <option key={cod} value={cod}>{`${cod} — ${desc}`}</option>
                                    ))}
                                </select>
                            </div>
                            <Field
                                label="Base do crédito do frete (D101/D105 · NAT_BC_CRED)"
                                value={dados.contribNatBcCredFrete || ''}
                                onChange={v => handleField('contribNatBcCredFrete', v)}
                                placeholder="Tabela 4.3.7 — só quando a natureza gera crédito"
                            />
                            {/* 🚨 O 0110 declarava rateio proporcional para TODA
                                empresa do não-cumulativo, e o EFD assinado do CF
                                BANK mostra apropriação DIRETA. É fato da empresa. */}
                            <div>
                                <label className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
                                    Apropriação do crédito (0110 · não-cumulativo)
                                </label>
                                <select
                                    className="w-full bg-slate-100 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-sm"
                                    value={dados.indAproCredPisCofins || ''}
                                    onChange={e => handleField('indAproCredPisCofins', e.target.value)}
                                >
                                    <option value="">— (padrão: rateio proporcional)</option>
                                    <option value="1">1 — Apropriação direta</option>
                                    <option value="2">2 — Rateio proporcional</option>
                                </select>
                            </div>
                            <Field
                                label="Conta contábil da receita financeira"
                                value={dados.contaContabilReceitaFinanceira || ''}
                                onChange={v => handleField('contaContabilReceitaFinanceira', v)}
                                placeholder="Só p/ receita de aplicação — COD_CTA do F100"
                            />
                            <Field
                                label="Nome da conta (registro 0500)"
                                value={dados.contaContabilReceitaFinanceiraNome || ''}
                                onChange={v => handleField('contaContabilReceitaFinanceiraNome', v)}
                                placeholder="Ex.: RENDIMENTOS FINANCEIROS"
                            />
                            <Field
                                label="Nível da conta no plano de contas (0500)"
                                value={dados.contaContabilReceitaFinanceiraNivel || ''}
                                onChange={v => handleField('contaContabilReceitaFinanceiraNivel', v)}
                                placeholder="Ex.: 5"
                            />
                            <p className="md:col-span-2 text-[11px] mt-1 text-slate-400 dark:text-slate-500">
                                Os três vão juntos: o registro 0500 declara a conta e o F100 a referencia. Faltando
                                nome ou nível, o 0500 não sai e o F100 vai <strong>sem</strong> a conta — o PVA
                                recusa conta referenciada sem declaração ("informar código no Registro 0500 antes
                                de utilizá-lo").
                            </p>
                            <p className="md:col-span-2 text-[11px] mt-1 text-slate-400 dark:text-slate-500">
                                Obrigatório quando a receita entra pelo F550 (aluguel). O PVA recusa o arquivo
                                sem o 1900. O CNPJ, o valor e os CST o app já deriva do próprio arquivo — estes
                                dois são código de tabela oficial e dependem de qual documento a empresa emite
                                pelo aluguel, então o app não escolhe por você.
                            </p>
                            {/* 🚨 O gerador do BLOCO H LIA `gerarInventario` desde
                                sempre e ele não existia em tela nenhuma nem na
                                whitelist: `inventarioExigido` virava, na prática,
                                "só em dezembro". Empresa que precisa apresentar o
                                inventário FORA de dezembro (mudança de regime,
                                encerramento, exigência estadual) não tinha como
                                fazer o bloco sair — e a ausência de um bloco é
                                silenciosa. É o IND_NAT_PJ de novo, um registro
                                adiante. */}
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 text-slate-500 dark:text-slate-400">
                                    Inventário (Bloco H) fora de dezembro
                                </label>
                                <select
                                    value={dados.gerarInventario ? 'sim' : ''}
                                    onChange={e => handleField('gerarInventario', e.target.value === 'sim')}
                                    className="w-full p-2.5 text-sm rounded-lg outline-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                                >
                                    <option value="">Não — só no encerramento do exercício (dezembro)</option>
                                    <option value="sim">Sim — gerar o Bloco H em TODA competência</option>
                                </select>
                                <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">
                                    Dezembro já sai sozinho. Marque só quando o inventário for exigido em
                                    outro mês — mudança de regime, encerramento ou exigência do estado. O
                                    bloco continua saindo <strong>vazio com aviso</strong> enquanto ninguém
                                    informar a contagem: quantidade não se estima.
                                </p>
                            </div>
                            {/* 🚨 O gerador do EFD-Contribuições LIA este campo desde
                                sempre e ele não existia em tela nenhuma: caía no '00',
                                que declara "sociedade empresária em geral" — inclusive
                                nas imunes/isentas (varredura de 21/08). Tabela oficial:
                                o app não deduz o código. */}
                            <div>
                                <Field
                                    label="Natureza da PJ (IND_NAT_PJ)"
                                    value={dados.indNatPJ || ''}
                                    onChange={v => handleField('indNatPJ', v.replace(/\D/g, '').slice(0, 2))}
                                    placeholder="2 dígitos — campo 13 do registro 0000"
                                />
                                <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">
                                    Código da Tabela 3.1.3 do leiaute do EFD-Contribuições. Em branco, o arquivo
                                    sai com <strong>00 — sociedade empresária em geral</strong>: confira quando a
                                    entidade for cooperativa, imune ou isenta. O app não deduz este código.
                                </p>
                            </div>
                            {/* 🚨 O gerador do E116 chamava os dois de "sobrescritíveis
                                via dadosFiscais" e nenhum tinha onde ser preenchido: a
                                régua caía sempre no default — dia 20, que é o de SP.
                                O prazo do ICMS varia por UF e pelo CPR do contribuinte. */}
                            <Field
                                label="Código de receita do ICMS (E116)"
                                value={dados.icmsCodRec || ''}
                                onChange={v => handleField('icmsCodRec', v)}
                                placeholder="Ex.: 046-2 (SP) — tabela do estado"
                            />
                            <div>
                                <Field
                                    label="Dia de vencimento do ICMS"
                                    value={dados.icmsDiaVencimento || ''}
                                    onChange={v => handleField('icmsDiaVencimento', v.replace(/\D/g, '').slice(0, 2))}
                                    placeholder="Em branco = dia 20 (o de SP)"
                                />
                                <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">
                                    Vai no E116 do SPED Fiscal. O prazo varia por UF e pelo CPR do contribuinte —
                                    em branco o arquivo sai com o dia 20 e a geração avisa.
                                </p>
                            </div>
                            <div>
                                <label className="block text-xs font-semibold mb-1.5 text-slate-500 dark:text-slate-400">
                                    Regime de apuração PIS/COFINS
                                </label>
                                <select
                                    value={dados.regimeApuracaoPisCofins || ''}
                                    onChange={e => handleField('regimeApuracaoPisCofins', e.target.value)}
                                    className="w-full p-2.5 text-sm rounded-lg outline-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                                >
                                    <option value="">Deriva do regime tributário (Real = 1, Presumido = 2)</option>
                                    <option value="1">1 — Não-cumulativo</option>
                                    <option value="2">2 — Cumulativo</option>
                                    <option value="3">3 — Ambos (regimes concomitantes)</option>
                                </select>
                                <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">
                                    Só preencha quando for diferente do que o regime indica — o caso "ambos" é o
                                    que a derivação não tem como saber. Ele decide CST, alíquotas e o COD_CONT do
                                    M210/M610 do EFD-Contribuições.
                                </p>
                            </div>
                        </div>
                    </Section>

                    {/* Endereço */}
                    <Section titulo="🏢 Endereço">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="md:col-span-2">
                                <Field
                                    label="Logradouro"
                                    value={dados.logradouro || ''}
                                    onChange={v => handleField('logradouro', v)}
                                    placeholder="Av. Paulista"
                                />
                            </div>
                            <Field
                                label="Número"
                                value={dados.numero || ''}
                                onChange={v => handleField('numero', v)}
                                placeholder="1000"
                            />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
                            <Field
                                label="Complemento"
                                value={dados.complemento || ''}
                                onChange={v => handleField('complemento', v)}
                                placeholder="Sala 123"
                            />
                            <Field
                                label="Bairro"
                                value={dados.bairro || ''}
                                onChange={v => handleField('bairro', v)}
                                placeholder="Bela Vista"
                            />
                            <Field
                                label="CEP"
                                value={dados.cep || ''}
                                onChange={handleCep}
                                placeholder="01310-100"
                                hint={buscandoCep ? 'Buscando endereço…' : (cepInfo || 'Apenas números — ao completar 8 dígitos, o endereço, a UF e o código IBGE preenchem sozinhos (ViaCEP).')}
                            />
                        </div>
                    </Section>

                    {/* Contato */}
                    <Section titulo="📞 Contato">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <Field
                                label="Email"
                                value={dados.email || ''}
                                onChange={v => handleField('email', v)}
                                placeholder="contato@empresa.com.br"
                            />
                            <Field
                                label="Telefone"
                                value={dados.telefone || ''}
                                onChange={v => handleField('telefone', v)}
                                placeholder="(11) 91234-5678"
                                hint="Apenas números, com DDD."
                            />
                            <Field
                                label="WhatsApp (envio de guias)"
                                value={dados.whatsappCliente || ''}
                                onChange={v => handleField('whatsappCliente', v)}
                                placeholder="(11) 91234-5678"
                                hint="Número que RECEBE as guias pelo WhatsApp oficial do escritório. Campo próprio de propósito: pode ser diferente do telefone de contato."
                            />
                        </div>
                    </Section>

                    {/* Responsável legal e contador — identificação dos relatórios.
                        MÚLTIPLOS responsáveis (03/08): lista dinâmica; o PDF
                        imprime todos. Contador: catálogo do escritório + escolha. */}
                    <Section titulo="✍️ Responsáveis legais e contador">
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                            Identificação OBRIGATÓRIA na emissão dos relatórios. Não é o colaborador da
                            carteira — são os sócios/administradores da empresa (pode ter mais de um; o
                            PDF imprime todos) e o contador que assina (escolhido do catálogo do escritório).
                        </p>

                        {responsaveis.map((r, i) => (
                            <div key={i} className="grid grid-cols-1 md:grid-cols-[1fr_10rem_10rem_auto] gap-3 mb-2 items-end">
                                <Field
                                    label={i === 0 ? 'Responsável pela empresa' : `Responsável ${i + 1}`}
                                    value={r.nome || ''}
                                    onChange={v => handleResp(i, 'nome', v)}
                                    placeholder="Nome do sócio/administrador"
                                />
                                <Field
                                    label="CPF"
                                    value={r.cpf || ''}
                                    onChange={v => handleResp(i, 'cpf', v)}
                                    placeholder="000.000.000-00"
                                />
                                <Field
                                    label="Cargo"
                                    value={r.cargo || ''}
                                    onChange={v => handleResp(i, 'cargo', v)}
                                    placeholder="Sócio administrador"
                                />
                                <button
                                    type="button"
                                    onClick={() => removerResp(i)}
                                    className="h-10 px-3 text-xs font-bold rounded-lg text-slate-400 hover:text-red-600 border border-slate-200 dark:border-slate-600"
                                    title="Remover este responsável"
                                >✕</button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={adicionarResp}
                            className="mb-4 px-3 py-1.5 text-xs font-bold rounded-lg text-blue-700 border border-blue-300 hover:bg-blue-50 dark:text-blue-300 dark:border-blue-700 dark:hover:bg-blue-900/20"
                        >＋ Adicionar responsável</button>

                        <div className="border-t border-slate-200 dark:border-slate-700 pt-3">
                            {contadores.length > 0 && (
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                        Escolher contador do catálogo
                                    </label>
                                    <select
                                        value={dados.contadorId || ''}
                                        onChange={e => escolherContador(e.target.value)}
                                        className="w-full md:w-96 p-2.5 text-sm rounded-lg bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600"
                                    >
                                        <option value="">— escolher ou preencher abaixo —</option>
                                        {contadores.map(c => (
                                            <option key={c.id} value={c.id}>{c.nome} — CRC {c.crc}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                <Field
                                    label="Contador responsável"
                                    value={dados.contadorNome || ''}
                                    onChange={v => { handleField('contadorNome', v); handleField('contadorId', ''); }}
                                    placeholder="Nome do contador"
                                />
                                <Field
                                    label="CRC"
                                    value={dados.contadorCrc || ''}
                                    onChange={v => { handleField('contadorCrc', v); handleField('contadorId', ''); }}
                                    placeholder="1SP123456/O-8"
                                    hint="Formato livre — como está no registro do CRC."
                                />
                                <Field
                                    label="CPF do contador"
                                    value={dados.contadorCpf || ''}
                                    onChange={v => { handleField('contadorCpf', v); handleField('contadorId', ''); }}
                                    placeholder="000.000.000-00"
                                    hint="Apenas números."
                                />
                            </div>
                            <button
                                type="button"
                                onClick={salvarContadorNoCatalogo}
                                disabled={salvandoContador || !(dados.contadorNome || '').trim() || !(dados.contadorCrc || '').trim()}
                                className="mt-2 px-3 py-1.5 text-xs font-bold rounded-lg text-emerald-700 border border-emerald-300 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-700 dark:hover:bg-emerald-900/20 disabled:opacity-40"
                                title="Salva este contador no catálogo pra reutilizar nas outras empresas"
                            >{salvandoContador ? 'Salvando…' : '💾 Salvar contador no catálogo'}</button>
                        </div>
                    </Section>

                    {/* 🆕 REGIME TRIBUTÁRIO — Paulo, 18/08. Antes disto o CFI DEDUZIA o
                        regime da COLEÇÃO em que a empresa foi cadastrada, e não havia
                        onde marcar imune/isenta: uma IGREJA chegava ao CCI rotulada
                        como "Lucro Presumido". O rótulo era o sintoma; o caro é herdar
                        a apuração do Presumido — PIS/COFINS sobre faturamento em quem
                        recolhe PIS sobre a FOLHA. */}
                    <Section titulo="🏛️ Regime tributário">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <SelectField
                                label="Regime tributário"
                                value={dados.regimeTributario || ''}
                                onChange={v => handleField('regimeTributario', v as any)}
                                options={[
                                    { value: '', label: '— Deduzir do cadastro (Simples/Lucro) —' },
                                    { value: 'SIMPLES', label: 'Simples Nacional' },
                                    { value: 'LUCRO_PRESUMIDO', label: 'Lucro Presumido' },
                                    { value: 'LUCRO_REAL', label: 'Lucro Real' },
                                    { value: 'IMUNE', label: 'Imune (CF art. 150, VI)' },
                                    { value: 'ISENTA', label: 'Isenta (Lei 9.532/97 art. 15 e análogos)' },
                                ]}
                                hint="Em branco, o CFI deduz de onde a empresa foi cadastrada — que é o que fazia uma igreja aparecer como Lucro Presumido."
                            />
                            <label className="flex items-start gap-2 text-sm mt-6">
                                <input
                                    type="checkbox"
                                    checked={dados.semFinsLucrativos === true}
                                    onChange={e => handleField('semFinsLucrativos', e.target.checked as any)}
                                    className="mt-1"
                                />
                                <span>
                                    <strong>Entidade sem fins lucrativos (terceiro setor)</strong>
                                    <span className="block text-xs text-slate-500">
                                        Associação, fundação, OSCIP, templo. É campo SEPARADO do regime de
                                        propósito: um templo é imune <em>e</em> sem fins lucrativos, e existe
                                        associação tributada pelo Presumido.
                                    </span>
                                </span>
                            </label>
                        </div>
                        {/* 🏦 DeRE — 02/09, Paulo: "crie uma nova função capaz de atender
                            esta obrigação chamada DERE". A Declaração de Regimes
                            Específicos (IBS/CBS) só existe para quem fornece sob regime
                            específico da LC 214/2025 — e ISSO é fato de cadastro, que o
                            app não deduz pelo CNAE (CNAE é sinal, vira candidata na fila
                            do ⚙️ Config Admin). Marcado um regime obrigado, a DeRE entra
                            no mês do cliente com vencimento; "Não se aplica" tira a
                            pendência; em branco, o app não afirma nada. */}
                        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            <SelectField
                                label="Regime específico de IBS/CBS (DeRE)"
                                value={dados.regimeEspecificoIbsCbs || ''}
                                onChange={v => handleField('regimeEspecificoIbsCbs', v as any)}
                                options={[
                                    { value: '', label: '— Não informado (o app só sugere pelo CNAE) —' },
                                    ...REGIMES_ESPECIFICOS_IBS_CBS.map(r => ({
                                        value: r.codigo,
                                        label: r.dereConfirmada
                                            ? `${r.rotulo} — entra na DeRE`
                                            : (r.codigo === 'NENHUM' ? r.rotulo : `${r.rotulo} — alcance da DeRE não confirmado`),
                                    })),
                                ]}
                                hint="LC 214/2025, Título V. Decide se a DeRE (mensal, dia 15 do mês seguinte, a partir da competência 10/2026) entra no mês deste cliente. Optante do Simples fica fora."
                            />
                        </div>
                        {(dados.regimeTributario === 'IMUNE' || dados.regimeTributario === 'ISENTA') && (
                            <div className="mt-3 rounded-lg border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-800 dark:text-amber-300">
                                ⚠️ <strong>O CFI ainda não tem a lista de obrigações desta entidade.</strong>{' '}
                                Imunidade e isenção não dispensam obrigação acessória (ECD, ECF, DCTFWeb,
                                EFD-Contribuições com PIS sobre a folha). Enquanto a lista não for definida, o
                                app entrega só o que é comum a todos os regimes e <strong>avisa</strong> — em vez
                                de aplicar a do Lucro Presumido e apurar imposto que talvez não exista.
                            </div>
                        )}
                    </Section>

                    {/* SPED config */}
                    <Section titulo="📊 Configuração SPED Fiscal">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <SelectField
                                label="Perfil EFD"
                                value={dados.perfilEFD || 'A'}
                                onChange={v => handleField('perfilEFD', v)}
                                options={[
                                    { value: 'A', label: 'A — Detalhamento completo (recomendado)' },
                                    { value: 'B', label: 'B — Detalhamento resumido' },
                                    { value: 'C', label: 'C — Anual (microprodutor)' },
                                ]}
                                hint="Perfil A é o mais comum e atende todos os casos."
                            />
                            <SelectField
                                label="Indicador de Atividade"
                                value={dados.indAtividade || 'outras'}
                                onChange={v => handleField('indAtividade', v as 'industrial' | 'outras')}
                                options={[
                                    { value: 'outras', label: 'Outras (comércio, serviços, transporte)' },
                                    { value: 'industrial', label: 'Industrial / equiparada' },
                                ]}
                            />
                            <SelectField
                                label="Natureza da Atividade (correlacao CFOP)"
                                value={dados.naturezaAtividade || ''}
                                onChange={v => handleField('naturezaAtividade', v as any)}
                                options={[
                                    { value: '', label: '— Derivar de Ind. Atividade —' },
                                    { value: 'comercio', label: 'Comercio (revenda)' },
                                    { value: 'industria', label: 'Industria' },
                                    { value: 'servicos', label: 'Servicos' },
                                    { value: 'misto', label: 'Misto (sem heuristica)' },
                                ]}
                            />
                        </div>
                    </Section>

                    {/* Produtor rural — DIPAM e FUNRURAL */}
                    <Section titulo="🌾 Produtor rural — DIPAM e FUNRURAL">
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                            Marque a condição do cliente. A marcação faz a obrigação aparecer TODO mês (inclusive
                            em mês sem nota — mês vazio pode ser falha de captura) e escolhe o código certo. O app
                            classifica cada nota pelo que ela mostra: o que estiver marcado aqui e não bater com as
                            notas aparece como divergência no painel DIPAM, nunca em silêncio.
                        </p>
                        <div className="space-y-2">
                            <Check
                                label="Adquire de produtor rural (compra de produtor PF)"
                                hint="Lança DIPAM 1.1 por município paulista de origem e recolhe o FUNRURAL por sub-rogação (Lei 8.212/91, art. 30, IV)."
                                checked={!!dados.condicaoRural?.adquireDeProdutor}
                                onChange={v => handleRural('adquireDeProdutor', v)}
                            />
                            <Check
                                label="O próprio cliente é Produtor Rural (Pessoa Física)"
                                hint="Entrega a DIPAM-A anual (www4.fazenda.sp.gov.br/DIPAM-A) e NÃO lança o código 1.1 sobre as próprias compras."
                                checked={!!dados.condicaoRural?.ehProdutorRuralPF}
                                onChange={v => handleRural('ehProdutorRuralPF', v)}
                            />
                            <Check
                                label="Cooperativa que recebe do cooperado"
                                hint="Usa o código DIPAM 1.3 (SPDIPAM13) no lugar do 1.1 — só quando há efetiva transmissão de propriedade à cooperativa."
                                checked={!!dados.condicaoRural?.ehCooperativa}
                                onChange={v => handleRural('ehCooperativa', v)}
                            />
                            <Check
                                label="Não calcular FUNRURAL por sub-rogação para este cliente"
                                hint="Desliga o cálculo. Use só com fundamento — e escreva o motivo na observação abaixo."
                                checked={dados.condicaoRural?.funruralSubRogacao === 'nao_aplica'}
                                onChange={v => handleRural('funruralSubRogacao', v ? 'nao_aplica' : 'automatico')}
                            />
                        </div>
                        {dados.condicaoRural?.ehProdutorRuralPF && dados.condicaoRural?.adquireDeProdutor && (
                            <p className="text-[11px] text-amber-500 mt-2">
                                ⚠ As duas marcações juntas: produtor rural PF entrega DIPAM-A e não lança o 1.1 —
                                a compra de produtor não vai gerar código 1.1 para este cliente.
                            </p>
                        )}
                        <div className="mt-4">
                            <Field
                                label="Observação (fica registrada no cadastro)"
                                value={dados.condicaoRural?.observacao || ''}
                                onChange={v => handleRural('observacao', v)}
                                placeholder="Ex.: só compra de produtores de Mirassol; fornecedor X optou pela folha."
                            />
                        </div>
                    </Section>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 rounded-b-xl flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        disabled={salvando}
                        className="px-4 py-2 bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 font-semibold transition-colors disabled:opacity-40"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={salvando}
                        className="px-6 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-40"
                    >
                        {salvando ? 'Salvando...' : 'Salvar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// ─── Componentes auxiliares ───────────────────────────────────────────

const Section: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => (
    <div>
        <h4 className="text-sm font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-3 pb-2 border-b border-slate-200 dark:border-slate-700">
            {titulo}
        </h4>
        {children}
    </div>
);

interface FieldProps {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    hint?: string;
}

const Field: React.FC<FieldProps> = ({ label, value, onChange, placeholder, hint }) => (
    <div>
        <label className="text-xs uppercase font-medium block mb-1 text-slate-500 dark:text-slate-400">
            {label}
        </label>
        <input
            type="text"
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full p-2.5 text-sm rounded-lg outline-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        />
        {hint && <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
);

interface SelectFieldProps {
    label: string;
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
    hint?: string;
}

const SelectField: React.FC<SelectFieldProps> = ({ label, value, onChange, options, hint }) => (
    <div>
        <label className="text-xs uppercase font-medium block mb-1 text-slate-500 dark:text-slate-400">
            {label}
        </label>
        <select
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full p-2.5 text-sm rounded-lg outline-none bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
        >
            {options.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
        </select>
        {hint && <p className="text-[11px] mt-1 text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
);

const Check: React.FC<{ label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }> = ({
    label, hint, checked, onChange,
}) => (
    <label className="flex items-start gap-2 cursor-pointer group">
        <input
            type="checkbox"
            checked={checked}
            onChange={e => onChange(e.target.checked)}
            className="mt-0.5 w-4 h-4 rounded border-slate-300 dark:border-slate-600 text-emerald-600 focus:ring-emerald-500"
        />
        <span>
            <span className="text-sm text-slate-700 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white">
                {label}
            </span>
            {hint && <span className="block text-[11px] text-slate-400 dark:text-slate-500">{hint}</span>}
        </span>
    </label>
);

export default EmpresaDadosFiscaisModal;
