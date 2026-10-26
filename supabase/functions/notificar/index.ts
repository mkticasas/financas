// Edge Function: notificar
// Chamada pelo banco a cada lançamento novo. Manda notificação para os
// celulares do casal, menos o de quem lançou.
// Secrets necessárias: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY
// (SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já existem automaticamente)

import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!pub || !priv) return json({ error: "Faltam as secrets VAPID_PUBLIC_KEY e VAPID_PRIVATE_KEY." }, 500);

  const { id } = await req.json().catch(() => ({}));
  if (!id) return json({ error: "Sem id." }, 400);

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // marca como notificado de forma atômica: se já foi, não manda de novo
  const { data: tx } = await sb.from("transacoes").update({ notificado: true })
    .eq("id", id).eq("notificado", false).select("*").maybeSingle();
  if (!tx) return json({ ok: true, pulou: "já notificado ou inexistente" });
  if (Date.now() - new Date(tx.created_at).getTime() > 10 * 60 * 1000) return json({ ok: true, pulou: "antigo" });

  const semAutor = "00000000-0000-0000-0000-000000000000";
  const [{ data: autor }, { data: cat }, { data: subs }] = await Promise.all([
    sb.from("perfis").select("nome").eq("id", tx.criado_por ?? semAutor).maybeSingle(),
    tx.categoria_id ? sb.from("categorias").select("nome").eq("id", tx.categoria_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("push_subs").select("*").eq("casal_id", tx.casal_id).neq("perfil_id", tx.criado_por ?? semAutor),
  ]);
  if (!subs?.length) return json({ ok: true, enviados: 0 });

  webpush.setVapidDetails("https://mkticasas.github.io/financas/", pub, priv);
  const valor = Number(tx.parcelas > 1 ? tx.valor_total : tx.valor) || 0;
  const brl = valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const quem = autor?.nome || "Alguém";
  const payload = JSON.stringify({
    title: tx.tipo === "receita" ? `${quem} lançou uma entrada` : `${quem} lançou um gasto`,
    body: `${brl}${tx.parcelas > 1 ? ` em ${tx.parcelas}x` : ""} · ${tx.descricao}${cat?.nome ? ` (${cat.nome})` : ""}`,
    url: "./",
    tag: "tx-" + tx.id,
  });

  let enviados = 0;
  await Promise.all(subs.map(async (s: any) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400 });
      enviados++;
    } catch (e: any) {
      if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("push_subs").delete().eq("id", s.id); // aparelho desativou
      else console.error("push falhou", e?.statusCode, e?.body || String(e));
    }
  }));
  return json({ ok: true, enviados });
});
