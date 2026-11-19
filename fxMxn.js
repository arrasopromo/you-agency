// fxMxn.js — Cotação USD→MXN por dia (gasto da conta de anúncio em dólar → pesos do painel).
//
// O gasto em dólar de um dia é convertido pela cotação DAQUELE dia (coleção `fx_usd_mxn_diario`),
// não pela de hoje: o lucro de dias passados não muda quando o dólar oscila.
// Hoje = cotação do momento (AwesomeAPI USD-MXN, cache de 10 min; cada leitura sobrescreve o dia de hoje,
// então a última lida no dia é a que fica valendo). Dia passado sem registro = fechamento histórico
// (fim de semana/feriado = último dia útil anterior), gravado para não consultar de novo.
'use strict';

const axios = require('axios');
const { getCollection } = require('./mongodbClient');

const COL = 'fx_usd_mxn_diario';
const PADRAO = Number(process.env.FX_USD_MXN_PADRAO || 18) || 18; // só se nada responder
const valida = (r) => Number.isFinite(r) && r > 10 && r < 40;
// Dia no horário da Cidade do México (UTC-6, sem horário de verão desde 2022).
const diaMX = (ms) => new Date(Number(ms) - 6 * 3600e3).toISOString().slice(0, 10);

let __live = { atMs: 0, rate: null };
const __diaCache = new Map(); // 'YYYY-MM-DD' -> rate (dias passados)

async function gravarHoje(rate, source) {
  try {
    const col = await getCollection(COL);
    await col.updateOne({ _id: diaMX(Date.now()) }, { $set: { rate, source, atIso: new Date().toISOString() } }, { upsert: true });
  } catch (_) {}
}

// Cotação do momento. Sem internet: última do banco; sem nada: PADRAO.
async function getUsdMxnRate() {
  if (__live.rate && Date.now() - __live.atMs < 10 * 60 * 1000) return __live.rate;
  try {
    const r = await axios.get('https://economia.awesomeapi.com.br/json/last/USD-MXN', { timeout: 8000, validateStatus: () => true });
    const bid = Number(r && r.data && r.data.USDMXN && r.data.USDMXN.bid);
    if (valida(bid)) { __live = { atMs: Date.now(), rate: bid }; gravarHoje(bid, 'awesomeapi'); return bid; }
  } catch (_) {}
  if (__live.rate) return __live.rate;
  try {
    const col = await getCollection(COL);
    const d = await col.find({}).sort({ _id: -1 }).limit(1).toArray();
    const r = Number(d[0] && d[0].rate);
    if (valida(r)) { __live = { atMs: Date.now() - 9 * 60 * 1000, rate: r }; return r; }
  } catch (_) {}
  return PADRAO;
}

async function backfillHistorico(faltando) {
  const out = {};
  if (!faltando.length) return out;
  const ord = faltando.slice().sort();
  const ini = new Date(Date.parse(ord[0] + 'T12:00:00Z') - 10 * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
  const fim = ord[ord.length - 1].replace(/-/g, '');
  try {
    // A API só respeita o intervalo com a quantidade no caminho (/daily/USD-MXN/<n>?start_date&end_date).
    const n = Math.min(1000, Math.ceil((Date.parse(ord[ord.length - 1] + 'T12:00:00Z') - Date.parse(ord[0] + 'T12:00:00Z')) / 864e5) + 20);
    const r = await axios.get('https://economia.awesomeapi.com.br/json/daily/USD-MXN/' + n, { params: { start_date: ini, end_date: fim }, timeout: 15000, validateStatus: () => true });
    const fech = {}; // dia -> { ts, bid } (último do dia)
    for (const x of (Array.isArray(r && r.data) ? r.data : [])) {
      const ts = Number(x && x.timestamp) * 1000, bid = Number(x && x.bid);
      if (!(ts > 0) || !valida(bid)) continue;
      const d = diaMX(ts);
      if (!fech[d] || fech[d].ts < ts) fech[d] = { ts, bid };
    }
    const uteis = Object.keys(fech).sort();
    for (const d of ord) {
      let ult = null; for (const u of uteis) { if (u <= d) ult = u; else break; }
      if (ult) out[d] = { rate: fech[ult].bid, source: ult === d ? 'awesomeapi_fechamento' : 'awesomeapi_fechamento_' + ult };
    }
    if (Object.keys(out).length) {
      const col = await getCollection(COL);
      await Promise.all(Object.entries(out).map(([d, v]) => col.updateOne({ _id: d }, { $setOnInsert: { rate: v.rate, source: v.source, atIso: new Date().toISOString() } }, { upsert: true })));
    }
  } catch (_) {}
  return out;
}

// { 'YYYY-MM-DD': rate } para cada dia pedido. Nunca inventa: sem nada, usa a cotação do momento.
async function taxasPorDia(dias) {
  const hoje = diaMX(Date.now());
  const res = {};
  let live = null;
  const pegaLive = async () => { if (live == null) live = await getUsdMxnRate(); return live; };
  const passados = [];
  for (const d of [...new Set((dias || []).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x))))]) {
    if (d >= hoje) res[d] = await pegaLive();
    else if (__diaCache.has(d)) res[d] = __diaCache.get(d);
    else passados.push(d);
  }
  if (passados.length) {
    try {
      const col = await getCollection(COL);
      for (const x of await col.find({ _id: { $in: passados } }).toArray()) { const r = Number(x.rate); if (valida(r)) { res[x._id] = r; __diaCache.set(x._id, r); } }
    } catch (_) {}
    const faltam = passados.filter((d) => res[d] == null);
    if (faltam.length) {
      const hist = await backfillHistorico(faltam);
      for (const d of faltam) { if (hist[d]) { res[d] = hist[d].rate; __diaCache.set(d, hist[d].rate); } else res[d] = await pegaLive(); }
    }
  }
  return res;
}

// { dia: valorUSD } → pesos. Devolve { byDay (MXN), total (MXN), totalUsd, taxaMedia, taxas }.
async function converterUsdPorDia(byDayUsd) {
  const dias = Object.keys(byDayUsd || {});
  const taxas = await taxasPorDia(dias);
  const byDay = {}; let total = 0, totalUsd = 0;
  for (const d of dias) { const v = Number(byDayUsd[d]) || 0; byDay[d] = v * (taxas[d] || PADRAO); total += byDay[d]; totalUsd += v; }
  return { byDay, total, totalUsd, taxaMedia: totalUsd > 0 ? total / totalUsd : null, taxas };
}

// Registra a cotação do dia mesmo sem ninguém abrir o painel (1x por hora).
let __timer = null;
function iniciar() {
  if (__timer) return;
  setTimeout(() => { getUsdMxnRate().catch(() => {}); }, 20000);
  __timer = setInterval(() => { __live.atMs = 0; getUsdMxnRate().catch(() => {}); }, 60 * 60 * 1000);
}

// Real → peso (custo dos fornecedores é calculado em R$; o painel do You Agency mostra tudo em MXN).
// Cotação do momento (AwesomeAPI BRL-MXN, cache de 10 min); sem resposta: USD-MXN ÷ USD-BRL; último caso, padrão.
let __brlLive = { atMs: 0, rate: null };
const validaBrl = (r) => Number.isFinite(r) && r > 1.5 && r < 8;
async function getBrlMxnRate() {
  if (__brlLive.rate && Date.now() - __brlLive.atMs < 10 * 60 * 1000) return __brlLive.rate;
  try {
    const r = await axios.get('https://economia.awesomeapi.com.br/json/last/BRL-MXN', { timeout: 8000, validateStatus: () => true });
    const bid = Number(r && r.data && r.data.BRLMXN && r.data.BRLMXN.bid);
    if (validaBrl(bid)) { __brlLive = { atMs: Date.now(), rate: bid }; return bid; }
  } catch (_) {}
  try {
    const usdMxn = await getUsdMxnRate();
    const r = await axios.get('https://economia.awesomeapi.com.br/json/last/USD-BRL', { timeout: 8000, validateStatus: () => true });
    const usdBrl = Number(r && r.data && r.data.USDBRL && r.data.USDBRL.bid);
    const x = usdMxn / usdBrl;
    if (validaBrl(x)) { __brlLive = { atMs: Date.now(), rate: x }; return x; }
  } catch (_) {}
  return __brlLive.rate || (Number(process.env.FX_BRL_MXN_PADRAO || 3.3) || 3.3);
}

module.exports = { getUsdMxnRate, getBrlMxnRate, taxasPorDia, converterUsdPorDia, iniciar, _diaMX: diaMX };
