
import { CnpjData } from '../types';

const parseBrasilAPIResponse = (data: any): CnpjData => ({
    razaoSocial: data.razao_social,
    nomeFantasia: data.nome_fantasia || '',
    cnaePrincipal: {
        codigo: String(data.cnae_fiscal),
        descricao: data.cnae_fiscal_descricao
    },
    cnaesSecundarios: data.cnaes_secundarios?.map((c: any) => ({
        codigo: String(c.codigo),
        descricao: c.descricao
    })) || [],
    logradouro: data.logradouro,
    numero: data.numero,
    bairro: data.bairro,
    municipio: data.municipio,
    uf: data.uf,
    cep: data.cep
});

const parseCnpjWsResponse = (data: any): CnpjData => ({
    razaoSocial: data.razao_social || '',
    nomeFantasia: data.estabelecimento?.nome_fantasia || '',
    cnaePrincipal: {
        codigo: String(data.estabelecimento?.atividade_principal?.id || ''),
        descricao: data.estabelecimento?.atividade_principal?.descricao || ''
    },
    cnaesSecundarios: (data.estabelecimento?.atividades_secundarias || []).map((c: any) => ({
        codigo: String(c.id || ''),
        descricao: c.descricao || ''
    })),
    logradouro: data.estabelecimento?.logradouro || '',
    numero: data.estabelecimento?.numero || '',
    bairro: data.estabelecimento?.bairro || '',
    municipio: data.estabelecimento?.cidade?.nome || '',
    uf: data.estabelecimento?.estado?.sigla || '',
    cep: data.estabelecimento?.cep || ''
});

const fetchFromBrasilAPI = async (cleanCnpj: string): Promise<CnpjData> => {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`);

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('CNPJ não encontrado na base de dados da Receita Federal.');
        }
        if (response.status === 429) {
            throw new Error('Muitas requisições. Tente novamente em alguns instantes.');
        }
        throw new Error(`BrasilAPI retornou status ${response.status}`);
    }

    const data = await response.json();
    return parseBrasilAPIResponse(data);
};

const fetchFromCnpjWs = async (cleanCnpj: string): Promise<CnpjData> => {
    const response = await fetch(`https://publica.cnpj.ws/cnpj/${cleanCnpj}`);

    if (!response.ok) {
        if (response.status === 404) {
            throw new Error('CNPJ não encontrado na base de dados da Receita Federal.');
        }
        if (response.status === 429) {
            throw new Error('Muitas requisições. Aguarde 1 minuto e tente novamente.');
        }
        throw new Error(`CNPJ.ws retornou status ${response.status}`);
    }

    const data = await response.json();
    return parseCnpjWsResponse(data);
};

export const fetchCnpjFromBrasilAPI = async (cnpj: string): Promise<CnpjData> => {
    // Remove caracteres não numéricos
    const cleanCnpj = cnpj.replace(/\D/g, '');

    if (cleanCnpj.length !== 14) {
        throw new Error('CNPJ deve conter 14 dígitos.');
    }

    // Tenta BrasilAPI primeiro, depois ReceitaWS como fallback
    const apis = [
        { name: 'BrasilAPI', fn: () => fetchFromBrasilAPI(cleanCnpj) },
        { name: 'CNPJ.ws', fn: () => fetchFromCnpjWs(cleanCnpj) },
    ];

    let lastError: any = null;

    for (const api of apis) {
        try {
            const result = await api.fn();
            return result;
        } catch (error: any) {
            console.warn(`${api.name} falhou:`, error.message);
            // Se o erro for "CNPJ não encontrado", não tenta o próximo (é definitivo)
            if (error.message?.includes('não encontrado')) {
                throw error;
            }
            lastError = error;
        }
    }

    // Se ambas falharam, retorna erro amigável
    const msg = lastError?.message || '';
    if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('fetch')) {
        throw new Error('Erro de conexão com os serviços de consulta CNPJ. Verifique sua internet e tente novamente.');
    }
    throw new Error(lastError?.message || 'Não foi possível consultar o CNPJ. Tente novamente.');
};
