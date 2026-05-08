
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

// Merged tables from servicos-instagram.js, engajamento-novo.js and checkout.js
const tabelaSeguidores = {
    mistos: [
        { q: 150, p: '$ 2.99' },
        { q: 300, p: '$ 4.99' },
        { q: 500, p: '$ 5.99' },
        { q: 700, p: '$ 7.99' },
        { q: 1000, p: '$ 8.99' },
        { q: 2000, p: '$ 14.99' },
        { q: 3000, p: '$ 19.99' },
        { q: 4000, p: '$ 24.99' },
        { q: 5000, p: '$ 29.99' },
        { q: 7500, p: '$ 39.99' },
        { q: 10000, p: '$ 49.99' },
        { q: 15000, p: '$ 69.99' },
    ],
    brasileiros: [
        { q: 150, p: '$ 2.99' },
        { q: 300, p: '$ 4.99' },
        { q: 500, p: '$ 5.99' },
        { q: 700, p: '$ 7.99' },
        { q: 1000, p: '$ 8.99' },
        { q: 2000, p: '$ 14.99' },
        { q: 3000, p: '$ 19.99' },
        { q: 4000, p: '$ 24.99' },
        { q: 5000, p: '$ 29.99' },
        { q: 7500, p: '$ 39.99' },
        { q: 10000, p: '$ 49.99' },
        { q: 15000, p: '$ 69.99' },
    ],
    organicos: [
        { q: 150, p: '$ 8.90' },
        { q: 300, p: '$ 10.90' },
        { q: 500, p: '$ 15.90' },
        { q: 1000, p: '$ 27.90' },
        { q: 2000, p: '$ 42.90' },
        { q: 3000, p: '$ 53.90' },
        { q: 4000, p: '$ 70.90' },
        { q: 5000, p: '$ 106.90' },
        { q: 7500, p: '$ 128.90' },
        { q: 10000, p: '$ 192.90' },
        { q: 15000, p: '$ 277.90' },
    ],
};

const tabelaCurtidas = {
    mistos: [
        { q: 150, p: '$ 1.99' },
        { q: 300, p: '$ 2.99' },
        { q: 500, p: '$ 3.99' },
        { q: 700, p: '$ 4.99' },
        { q: 1000, p: '$ 5.99' },
        { q: 2000, p: '$ 7.99' },
        { q: 3000, p: '$ 9.99' },
        { q: 4000, p: '$ 11.99' },
        { q: 5000, p: '$ 13.99' },
        { q: 7500, p: '$ 16.99' },
        { q: 10000, p: '$ 19.99' },
        { q: 15000, p: '$ 24.99' },
    ],
    brasileiros: [
        { q: 150, p: '$ 1.99' },
        { q: 300, p: '$ 2.99' },
        { q: 500, p: '$ 3.99' },
        { q: 700, p: '$ 4.99' },
        { q: 1000, p: '$ 5.99' },
        { q: 2000, p: '$ 7.99' },
        { q: 3000, p: '$ 9.99' },
        { q: 4000, p: '$ 11.99' },
        { q: 5000, p: '$ 13.99' },
        { q: 7500, p: '$ 16.99' },
        { q: 10000, p: '$ 19.99' },
        { q: 15000, p: '$ 24.99' },
    ],
    curtidas_brasileiras: [
        { q: 150, p: '$ 1.99' },
        { q: 300, p: '$ 2.99' },
        { q: 500, p: '$ 3.99' },
        { q: 700, p: '$ 4.99' },
        { q: 1000, p: '$ 5.99' },
        { q: 2000, p: '$ 7.99' },
        { q: 3000, p: '$ 9.99' },
        { q: 4000, p: '$ 11.99' },
        { q: 5000, p: '$ 13.99' },
        { q: 7500, p: '$ 16.99' },
        { q: 10000, p: '$ 19.99' },
        { q: 15000, p: '$ 24.99' },
    ],
    organicos: [
        { q: 150, p: '$ 4.99' },
        { q: 300, p: '$ 7.99' },
        { q: 500, p: '$ 12.99' },
        { q: 1000, p: '$ 16.99' },
        { q: 2000, p: '$ 24.99' },
        { q: 3000, p: '$ 34.99' },
        { q: 4000, p: '$ 44.99' },
        { q: 5000, p: '$ 54.99' },
        { q: 7500, p: '$ 69.99' },
        { q: 10000, p: '$ 89.99' },
        { q: 15000, p: '$ 119.99' },
    ],
    curtidas_reais: [
        { q: 150, p: '$ 4.99' },
        { q: 300, p: '$ 7.99' },
        { q: 500, p: '$ 12.99' },
        { q: 1000, p: '$ 16.99' },
        { q: 2000, p: '$ 24.99' },
        { q: 3000, p: '$ 34.99' },
        { q: 4000, p: '$ 44.99' },
        { q: 5000, p: '$ 54.99' },
        { q: 7500, p: '$ 69.99' },
        { q: 10000, p: '$ 89.99' },
        { q: 15000, p: '$ 119.99' },
    ],
};

const tabelaVisualizacoes = {
    visualizacoes_reels: [
        { q: 1000, p: '$ 1.99' },
        { q: 2500, p: '$ 2.99' },
        { q: 5000, p: '$ 3.99' },
        { q: 10000, p: '$ 5.99' },
        { q: 25000, p: '$ 7.99' },
        { q: 50000, p: '$ 9.99' },
        { q: 100000, p: '$ 14.99' },
        { q: 150000, p: '$ 16.99' },
        { q: 200000, p: '$ 19.99' },
        { q: 250000, p: '$ 24.99' },
        { q: 500000, p: '$ 29.99' },
        { q: 1000000, p: '$ 39.99' }
    ]
};

// Order Bumps / Upsells logic
const tabelaCurtidasPromo = {
    mistos: [
        { q: 150, p: 'R$ 4,90' },
        { q: 300, p: 'R$ 9,90' },
        { q: 500, p: 'R$ 14,90' },
        { q: 700, p: 'R$ 19,90' },
        { q: 1000, p: 'R$ 24,90' },
        { q: 2000, p: 'R$ 34,90' },
        { q: 3000, p: 'R$ 49,90' },
        { q: 4000, p: 'R$ 59,90' },
        { q: 5000, p: 'R$ 69,90' },
        { q: 7500, p: 'R$ 89,90' },
        { q: 10000, p: 'R$ 109,90' },
        { q: 15000, p: 'R$ 159,90' },
    ],
    brasileiros: [
        { q: 150, p: 'R$ 5,90' },
        { q: 300, p: 'R$ 9,90' },
        { q: 500, p: 'R$ 14,90' },
        { q: 700, p: 'R$ 29,90' },
        { q: 1000, p: 'R$ 39,90' },
        { q: 2000, p: 'R$ 49,90' },
        { q: 3000, p: 'R$ 59,90' },
        { q: 4000, p: 'R$ 69,90' },
        { q: 5000, p: 'R$ 79,90' },
        { q: 7500, p: 'R$ 109,90' },
        { q: 10000, p: 'R$ 139,90' },
        { q: 15000, p: 'R$ 199,90' },
    ],
    organicos: [
        { q: 150, p: 'R$ 16,90' },
        { q: 300, p: 'R$ 28,90' },
        { q: 500, p: 'R$ 49,90' },
        { q: 1000, p: 'R$ 69,90' },
        { q: 2000, p: 'R$ 104,90' },
        { q: 3000, p: 'R$ 139,90' },
        { q: 4000, p: 'R$ 174,90' },
        { q: 5000, p: 'R$ 224,90' },
        { q: 7500, p: 'R$ 279,90' },
        { q: 10000, p: 'R$ 349,90' },
        { q: 15000, p: 'R$ 449,90' },
    ],
};

const calculateOrderBumps = (bumpsStr, baseType) => {
    if (!bumpsStr) return 0;
    let total = 0;
    const bumps = bumpsStr.split(';'); // "likes:150;views:1000"
    const base = String(baseType || '').toLowerCase();
    
    bumps.forEach(bump => {
        const [key, qtyStr] = bump.split(':');
        const q = parseInt(qtyStr, 10) || 1;
        
        if (key === 'likes') {
            const isReelsViewsBase = base.includes('visualiz') || base === 'views' || base === 'reels' || base.includes('visualizacoes_reels');
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
            // 1 comment = R$ 1,50 (150 cents)
            total += q * 150;
            
        } else if (key === 'warranty' || key === 'warranty30' || key === 'warranty_life' || key === 'warranty_lifetime' || key === 'warranty60' || key === 'warranty_6m' || key === 'warranty6m') {
             total += 990; 
        }
    });
    
    return total;
};

const calculatePrice = async (type, quantity, additionalInfo = []) => {
    additionalInfo = Array.isArray(additionalInfo) ? additionalInfo : [];
    const tipo = String(type || '').trim();
    if (tipo === 'refil_extensao') {
        const modeItem = additionalInfo.find(x => x && x.key === 'refil_mode');
        const mode = String(modeItem?.value || '').trim().toLowerCase();
        if (mode === 'life') return 990;
        return 990;
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
    if (category === 'curtidas' && tabelaCurtidas[type]) {
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
    
    // Try to find exact quantity match
    const item = table.find(x => x.q === q);
    if (item) {
        let priceCents = parsePrecoToCents(item.p);
        
        // Apply Upsell Discount (25% OFF) if eligible
        // Conditions: Followers service, Quantity >= 500, isUpsell flag present
        // Verifica se a tabela usada é realmente de seguidores para evitar aplicar desconto em curtidas
        const isFollowersTable = Object.values(tabelaSeguidores).includes(table);
        
        if (isUpsell && q >= 500 && isFollowersTable) {
            priceCents = Math.round(priceCents * 0.75);
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
        totalCents += calculateOrderBumps(bumpsStr, tipo);

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
                const map = {
                    150: 300,
                    500: 700,
                    1000: 2000,
                    3000: 4000,
                    5000: 7500,
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
                    totalCents = Math.round(Number(totalCents) * (1 - discount));
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
            if (provider === 'stripe') {
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

const verifyPrice = async (type, quantity, additionalInfo, valuePaid) => {
    // Calculate standard price (with upsell logic applied if flag present)
    const calculatedPrice = await calculatePrice(type, quantity, additionalInfo);
    
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

module.exports = { calculatePrice, validatePrice, verifyPrice, parsePrecoToCents };
