
const { getCollection } = require('./mongodbClient');

const parsePrecoToCents = (precoStr) => {
    if (!precoStr) return 0;
    const raw = String(precoStr);
    const cleaned = raw.replace(/[^\d.,-]/g, '');
    if (!cleaned) return 0;
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    let normalized = cleaned;
    if (lastComma > lastDot) {
        normalized = cleaned.replace(/\./g, '').replace(/,/g, '.');
    } else {
        normalized = cleaned.replace(/,/g, '');
    }
    const value = Math.round(parseFloat(normalized) * 100);
    return isNaN(value) ? 0 : value;
};

// Preços em MXN (pesos mexicanos): tabela da Oppus em R$ × BRL→MXN 3.3289 × 1,10, arredondado para ,90.
// Gerado em 2026-11-11. Mixtos de 2.000 para cima igualados à concorrência (Explota) em 21/11/2026; 4.000, 7.500 e 15.000 proporcionais. As mesmas tabelas estão no front (servicos-instagram.js, engajamento-novo.js, checkout.js) e precisam bater.
const tabelaSeguidores = {
    mistos: [
        { q: 150, p: '$ 39' },
        { q: 300, p: '$ 61' },
        { q: 500, p: '$ 87' },
        { q: 700, p: '$ 116' },
        { q: 1000, p: '$ 156' },
        { q: 2000, p: '$ 239' },
        { q: 3000, p: '$ 369' },
        { q: 4000, p: '$ 499' },
        { q: 5000, p: '$ 629' },
        { q: 7500, p: '$ 949' },
        { q: 10000, p: '$ 1279' },
        { q: 15000, p: '$ 1799' },
    ],
    brasileiros: [
        { q: 150, p: '$ 46' },
        { q: 300, p: '$ 90' },
        { q: 500, p: '$ 145' },
        { q: 700, p: '$ 182' },
        { q: 1000, p: '$ 292' },
        { q: 2000, p: '$ 475' },
        { q: 3000, p: '$ 658' },
        { q: 4000, p: '$ 914' },
        { q: 5000, p: '$ 1024' },
        { q: 7500, p: '$ 1463' },
        { q: 10000, p: '$ 1830' },
        { q: 15000, p: '$ 2928' },
    ],
    organicos: [
        { q: 150, p: '$ 145' },
        { q: 300, p: '$ 182' },
        { q: 500, p: '$ 255' },
        { q: 1000, p: '$ 475' },
        { q: 2000, p: '$ 731' },
        { q: 3000, p: '$ 914' },
        { q: 4000, p: '$ 1207' },
        { q: 5000, p: '$ 1830' },
        { q: 7500, p: '$ 2196' },
        { q: 10000, p: '$ 3294' },
        { q: 15000, p: '$ 4759' },
    ],
};

const tabelaCurtidas = {
    mistos: [
        { q: 150, p: '$ 22' },
        { q: 300, p: '$ 25' },
        { q: 500, p: '$ 32' },
        { q: 700, p: '$ 48' },
        { q: 1000, p: '$ 65' },
        { q: 2000, p: '$ 81' },
        { q: 3000, p: '$ 98' },
        { q: 4000, p: '$ 114' },
        { q: 5000, p: '$ 131' },
        { q: 7500, p: '$ 164' },
        { q: 10000, p: '$ 230' },
        { q: 15000, p: '$ 296' },
    ],
    brasileiros: [
        { q: 150, p: '$ 22' },
        { q: 300, p: '$ 32' },
        { q: 500, p: '$ 48' },
        { q: 700, p: '$ 98' },
        { q: 1000, p: '$ 131' },
        { q: 2000, p: '$ 164' },
        { q: 3000, p: '$ 197' },
        { q: 4000, p: '$ 230' },
        { q: 5000, p: '$ 263' },
        { q: 7500, p: '$ 362' },
        { q: 10000, p: '$ 461' },
        { q: 15000, p: '$ 659' },
    ],
    curtidas_brasileiras: [
        { q: 150, p: '$ 22' },
        { q: 300, p: '$ 32' },
        { q: 500, p: '$ 48' },
        { q: 700, p: '$ 98' },
        { q: 1000, p: '$ 131' },
        { q: 2000, p: '$ 164' },
        { q: 3000, p: '$ 197' },
        { q: 4000, p: '$ 230' },
        { q: 5000, p: '$ 263' },
        { q: 7500, p: '$ 362' },
        { q: 10000, p: '$ 461' },
        { q: 15000, p: '$ 659' },
    ],
    organicos: [
        { q: 150, p: '$ 39' },
        { q: 300, p: '$ 65' },
        { q: 500, p: '$ 114' },
        { q: 700, p: '$ 134' },
        { q: 1000, p: '$ 161' },
        { q: 2000, p: '$ 243' },
        { q: 3000, p: '$ 322' },
        { q: 4000, p: '$ 405' },
        { q: 5000, p: '$ 520' },
        { q: 7500, p: '$ 646' },
    ],
    curtidas_reais: [
        { q: 150, p: '$ 39' },
        { q: 300, p: '$ 65' },
        { q: 500, p: '$ 114' },
        { q: 700, p: '$ 134' },
        { q: 1000, p: '$ 161' },
        { q: 2000, p: '$ 243' },
        { q: 3000, p: '$ 322' },
        { q: 4000, p: '$ 405' },
        { q: 5000, p: '$ 520' },
        { q: 7500, p: '$ 646' },
    ],
};

const tabelaVisualizacoes = {
    visualizacoes_reels: [
        { q: 1000, p: '$ 22' },
        { q: 2500, p: '$ 32' },
        { q: 5000, p: '$ 48' },
        { q: 10000, p: '$ 65' },
        { q: 25000, p: '$ 81' },
        { q: 50000, p: '$ 114' },
        { q: 100000, p: '$ 164' },
        { q: 150000, p: '$ 197' },
        { q: 200000, p: '$ 230' },
        { q: 250000, p: '$ 296' },
        { q: 500000, p: '$ 362' },
        { q: 1000000, p: '$ 527' },
    ],
};

// TikTok e Facebook: mesmos pacotes e preços do Instagram (seguidores mistos, curtidas mistas
// e visualizações). O tipo_servico já diz a rede (tiktok_* / facebook_*), então não colide
// com as tabelas do Instagram. O front (servicos-redes.js) lê esta tabela por /api/redes/catalogo.
// Comentários de TikTok/Facebook: MXN 20 cada, igual ao Instagram (1 comentário = o mínimo da Xpag).
const tabelaComentariosRedes = [
    { q: 1, p: '$ 20' },
    { q: 10, p: '$ 200' },
    { q: 25, p: '$ 500' },
    { q: 50, p: '$ 1000' },
    { q: 100, p: '$ 2000' },
    { q: 250, p: '$ 5000' },
];
const tabelaRedes = {
    tiktok_seguidores: tabelaSeguidores.mistos,
    tiktok_curtidas: tabelaCurtidas.mistos,
    tiktok_curtidas_reais: tabelaCurtidas.organicos,
    tiktok_visualizacoes: tabelaVisualizacoes.visualizacoes_reels,
    tiktok_comentarios: tabelaComentariosRedes,
    facebook_seguidores: tabelaSeguidores.mistos,
    facebook_seguidores_perfil: tabelaSeguidores.mistos, // antigo (compat)
    facebook_seguidores_pagina: tabelaSeguidores.mistos,
    facebook_curtidas: tabelaCurtidas.mistos,
    facebook_visualizacoes: tabelaVisualizacoes.visualizacoes_reels,
    facebook_comentarios: tabelaComentariosRedes,
};

// Order Bumps / Upsells logic
const tabelaCurtidasPromo = {
    mistos: [
        { q: 150, p: '$ 22' },
        { q: 300, p: '$ 25' },
        { q: 500, p: '$ 32' },
        { q: 700, p: '$ 48' },
        { q: 1000, p: '$ 65' },
        { q: 2000, p: '$ 81' },
        { q: 3000, p: '$ 98' },
        { q: 4000, p: '$ 114' },
        { q: 5000, p: '$ 131' },
        { q: 7500, p: '$ 164' },
        { q: 10000, p: '$ 230' },
        { q: 15000, p: '$ 296' },
    ],
    brasileiros: [
        { q: 150, p: '$ 22' },
        { q: 300, p: '$ 32' },
        { q: 500, p: '$ 48' },
        { q: 700, p: '$ 98' },
        { q: 1000, p: '$ 131' },
        { q: 2000, p: '$ 164' },
        { q: 3000, p: '$ 197' },
        { q: 4000, p: '$ 230' },
        { q: 5000, p: '$ 263' },
        { q: 7500, p: '$ 362' },
        { q: 10000, p: '$ 461' },
        { q: 15000, p: '$ 659' },
    ],
    organicos: [
        { q: 150, p: '$ 39' },
        { q: 300, p: '$ 65' },
        { q: 500, p: '$ 114' },
        { q: 700, p: '$ 134' },
        { q: 1000, p: '$ 161' },
        { q: 2000, p: '$ 243' },
        { q: 3000, p: '$ 322' },
        { q: 4000, p: '$ 405' },
        { q: 5000, p: '$ 520' },
        { q: 7500, p: '$ 646' },
    ],
};

// Comentários do Instagram: 1 = MXN 20; cada comentário a mais soma MXN 6 (≈ R$ 2). 2 = 26, 10 = 74, 250 = 1.514.
const comentariosIgCents = (q) => (q >= 1 ? 2000 + 600 * (q - 1) : 0);
const calculateOrderBumps = (bumpsStr, baseType, opts = {}) => {
    if (!bumpsStr) return 0;
    let total = 0;
    const bumps = bumpsStr.split(';'); // "likes:150;views:1000"
    const base = String(baseType || '').toLowerCase();
    
    bumps.forEach(bump => {
        const [key, qtyStr] = bump.split(':');
        const q = parseInt(qtyStr, 10) || 1;
        
        if (key === 'likes') {
            const isReelsViewsBase = base.includes('visualiz') || base === 'views' || base === 'reels' || base.includes('visualizacoes_reels') || base.includes('coment');
            const variant = isReelsViewsBase
              ? 'organicos'
              : (base.includes('organicos') ? 'organicos' : ((base.includes('brasileiros') || base.includes('curtidas_brasileiras')) ? 'brasileiros' : 'mistos'));
            const table = tabelaCurtidas[variant] || tabelaCurtidas.mistos;
            const item = table.find(x => x.q === q);
            if (item) total += parsePrecoToCents(item.p);
            
        } else if (key === 'views') {
            const item = tabelaVisualizacoes.visualizacoes_reels.find(x => x.q === q);
            if (item) total += parsePrecoToCents(item.p);
            
        } else if (key === 'comments') {
            // Instagram: 1 comentário MXN 20 + MXN 6 (≈ R$ 2) por comentário a mais. TikTok/Facebook: MXN 20 cada.
            total += (opts && opts.comentariosRedes) ? q * 2000 : comentariosIgCents(q);
            
        } else if (key === 'warranty_3m' || key === 'warranty3m') {
             // Garantia DINÂMICA (3 meses), igual à Oppus: 2 reposições completas pelo custo atual do
             // tipo. O valor (em cents de MXN) é calculado no app.js (lê cost_settings) e vem em opts.
             total += Math.max(0, Math.round(Number(opts.warranty3mCents) || 0));
        } else if (key === 'warranty' || key === 'warranty30' || key === 'warranty_life' || key === 'warranty_lifetime' || key === 'warranty60' || key === 'warranty_6m' || key === 'warranty6m') {
             total += 3500; // MXN 35 — garantia antiga (6 meses), mantida p/ a página inicial e pedidos já feitos
        }
    });
    
    return total;
};

// You Agency: preços em pesos inteiros (sem ".90"): arredonda PARA BAIXO até o peso (mínimo $1).
// O nome ficou por compatibilidade com o app.js.
const round90Cents = (cents) => Math.max(100, Math.floor((Number(cents) || 0) / 100) * 100);
// Garantia DINÂMICA de 3 meses (mesma lógica da Oppus) = 2 reposições completas pelo custo atual.
// O custo do cost_settings é em REAIS por mil (o mesmo da Oppus, auto-calibrado); vira pesos pelo
// mesmo ×3 da tabela de preços (WARRANTY_BRL_MXN). Ex.: custo R$ 11,83/mil, 1000 seg → 2 × 11,83 × 3 = $ 70.
const WARRANTY_BRL_MXN = Number(process.env.WARRANTY_BRL_MXN || 3) || 3;
const warranty3mCents = (costPerMilCents, quantity) => {
    const q = Math.max(0, parseInt(quantity, 10) || 0);
    const c = Math.max(0, Number(costPerMilCents) || 0);
    if (!q || !c) return 0;
    const custoCents = Math.round(c * q / 1000);              // custo de entregar a quantidade (R$)
    return round90Cents(2 * custoCents * WARRANTY_BRL_MXN);   // 2 reposições completas, em pesos inteiros
};

const calculatePrice = async (type, quantity, additionalInfo = [], opts = {}) => {
    additionalInfo = Array.isArray(additionalInfo) ? additionalInfo : [];
    const tipo = String(type || '').trim();
    if (tipo === 'refil_extensao') {
        const modeItem = additionalInfo.find(x => x && x.key === 'refil_mode');
        const mode = String(modeItem?.value || '').trim().toLowerCase();
        // Extensão DINÂMICA de 3 meses (igual à Oppus): recalcula pelo custo ATUAL do pedido de
        // seguidores (2 reposições completas). O valor vem do app.js em opts.refilExt3mCents.
        if ((mode === '3m' || mode === '3') && Number(opts.refilExt3mCents) > 0) {
            return Math.round(Number(opts.refilExt3mCents));
        }
        if (mode === 'life') return 3500;
        return 3500; // MXN 35
    }
    let totalCents = 0;
    const q = parseInt(quantity, 10);
    
    // Extract category from additionalInfo if available
    let category = '';
    let isUpsell = false;
    let coupon = null;

    if (Array.isArray(additionalInfo)) {
        const catItem = additionalInfo.find(x => x.key === 'categoria_servico');
        if (catItem) category = String(catItem.value).toLowerCase();
        
        // Check for upsell flags
        const upsellItem = additionalInfo.find(x => 
            x.key === 'is_upsell' || 
            x.key === 'upsell_followers' ||
            x.key === 'upsell'
        );
        if (upsellItem && (upsellItem.value === true || upsellItem.value === 'true' || upsellItem.value === '1')) {
            isUpsell = true;
        }

        // Coupon Logic Placeholder
        const couponItem = additionalInfo.find(x => x.key === 'coupon' || x.key === 'cupom');
        if (couponItem && couponItem.value) {
            coupon = String(couponItem.value).trim().toUpperCase();
        }
    }

    // 1. Base Price
    let table = [];
    
    // Explicit category check to resolve ambiguity
    if (tabelaRedes[tipo]) {
        // TikTok/Facebook: sem bumps, upgrade nem desconto de upsell — só o pacote.
        // (Cupom, se houver, é conferido no /api/xpag/create-charge sobre este valor.)
        const itemRede = tabelaRedes[tipo].find(x => x.q === q);
        if (!itemRede) return 0;
        let totalRede = parsePrecoToCents(itemRede.p);
        // Ofertas (bumps) de TikTok/Facebook: só me gusta, visualizaciones e comentarios, com os
        // mesmos preços das ofertas do Instagram (me gusta mixtos, tabela de views, $20/comentário).
        const bumpsRede = String((additionalInfo.find(x => x && x.key === 'order_bumps') || {}).value || '')
            .split(';').filter((b) => /^(likes|views|comments):\d+$/.test(b.trim())).join(';');
        if (bumpsRede) totalRede += calculateOrderBumps(bumpsRede, 'mistos', { ...opts, comentariosRedes: true });
        return totalRede;
    } else if (category === 'curtidas' && tabelaCurtidas[type]) {
        table = tabelaCurtidas[type];
    } else if (category === 'seguidores' && tabelaSeguidores[type]) {
        table = tabelaSeguidores[type];
    } else if (category === 'visualizacoes' && (type === 'visualizacoes_reels' || type === 'views' || type === 'reels')) {
        table = tabelaVisualizacoes.visualizacoes_reels;
    }
    // Fallback logic (if no category provided)
    else {
        if (type === 'visualizacoes_reels' || type === 'views' || type === 'reels') {
            table = tabelaVisualizacoes.visualizacoes_reels;
        } else if (tabelaSeguidores[type]) {
            // Se existir em seguidores E em curtidas (ambiguidade 'mistos'), prefere seguidores se não especificado
            // Mas idealmente o frontend DEVE mandar categoria.
            table = tabelaSeguidores[type];
        } else if (tabelaCurtidas[type]) {
            table = tabelaCurtidas[type];
        }
    }
    
    // Comentários do Instagram: 1 = MXN 20 (mínimo da Xpag); cada um a mais + MXN 6 (≈ R$ 2). De 1 a 250.
    const isComentarios = category === 'comentarios' || category === 'comentario' || tipo === 'comentarios' || tipo === 'comentario';
    // Try to find exact quantity match
    const item = isComentarios ? null : table.find(x => x.q === q);
    if (isComentarios) {
        if (q >= 1 && q <= 250) totalCents = comentariosIgCents(q);
    } else if (item) {
        let priceCents = parsePrecoToCents(item.p);
        
        // Apply Upsell Discount (25% OFF) if eligible
        // Conditions: Followers service, Quantity >= 500, isUpsell flag present
        // Verifica se a tabela usada é realmente de seguidores para evitar aplicar desconto em curtidas
        const isFollowersTable = Object.values(tabelaSeguidores).includes(table);
        
        if (isUpsell && q >= 500 && isFollowersTable) {
            priceCents = Math.floor(priceCents * 0.75 / 100) * 100; // pesos inteiros
        }

        totalCents = priceCents;
    } else {
        // Price not found for quantity
    }
    
    // 2. Order Bumps
    // Handle both string format "likes:150;views:1000" and potential array format if changed later
    let bumpsStr = '';
    
    // Check if additionalInfo has 'order_bumps'
    const orderBumpsItem = additionalInfo.find(x => x.key === 'order_bumps');
    if (orderBumpsItem) {
        bumpsStr = orderBumpsItem.value;
    }
    
    if (bumpsStr) {
        totalCents += calculateOrderBumps(bumpsStr, tipo, opts);

        // --- UPGRADE LOGIC START ---
        // Mirroring logic from servicos-instagram.js updateOrderBump
        if (/(^|;)upgrade:\d+/i.test(bumpsStr)) {
            const q = parseInt(quantity, 10);
            let targetQ = 0;
            
            if (type === 'visualizacoes_reels' || type === 'views' || type === 'reels') {
                 const map = {
                    1000: 2500,
                    5000: 10000,
                    25000: 50000,
                    100000: 150000,
                    200000: 250000,
                    500000: 1000000
                 };
                 targetQ = map[q];
            } else if ((type === 'brasileiros' || type === 'organicos') && q === 1000) {
                targetQ = 2000;
            } else {
                // Keep upgrade mapping in sync with checkout.js (updateOrderBump -> upsellTargets)
                // Igual ao front (servicos-instagram.js upsellTargets) e à Oppus: cada pacote sobe para o seguinte.
                const map = {
                    150: 300,
                    300: 500,
                    500: 700,
                    700: 1000,
                    1000: 2000,
                    1200: 2000,
                    2000: 3000,
                    3000: 4000,
                    4000: 5000,
                    5000: 7500,
                    7500: 10000,
                    10000: 15000
                };
                targetQ = map[q];
            }
            
            if (targetQ && table && Array.isArray(table)) {
                const baseItem = table.find(x => x.q === q);
                const targetItem = table.find(x => x.q === targetQ);
                
                if (baseItem && targetItem) {
                    const basePrice = parsePrecoToCents(baseItem.p);
                    const targetPrice = parsePrecoToCents(targetItem.p);
                    const upgradePrice = Math.max(0, targetPrice - basePrice);
                    totalCents += upgradePrice;
                }
            }
        }
        // --- UPGRADE LOGIC END ---
    }

    // --- COUPON LOGIC (APPLY AFTER BUMPS) START ---
    if (coupon) {
        try {
            const col = await getCollection('coupons');
            const couponDoc = await col.findOne({ code: coupon, isActive: true });
            if (couponDoc) {
                const discount = Number(couponDoc.discountPercentage || 0) / 100;
                if (discount > 0) {
                    // Mínimo da Xpag: o cupom nunca deixa o total abaixo de MXN 20.00.
                    const _bruto = Number(totalCents);
                    totalCents = Math.max(Math.round(_bruto * (1 - discount)), Math.min(_bruto, 2000));
                }
            }
        } catch (error) {
            console.error('Error fetching coupon:', error);
        }
    }
    // --- COUPON LOGIC (APPLY AFTER BUMPS) END ---

    try {
        const pmItem = Array.isArray(additionalInfo) ? additionalInfo.find(x => x && x.key === 'payment_method') : null;
        const pm = String(pmItem?.value || '').trim().toLowerCase();
        if (pm === 'credit_card') {
            const providerItem = Array.isArray(additionalInfo)
                ? additionalInfo.find(x => x && (x.key === 'card_provider' || x.key === 'provider' || x.key === 'gateway'))
                : null;
            const provider = String(providerItem?.value || '').trim().toLowerCase();
            if (provider === 'stripe' || provider === 'nowpayments') {
                return totalCents;
            }
            const maxInstallments = (function () {
                const n = parseInt(String(process.env.PAGARME_INSTALLMENTS_MAX || '12'), 10);
                if (!Number.isFinite(n) || n <= 0) return 12;
                return Math.max(1, Math.min(18, n));
            })();
            const installmentsRaw = (Array.isArray(additionalInfo) ? (additionalInfo.find(x => x && (x.key === 'installments' || x.key === 'parcelas'))?.value) : null);
            const installments = Math.max(1, Math.min(maxInstallments, parseInt(String(installmentsRaw || '1'), 10) || 1));
            const rateTable = {
                1: 4.97, 2: 6.33, 3: 7.24, 4: 8.14, 5: 9.05, 6: 9.95,
                7: 11.10, 8: 12.00, 9: 12.91, 10: 13.81, 11: 14.71, 12: 15.62
            };
            const keys = Object.keys(rateTable).map(k => parseInt(k, 10)).filter(Number.isFinite).sort((a,b)=>a-b);
            const maxKey = keys[keys.length - 1] || 12;
            const instKey = Math.min(installments, maxKey);
            const surcharge = Number(rateTable[instKey] || 0);
            totalCents = Math.round(Number(totalCents) * (1 + Math.max(0, surcharge) / 100));
        }
    } catch(_) {}

    return totalCents;
};

const validatePrice = async (type, quantity, additionalInfo, valuePaid) => {
    const verification = await verifyPrice(type, quantity, additionalInfo, valuePaid);
    return verification.isValid;
};

const verifyPrice = async (type, quantity, additionalInfo, valuePaid, opts = {}) => {
    // Calculate standard price (with upsell logic applied if flag present)
    const calculatedPrice = await calculatePrice(type, quantity, additionalInfo, opts);
    
    // Also try to calculate WITHOUT upsell flag, in case the user didn't send the flag but sent the discounted price (legacy/fallback)
    // Or vice versa
    
    // But for strict validation, we should trust the calculatedPrice based on input.
    // However, to be robust against frontend glitches, we might want to check both scenarios?
    // No, strict validation means: if you want discount, you MUST tell me it's an upsell.
    
    let isValid = false;
    let mismatchDetails = null;

    if (valuePaid === calculatedPrice) {
        isValid = true;
    } else {
        mismatchDetails = {
            expected: calculatedPrice,
            paid: valuePaid,
            diff: valuePaid - calculatedPrice
        };
    }

    return { isValid, matchedPrice: isValid ? calculatedPrice : null, expectedPrice: calculatedPrice, mismatchDetails };
};

module.exports = { comentariosIgCents, calculatePrice, validatePrice, verifyPrice, parsePrecoToCents, warranty3mCents, round90Cents, tabelaSeguidores, tabelaCurtidas, tabelaVisualizacoes, tabelaRedes };
