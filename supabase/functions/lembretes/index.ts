// Edge Function: lembretes
// Roda todo dia de manhã (agendada pelo banco). Avisa no celular as contas
// fora do cartão que vencem em 3 dias, amanhã, hoje ou que venceram ontem.
// Usa as mesmas secrets das notificações: VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY.
// Com {"teste": true} e o login do usuário, manda só para o casal dele (botão "Testar lembrete").

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const addDias = (iso: string, n: number) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diff = (a: string, b: string) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 864e5);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const brl = (v: unknown) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const QUANDO: Record<number, string> = { [-1]: "venceu ontem", 0: "vence hoje", 1: "vence amanhã", 3: "vence em 3 dias" };
const ROTULO: Record<number, string> = { [-1]: "Atrasada", 0: "Hoje", 1: "Amanhã", 3: "Em 3 dias" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return json({ error: "Faltam as secrets VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY." }, 500);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));

  // modo teste: só o casal de quem pediu
  let soCasal: string | null = null;
  if (body?.teste) {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: u } = await sb.auth.getUser(jwt);
    if (!u?.user) return json({ error: "Faça login para testar." }, 401);
    const { data: p } = await sb.from("perfis").select("casal_id").eq("id", u.user.id).maybeSingle();
    soCasal = p?.casal_id ?? null;
    if (!soCasal) return json({ error: "Perfil sem casal." }, 400);
  }

  const hj = hojeSP(), ini = addDias(hj, -1), fim = addDias(hj, 3);

  // lançamentos pendentes fora do cartão
  let q = sb.from("transacoes").select("casal_id,descricao,valor,data,forma,pago").eq("tipo", "despesa").gte("data", ini).lte("data", fim);
  if (soCasal) q = q.eq("casal_id", soCasal);
  const { data: tx } = await q;
  const pend: any[] = (tx || []).filter((t: any) => t.forma !== "Crédito" && (t.pago === false || (t.pago == null && t.data > hj)));

  // fixos fora do cartão que ainda não foram pagos no mês
  let qr = sb.from("recorrentes").select("*").eq("tipo", "despesa");
  if (soCasal) qr = qr.eq("casal_id", soCasal);
  const { data: rec } = await qr;
  const meses = [...new Set([ini.slice(0, 7), fim.slice(0, 7)])];
  const rp = await sb.from("transacoes").select("rec_id,referencia").not("rec_id", "is", null).in("referencia", meses);
  const pagos = rp.error ? [] : (rp.data || []);
  for (const r of rec || []) {
    if (r.forma === "Crédito") continue;
    for (const mk of meses) {
      if (r.inicio.slice(0, 7) > mk || (r.fim && mk > r.fim.slice(0, 7))) continue;
      const [y, m] = mk.split("-").map(Number);
      const d = mk + "-" + String(Math.min(r.dia, lastDay(y, m))).padStart(2, "0");
      if (d < ini || d > fim || pagos.some((p: any) => p.rec_id === r.id && p.referencia === mk)) continue;
      pend.push({ casal_id: r.casal_id, descricao: r.descricao, valor: r.valor, data: d });
    }
  }

  // agrupa por casal, só nos dias de aviso
  const por: Record<string, any[]> = {};
  for (const p of pend) {
    const k = diff(p.data, hj);
    if (!(k in QUANDO)) continue;
    (por[p.casal_id] ||= []).push({ ...p, k });
  }
  if (soCasal && !por[soCasal]) por[soCasal] = [];

  webpush.setVapidDetails("https://mkticasas.github.io/financas/", pub, priv);
  let enviados = 0;
  for (const [cid, itens] of Object.entries(por)) {
    if (!soCasal) {
      const { error } = await sb.from("lembretes_enviados").insert({ casal_id: cid, dia: hj });
      if (error) continue; // já avisou hoje
    }
    const { data: subs } = await sb.from("push_subs").select("*").eq("casal_id", cid);
    if (!subs?.length) continue;
    itens.sort((a, b) => a.k - b.k);
    let title: string, text: string;
    if (!itens.length) { title = "Lembretes de contas ativos"; text = "Nada vencendo nos próximos 3 dias."; }
    else if (itens.length === 1) { title = `${itens[0].descricao} ${QUANDO[itens[0].k]}`; text = `${brl(itens[0].valor)} · toque para pagar`; }
    else {
      title = itens.some(i => i.k === -1) ? "Contas atrasadas e a vencer" : `${itens.length} contas para pagar`;
      text = itens.map(i => `${ROTULO[i.k]}: ${i.descricao} ${brl(i.valor)}`).join(" · ");
    }
    const payload = JSON.stringify({ title, body: text, url: "./", tag: "lembrete-" + hj });
    await Promise.all(subs.map(async (s: any) => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 43200 }); enviados++; }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("push_subs").delete().eq("id", s.id); }
    }));
  }
  return json({ ok: true, hoje: hj, casais: Object.keys(por).length, enviados });
});
